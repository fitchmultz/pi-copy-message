import type { KeybindingsManager, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type TuiMode,
} from "@earendil-works/pi-tui";
import { compactPreview, formatTime, roleLabel, safeDisplayText } from "./display-text.ts";
import { type CopyFormat, type CopyableMessage, formatMessageForCopy } from "./session-content.ts";

export const MAX_VISIBLE_MESSAGES = 8;
const MAX_PEEK_LINES = 16;
const PEEK_WRAP_CHARS = 65_536;
const WIDE_LAYOUT_WIDTH = 74;

/** The theme calls the picker makes; the host theme satisfies this structurally. */
export interface CopyMessageTheme {
	fg: (color: ThemeColor, text: string) => string;
	bold: (text: string) => string;
}

export type PickerKeybindings = Pick<KeybindingsManager, "getKeys" | "matches">;

/** Everything a line builder needs that does not belong to one message. */
export interface ViewContext {
	width: number;
	theme: CopyMessageTheme;
	keybindings?: PickerKeybindings | undefined;
	tuiMode: TuiMode;
	total: number;
}

type Hint = { label: string; data: string };

const FILTER_HINTS: Hint[] = [
	{ label: "U", data: "\x15" },
	{ label: "A", data: "\x01" },
	{ label: "T", data: "\x14" },
];

const JUMP_HINTS: Record<TuiMode, Hint[]> = {
	regular: [
		{ label: "Home", data: "\x1b[H" },
		{ label: "End", data: "\x1b[F" },
	],
	fullscreen: [
		{ label: "Ctrl+Home", data: "\x1b[1;5H" },
		{ label: "Ctrl+End", data: "\x1b[1;5F" },
	],
};

const PEEK_HINT: Hint = { label: "Tab", data: "\t" };
const CUSTOM_HINT: Hint = { label: "Alt+C", data: "\x1b[99;3u" };
const META_HINT: Hint = { label: "Alt+M", data: "\x1b[109;3u" };

const DEFAULT_HINTS: Record<"up" | "down" | "confirm" | "cancel", string> = {
	up: "up",
	down: "down",
	confirm: "enter",
	cancel: "escape/ctrl+c",
};

export function filterLabel(
	theme: CopyMessageTheme,
	label: string,
	enabled: boolean,
	color: "accent" | "warning" | "dim",
): string {
	const text = `${label} ${enabled ? "✓" : "—"}`;
	return enabled ? theme.fg(color, text) : theme.fg("muted", text);
}

export function hotkeyHint(theme: CopyMessageTheme, text: string): string {
	return theme.fg("text", text);
}

function roleColor(theme: CopyMessageTheme, role: string, text: string): string {
	switch (roleLabel(role)) {
		case "user":
			return theme.fg("warning", text);
		case "assistant":
			return theme.fg("accent", text);
		case "tool":
		case "bash":
			return theme.fg("dim", text);
		default:
			return theme.fg("muted", text);
	}
}

function styleRoleText(
	theme: CopyMessageTheme,
	role: string,
	text: string,
	selected: boolean,
): string {
	return roleColor(theme, role, selected ? theme.bold(text) : text);
}

export function renderTitleLine(theme: CopyMessageTheme): string {
	return theme.bold(theme.fg("accent", "Copy message"));
}

export function renderEmptyListLine(theme: CopyMessageTheme, searching: boolean): string {
	const message = searching
		? "No messages match current filters and search."
		: "No messages visible with current filters.";
	return theme.fg("warning", message);
}

export function renderMessageLine(
	message: CopyableMessage,
	index: number,
	selected: boolean,
	view: ViewContext,
): string {
	const numberWidth = String(view.total).length;
	const number = `${String(index + 1).padStart(numberWidth)}.`;
	const arrow = selected ? view.theme.fg("accent", "→") : " ";
	const styledNumber = selected
		? view.theme.fg("accent", view.theme.bold(number))
		: view.theme.fg("dim", number);
	const role = styleRoleText(view.theme, message.role, roleLabel(message.role), selected);
	const time = view.theme.fg("muted", formatTime(message.timestamp));
	const separator = view.theme.fg("dim", "·");
	const meta = `${arrow} ${styledNumber} ${role} ${separator} ${time}`;
	const previewWidth = Math.max(0, view.width - visibleWidth(meta) - 2);
	const preview = truncateToWidth(compactPreview(message.text, 300), previewWidth, "…");
	const styledPreview = styleRoleText(view.theme, message.role, preview, selected);
	return preview === "" ? meta : `${meta}  ${styledPreview}`;
}

export function renderPeekLines(
	message: CopyableMessage,
	width: number,
	theme: CopyMessageTheme,
	format: CopyFormat,
): string[] {
	const contentWidth = Math.max(1, width - 2);
	let wrapped: string[] = [];
	let complete = false;
	// Wrap a growing prefix instead of the whole message. A cut prefix ends on visible text: styling
	// codes attached to a trailing whitespace run would make the wrapper break it into blank lines that
	// a full wrap drops. Greedy wrapping then changes only the prefix's last two wrapped lines, so stop
	// once those lines fall outside the visible window.
	for (let chars = PEEK_WRAP_CHARS; ; chars *= 2) {
		complete = chars >= message.text.length;
		const prefix = { ...message, text: complete ? message.text : message.text.slice(0, chars) };
		const text = safeDisplayText(formatMessageForCopy(prefix, format));
		const styled = styleRoleText(theme, message.role, complete ? text : text.trimEnd(), false);
		wrapped = wrapTextWithAnsi(styled, contentWidth);
		if (complete || wrapped.length >= MAX_PEEK_LINES + 2) {
			break;
		}
	}
	const shown = wrapped.slice(0, MAX_PEEK_LINES);
	const remaining = wrapped.length - shown.length;
	const kind = format === "metadata" ? "metadata" : "raw";
	const title = theme.fg("dim", `Peek ${kind} ${roleLabel(message.role)} message`);
	const lines = [title, ...shown.map((line) => `  ${line}`)];
	if (!complete) {
		lines.push(theme.fg("dim", "  … more wrapped lines"));
	} else if (remaining > 0) {
		const plural = remaining === 1 ? "line" : "lines";
		lines.push(theme.fg("dim", `  … ${remaining} more wrapped ${plural}`));
	}
	return lines;
}

export function bindingHint(
	keybindings: PickerKeybindings | undefined,
	action: "up" | "down" | "confirm" | "cancel",
): string {
	if (!keybindings) {
		return DEFAULT_HINTS[action];
	}
	const keys = keybindings.getKeys(`tui.select.${action}`);
	return keys.reduce(
		(shortest, key) => (visibleWidth(key) < visibleWidth(shortest) ? key : shortest),
		keys[0] ?? "unbound",
	);
}

/** A hint may only be shown for a key the picker still receives itself. */
function available(data: string, keybindings: PickerKeybindings | undefined): boolean {
	return !keybindings || !bound(data, keybindings);
}

function bound(data: string, keybindings: PickerKeybindings): boolean {
	return (
		keybindings.matches(data, "tui.select.up") ||
		keybindings.matches(data, "tui.select.down") ||
		keybindings.matches(data, "tui.select.pageUp") ||
		keybindings.matches(data, "tui.select.pageDown") ||
		keybindings.matches(data, "tui.select.confirm") ||
		keybindings.matches(data, "tui.select.cancel")
	);
}

function joinHints(hints: Array<string | undefined>): string {
	return hints.filter((hint) => hint !== undefined).join(" · ");
}

function optionalHints(view: ViewContext, hasCustomMessages: boolean): Array<string | undefined> {
	const keybindings = view.keybindings;
	// Narrow layouts drop the search hint first; jump hints follow the mode they are drawn in.
	const searchHint = view.width >= WIDE_LAYOUT_WIDTH ? "type search" : undefined;
	const jumps = JUMP_HINTS[view.tuiMode].filter((hint) => available(hint.data, keybindings));
	const jumpHint =
		jumps.length > 0 ? `${jumps.map((hint) => hint.label).join("/")} jump` : undefined;
	const peek = available(PEEK_HINT.data, keybindings) ? `${PEEK_HINT.label} peek` : undefined;
	const filters = FILTER_HINTS.filter((hint) => available(hint.data, keybindings));
	const filterHint =
		filters.length > 0 ? `${filters.map((hint) => hint.label).join("/")} filters` : undefined;
	const custom =
		hasCustomMessages && available(CUSTOM_HINT.data, keybindings)
			? `${CUSTOM_HINT.label} custom`
			: undefined;
	const meta = available(META_HINT.data, keybindings) ? `${META_HINT.label} meta` : undefined;
	return [searchHint, jumpHint, peek, filterHint, custom, meta];
}

export function helpLines(view: ViewContext, hasCustomMessages: boolean): string[] {
	const up = bindingHint(view.keybindings, "up");
	const down = bindingHint(view.keybindings, "down");
	const confirm = bindingHint(view.keybindings, "confirm");
	const cancel = bindingHint(view.keybindings, "cancel");
	const wide = view.width >= WIDE_LAYOUT_WIDTH;
	const core = wide
		? [`${up} older`, `${down} newer`, `${confirm} copy`, `${cancel} cancel`]
		: [`${up}/${down} nav`, `${confirm} copy`, `${cancel} cancel`];

	if (visibleWidth(joinHints(core)) > view.width) {
		return wrapHints(
			[`${up} older`, `${down} newer`, `${confirm} copy`, `${cancel} cancel`],
			view.width,
		);
	}

	const optional: string[] = [];
	for (const hint of optionalHints(view, hasCustomMessages)) {
		if (
			hint !== undefined &&
			visibleWidth(joinHints([...optional, hint, ...core])) <= view.width
		) {
			optional.push(hint);
		}
	}
	return [joinHints([...optional, ...core])];
}

function wrapHints(hints: string[], width: number): string[] {
	const lines: string[] = [];
	for (const hint of hints) {
		const candidate = joinHints([lines.at(-1), hint]);
		if (lines.length === 0 || visibleWidth(candidate) > width) {
			lines.push(hint);
		} else {
			lines[lines.length - 1] = candidate;
		}
	}
	return lines;
}

export function renderFooterLine(
	view: ViewContext,
	parts: { position: string; filters: string[]; search: string; format: string },
): string {
	return [
		view.theme.fg("dim", `(${parts.position})`),
		...parts.filters,
		parts.search,
		parts.format,
	].join(" · ");
}
