import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyToClipboard, type ExtensionAPI, type ExtensionCommandContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, TuiMode } from "@earendil-works/pi-tui";
import { decodeKittyPrintable, getNativeClipboard, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TuiMouseEvent } from "@earendil-works/pi-tui";

const MAX_VISIBLE_MESSAGES = 8;
const MAX_PEEK_LINES = 16;

export type CopyFormat = "raw" | "metadata";

export interface CopyableMessage {
	id: string;
	role: string;
	timestamp?: string;
	text: string;
}

type CopyMessageTheme = Parameters<Parameters<ExtensionCommandContext["ui"]["custom"]>[0]>[1];

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.filter((part): part is { type: string; text: string } => {
			return (
				part !== null &&
				typeof part === "object" &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				"text" in part &&
				typeof (part as { text?: unknown }).text === "string"
			);
		})
		.map((part) => part.text)
		.join("");
}

function textFromMessage(message: Record<string, unknown>): string {
	const role = message.role;

	if (role === "bashExecution") {
		const command = typeof message.command === "string" ? message.command : "";
		const output = typeof message.output === "string" ? message.output : "";
		return command ? `$ ${command}\n${output}`.trimEnd() : output;
	}

	if (role === "branchSummary") {
		return typeof message.summary === "string" ? message.summary : "";
	}

	if (role === "compactionSummary") {
		return typeof message.summary === "string" ? message.summary : "";
	}

	return textFromContent(message.content);
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function splitGraphemes(text: string): string[] {
	return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

function truncateGraphemes(text: string, max: number): string {
	if (max <= 0) return "";
	const graphemes = splitGraphemes(text);
	if (graphemes.length <= max) return text;
	if (max === 1) return "…";
	return `${graphemes.slice(0, max - 1).join("")}…`;
}

function safeDisplayText(text: string): string {
	return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

function compactPreview(text: string, max = 96): string {
	const preview = safeDisplayText(text).replace(/\s+/gu, " ").trim();
	return truncateGraphemes(preview, max);
}

function roleLabel(role: string): string {
	switch (role) {
		case "assistant":
			return "assistant";
		case "user":
			return "user";
		case "toolResult":
			return "tool";
		case "bashExecution":
			return "bash";
		case "custom":
			return "custom";
		case "branchSummary":
			return "branch-summary";
		case "compactionSummary":
			return "compaction";
		default:
			return safeDisplayText(role).replace(/\s+/gu, " ").trim() || "message";
	}
}

function formatTime(timestamp: unknown): string {
	if (typeof timestamp !== "string") return "";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function entryToCopyableMessage(entry: unknown): CopyableMessage | undefined {
	if (entry === null || typeof entry !== "object") return undefined;
	const record = entry as Record<string, unknown>;
	let role: string;
	let text: string;

	if (record.type === "message" && record.message !== null && typeof record.message === "object") {
		const message = record.message as Record<string, unknown>;
		role = typeof message.role === "string" ? message.role : "message";
		if (role === "custom" && message.display !== true) return undefined;
		text = textFromMessage(message);
	} else if (record.type === "branch_summary" || record.type === "compaction") {
		role = record.type === "branch_summary" ? "branchSummary" : "compactionSummary";
		text = typeof record.summary === "string" ? record.summary : "";
	} else if (record.type === "custom_message" && record.display === true) {
		role = "custom";
		text = textFromContent(record.content);
	} else {
		return undefined;
	}

	if (!text.trim()) return undefined;
	return {
		id: typeof record.id === "string" ? record.id : "unknown",
		role,
		timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
		text,
	};
}

export function collectCopyableMessages(ctx: { sessionManager: { getBranch(): unknown[] } }): CopyableMessage[] {
	const entries: unknown[] = [];
	// Pi persists assistant snapshots separately and coalesces them within each context window.
	const responses = new Map<string, number>();
	for (const entry of ctx.sessionManager.getBranch()) {
		const record = entry as {
			type?: string;
			message?: { role?: string; responseId?: string; stopReason?: string; content?: unknown[] };
		} | null;
		if (record?.type === "context_window") responses.clear();
		const responseId =
			record?.type === "message" && record.message?.role === "assistant" && typeof record.message.responseId === "string"
				? record.message.responseId
				: undefined;
		const previous = responseId ? responses.get(responseId) : undefined;
		if (previous !== undefined) {
			const earlier = entries[previous] as typeof record;
			if (
				record?.message?.stopReason !== "pending" ||
				(earlier?.message?.stopReason === "pending" && (earlier.message.content?.length ?? 0) <= (record.message.content?.length ?? 0))
			) entries[previous] = entry;
			continue;
		}
		if (responseId) responses.set(responseId, entries.length);
		entries.push(entry);
	}

	return entries.flatMap((entry) => {
		const message = entryToCopyableMessage(entry);
		return message ? [message] : [];
	});
}

function collectProjectedMessages(ctx: ExtensionCommandContext): CopyableMessage[] {
	const entries = ctx.sessionManager.buildSessionProjection().entries.flatMap(({ sourceEntry, messages }): unknown[] => {
		// Retain saved fork boundaries for legacy response-snapshot coalescing.
		if ((sourceEntry.type as string) === "context_window") return [sourceEntry];
		return messages
			.filter((message) => !(sourceEntry.type === "compaction" && message.role === "system"))
			.map((message) => ({ ...sourceEntry, type: "message", message }));
	});
	return collectCopyableMessages({ sessionManager: { getBranch: () => entries } });
}

export type MostRecentUserMessageResult =
	| { kind: "message"; message: CopyableMessage }
	| { kind: "no-user-message" }
	| { kind: "no-text" };

export function getMostRecentUserMessage(ctx: { sessionManager: { getBranch(): unknown[] } }): MostRecentUserMessageResult {
	const branch = ctx.sessionManager.getBranch();
	let sawUserMessage = false;

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry === null || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		if (record.type !== "message") continue;
		if (record.message === null || typeof record.message !== "object") continue;

		const message = record.message as Record<string, unknown>;
		if (message.role !== "user") continue;

		sawUserMessage = true;
		const text = textFromMessage(message);
		if (!text.trim()) continue;

		return {
			kind: "message",
			message: {
				id: typeof record.id === "string" ? record.id : "unknown",
				role: "user",
				timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
				text,
			},
		};
	}

	return sawUserMessage ? { kind: "no-text" } : { kind: "no-user-message" };
}

function isToolMessage(message: CopyableMessage): boolean {
	return message.role === "toolResult" || message.role === "bashExecution";
}

export interface MessageVisibility {
	showAssistant: boolean;
	showUser: boolean;
	showTools: boolean;
	showCustom: boolean;
}

function isVisibleMessage(message: CopyableMessage, visibility: MessageVisibility): boolean {
	if (isToolMessage(message)) return visibility.showTools;
	if (message.role === "assistant") return visibility.showAssistant;
	if (message.role === "user") return visibility.showUser;
	if (message.role === "custom") return visibility.showCustom;
	return true;
}

function messageSearchText(message: CopyableMessage): string {
	return [roleLabel(message.role), message.text].join(" ").toLowerCase();
}

function messageMatchesSearch(message: CopyableMessage, search: string): boolean {
	const terms = search
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (terms.length === 0) return true;
	const haystack = messageSearchText(message);
	const time = formatTime(message.timestamp).toLowerCase();
	return terms.every((term) => {
		if (term.startsWith("time:")) return time.includes(term.slice("time:".length));
		return haystack.includes(term);
	});
}

function filteredMessages(messages: CopyableMessage[], visibility: MessageVisibility, search = ""): CopyableMessage[] {
	return messages.filter((message) => isVisibleMessage(message, visibility) && messageMatchesSearch(message, search));
}

export function defaultVisibleMessages(messages: CopyableMessage[]): CopyableMessage[] {
	return filteredMessages(messages, { showAssistant: true, showUser: true, showTools: false, showCustom: true });
}

export function latestDefaultMessage(messages: CopyableMessage[]): CopyableMessage | undefined {
	return defaultVisibleMessages(messages).at(-1) ?? messages.at(-1);
}

export function messageByDefaultNumber(messages: CopyableMessage[], number: number): CopyableMessage | undefined {
	if (!Number.isInteger(number) || number < 1) return undefined;
	return defaultVisibleMessages(messages)[number - 1];
}

function formatMessageForCopy(message: CopyableMessage, format: CopyFormat): string {
	if (format === "raw") return message.text;
	const time = formatTime(message.timestamp);
	const label = roleLabel(message.role);
	return time ? `${label} at ${time}: ${message.text}` : `${label}: ${message.text}`;
}

function isPrintableSearchInput(data: string): boolean {
	return data.length > 0 && [...data].every((char) => {
		const code = char.charCodeAt(0);
		return code >= 32 && code !== 127 && !(code >= 0x80 && code <= 0x9f);
	});
}

function filterLabel(theme: CopyMessageTheme, label: string, enabled: boolean, color: "accent" | "warning" | "dim"): string {
	const text = `${label} ${enabled ? "✓" : "—"}`;
	return enabled ? theme.fg(color, text) : theme.fg("muted", text);
}

function hotkeyHint(theme: CopyMessageTheme, text: string): string {
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

function styleRoleText(theme: CopyMessageTheme, role: string, text: string, selected: boolean): string {
	return roleColor(theme, role, selected ? theme.bold(text) : text);
}

function renderMessageLine(
	message: CopyableMessage,
	index: number,
	total: number,
	width: number,
	selected: boolean,
	theme: CopyMessageTheme,
): string {
	const numberWidth = String(total).length;
	const arrow = selected ? theme.fg("accent", "→") : " ";
	const number = `${String(index + 1).padStart(numberWidth)}.`;
	const styledNumber = selected ? theme.fg("accent", theme.bold(number)) : theme.fg("dim", number);
	const role = styleRoleText(theme, message.role, roleLabel(message.role), selected);
	const time = theme.fg("muted", formatTime(message.timestamp));
	const separator = theme.fg("dim", "·");
	const meta = `${arrow} ${styledNumber} ${role} ${separator} ${time}`;
	const previewWidth = Math.max(0, width - visibleWidth(meta) - 2);
	const preview = truncateToWidth(compactPreview(message.text, 300), previewWidth, "…");
	const styledPreview = styleRoleText(theme, message.role, preview, selected);
	return preview ? `${meta}  ${styledPreview}` : meta;
}

function renderPeekLines(message: CopyableMessage, width: number, theme: CopyMessageTheme, format: CopyFormat): string[] {
	const contentWidth = Math.max(1, width - 2);
	const text = safeDisplayText(formatMessageForCopy(message, format));
	const wrapped = wrapTextWithAnsi(styleRoleText(theme, message.role, text, false), contentWidth);
	const shown = wrapped.slice(0, MAX_PEEK_LINES);
	const remaining = wrapped.length - shown.length;
	const title = theme.fg("dim", `Peek ${format === "metadata" ? "metadata" : "raw"} ${roleLabel(message.role)} message`);
	const lines = [title, ...shown.map((line) => `  ${line}`)];
	if (remaining > 0) lines.push(theme.fg("dim", `  … ${remaining} more wrapped line${remaining === 1 ? "" : "s"}`));
	return lines;
}

type PickerKeybindings = Pick<KeybindingsManager, "getKeys" | "matches">;

function bindingHint(keybindings: PickerKeybindings | undefined, action: "up" | "down" | "confirm" | "cancel"): string {
	const id = `tui.select.${action}` as const;
	if (!keybindings) return { up: "up", down: "down", confirm: "enter", cancel: "escape/ctrl+c" }[action];
	const keys = keybindings.getKeys(id);
	return keys.reduce((shortest, key) => visibleWidth(key) < visibleWidth(shortest) ? key : shortest, keys[0] ?? "unbound");
}

function helpLines(width: number, keybindings: PickerKeybindings | undefined, tuiMode: TuiMode, hasCustomMessages: boolean): string[] {
	const up = bindingHint(keybindings, "up");
	const down = bindingHint(keybindings, "down");
	const confirm = bindingHint(keybindings, "confirm");
	const cancel = bindingHint(keybindings, "cancel");
	const available = (data: string) =>
		!keybindings ||
		!(keybindings.matches(data, "tui.select.up") ||
			keybindings.matches(data, "tui.select.down") ||
			keybindings.matches(data, "tui.select.pageUp") ||
			keybindings.matches(data, "tui.select.pageDown") ||
			keybindings.matches(data, "tui.select.confirm") ||
			keybindings.matches(data, "tui.select.cancel"));
	const peek = available("\t") ? "Tab peek" : undefined;
	const filters = [
		{ hint: "U", data: "\x15" },
		{ hint: "A", data: "\x01" },
		{ hint: "T", data: "\x14" },
	].filter(({ data }) => available(data));
	const filterHint = filters.length > 0 ? `Ctrl+${filters.map(({ hint }) => hint).join("/")} filters` : undefined;
	const custom = hasCustomMessages && available("\x1b[99;3u") ? "Alt+C custom" : undefined;
	const meta = available("\x1b[109;3u") ? "Alt+M meta" : undefined;
	const jumps = (tuiMode === "fullscreen"
		? [
				{ hint: "Ctrl+Home", data: "\x1b[1;5H" },
				{ hint: "Ctrl+End", data: "\x1b[1;5F" },
			]
		: [
				{ hint: "Home", data: "\x1b[H" },
				{ hint: "End", data: "\x1b[F" },
			]).filter(({ data }) => available(data));
	const jumpHint = jumps.length > 0 ? `${jumps.map(({ hint }) => hint).join("/")} jump` : undefined;
	const join = (...hints: Array<string | undefined>) => hints.filter(Boolean).join(" · ");
	const core = width < 74 ? [`${up}/${down} nav`, `${confirm} copy`, `${cancel} cancel`] : [`${up} older`, `${down} newer`, `${confirm} copy`, `${cancel} cancel`];
	const optional: string[] = [];

	if (visibleWidth(join(...core)) > width) {
		const lines: string[] = [];
		for (const hint of [`${up} older`, `${down} newer`, `${confirm} copy`, `${cancel} cancel`]) {
			const candidate = join(lines.at(-1), hint);
			if (lines.length === 0 || visibleWidth(candidate) > width) lines.push(hint);
			else lines[lines.length - 1] = candidate;
		}
		return lines;
	}

	for (const hint of width < 74 ? [jumpHint, peek, filterHint, custom, meta] : ["type search", jumpHint, peek, filterHint, custom, meta]) {
		if (hint && visibleWidth(join(...optional, hint, ...core)) <= width) optional.push(hint);
	}

	return [join(...optional, ...core)];
}

type PickerInputResult = "copy" | "cancel" | "render" | "none";

export class CopyMessagePickerState {
	readonly visibility: MessageVisibility = {
		showAssistant: true,
		showUser: true,
		showTools: false,
		showCustom: true,
	};
	search = "";
	visibleMessages: CopyableMessage[];
	selectedIndex: number;
	format: CopyFormat;
	peek = false;
	private searchAnchorId: string | undefined;
	private readonly messages: CopyableMessage[];
	private firstVisibleIndex = 0;

	constructor(messages: CopyableMessage[], initialFormat: CopyFormat = "raw") {
		this.messages = messages;
		this.format = initialFormat;
		this.visibleMessages = filteredMessages(messages, this.visibility, this.search);
		this.selectedIndex = Math.max(0, this.visibleMessages.length - 1);
	}

	selectedMessage(): CopyableMessage | undefined {
		return this.visibleMessages[this.selectedIndex];
	}

	selectedCopyText(): string | undefined {
		const selected = this.selectedMessage();
		return selected ? formatMessageForCopy(selected, this.format) : undefined;
	}

	render(width: number, theme: CopyMessageTheme, keybindings?: PickerKeybindings, tuiMode: TuiMode = "regular"): string[] {
		const maxVisible = Math.min(this.visibleMessages.length, MAX_VISIBLE_MESSAGES);
		const start = maxVisible === 0 ? 0 : Math.max(0, Math.min(this.selectedIndex - maxVisible + 1, this.visibleMessages.length - maxVisible));
		const end = Math.min(this.visibleMessages.length, start + maxVisible);
		this.firstVisibleIndex = start;
		const hasCustomMessages = this.messages.some((message) => message.role === "custom");
		const userState = filterLabel(theme, "user", this.visibility.showUser, "warning");
		const assistantState = filterLabel(theme, "assistant", this.visibility.showAssistant, "accent");
		const toolState = filterLabel(theme, "tools", this.visibility.showTools, "dim");
		const searchState = this.search ? theme.fg("accent", `search “${this.search}”`) : theme.fg("dim", "type to filter");
		const formatState = theme.fg(this.format === "metadata" ? "accent" : "dim", this.format === "metadata" ? "copy metadata" : "copy raw");

		const lines = [theme.bold(theme.fg("accent", "Copy message")), ""];

		if (this.visibleMessages.length === 0) {
			lines.push(theme.fg("warning", this.search ? "No messages match current filters and search." : "No messages visible with current filters."));
		} else {
			for (let i = start; i < end; i++) {
				const message = this.visibleMessages[i];
				if (!message) continue;
				lines.push(renderMessageLine(message, i, this.visibleMessages.length, width, i === this.selectedIndex, theme));
			}
		}

		const selected = this.selectedMessage();
		if (this.peek && selected) {
			lines.push("");
			lines.push(...renderPeekLines(selected, width, theme, this.format));
		}

		const position = this.visibleMessages.length === 0 ? "0/0" : `${this.selectedIndex + 1}/${this.visibleMessages.length}`;
		const filters = [userState, assistantState, toolState];
		if (hasCustomMessages) filters.push(filterLabel(theme, "custom", this.visibility.showCustom, "dim"));
		lines.push([theme.fg("dim", `(${position})`), ...filters, searchState, formatState].join(" · "));
		lines.push("");
		lines.push(...helpLines(width, keybindings, tuiMode, hasCustomMessages).map((line) => hotkeyHint(theme, line)));
		lines.push("");
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	handleInput(data: string, keybindings?: PickerKeybindings): PickerInputResult {
		// Pi delivers each paste as one input wrapped in bracketed-paste markers.
		if (data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")) {
			const text = data.slice(6, -6).replace(/\s+/gu, " ");
			if (!isPrintableSearchInput(text)) return "none";
			this.setSearch(this.search + text);
			return "render";
		}
		if (keybindings?.matches(data, "tui.select.up")) {
			this.move(-1);
			return "render";
		}
		if (keybindings?.matches(data, "tui.select.down")) {
			this.move(1);
			return "render";
		}
		if (keybindings?.matches(data, "tui.select.pageUp")) {
			this.move(-MAX_VISIBLE_MESSAGES);
			return "render";
		}
		if (keybindings?.matches(data, "tui.select.pageDown")) {
			this.move(MAX_VISIBLE_MESSAGES);
			return "render";
		}
		if (keybindings?.matches(data, "tui.select.confirm")) {
			return this.visibleMessages.length > 0 ? "copy" : "none";
		}
		if (keybindings?.matches(data, "tui.select.cancel")) return "cancel";
		if (matchesKey(data, "ctrl+t")) {
			this.visibility.showTools = !this.visibility.showTools;
			this.refreshMessages();
			return "render";
		}
		if (matchesKey(data, "ctrl+a")) {
			this.visibility.showAssistant = !this.visibility.showAssistant;
			this.refreshMessages();
			return "render";
		}
		if (matchesKey(data, "ctrl+u")) {
			this.visibility.showUser = !this.visibility.showUser;
			this.refreshMessages();
			return "render";
		}
		if (matchesKey(data, "alt+c")) {
			this.visibility.showCustom = !this.visibility.showCustom;
			this.refreshMessages();
			return "render";
		}
		if (matchesKey(data, "alt+m")) {
			this.format = this.format === "raw" ? "metadata" : "raw";
			return "render";
		}
		if (matchesKey(data, "tab")) {
			this.peek = !this.peek;
			return "render";
		}
		if (matchesKey(data, "backspace") || data === "\x7f") {
			this.setSearch(splitGraphemes(this.search).slice(0, -1).join(""));
			return "render";
		}
		const printable = decodeKittyPrintable(data) ?? data;
		if (isPrintableSearchInput(printable)) {
			this.setSearch(this.search + printable);
			return "render";
		}
		if (!keybindings && matchesKey(data, "up")) {
			this.move(-1);
			return "render";
		}
		if (!keybindings && matchesKey(data, "down")) {
			this.move(1);
			return "render";
		}
		if (!keybindings && matchesKey(data, "pageUp")) {
			this.move(-MAX_VISIBLE_MESSAGES);
			return "render";
		}
		if (!keybindings && matchesKey(data, "pageDown")) {
			this.move(MAX_VISIBLE_MESSAGES);
			return "render";
		}
		if (matchesKey(data, "ctrl+pageUp")) {
			this.move(-MAX_VISIBLE_MESSAGES);
			return "render";
		}
		if (matchesKey(data, "ctrl+pageDown")) {
			this.move(MAX_VISIBLE_MESSAGES);
			return "render";
		}
		if (matchesKey(data, "ctrl+home")) {
			this.jumpToTop();
			return "render";
		}
		if (matchesKey(data, "ctrl+end")) {
			this.jumpToBottom();
			return "render";
		}
		if (matchesKey(data, "home")) {
			this.jumpToTop();
			return "render";
		}
		if (matchesKey(data, "end")) {
			this.jumpToBottom();
			return "render";
		}
		if (!keybindings && (matchesKey(data, "enter") || matchesKey(data, "return"))) {
			return this.visibleMessages.length > 0 ? "copy" : "none";
		}
		if (!keybindings && (matchesKey(data, "escape") || matchesKey(data, "ctrl+c"))) {
			return "cancel";
		}
		return "none";
	}

	handleMouse(event: TuiMouseEvent): PickerInputResult {
		if (event.type === "wheel" && event.wheelDelta) {
			this.move(event.wheelDelta < 0 ? -1 : 1);
			return "render";
		}
		if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) return "none";
		const row = event.y - 2; // The message list follows the title and spacer.
		if (row < 0 || row >= MAX_VISIBLE_MESSAGES) return "none";
		const index = this.firstVisibleIndex + row;
		if (!this.visibleMessages[index]) return "none";
		this.selectedIndex = index;
		return event.type === "click" ? "copy" : "render";
	}

	private refreshMessages(preferredId?: string) {
		const selectedId = preferredId ?? this.visibleMessages[this.selectedIndex]?.id;
		this.visibleMessages = filteredMessages(this.messages, this.visibility, this.search);
		const nextIndex = selectedId ? this.visibleMessages.findIndex((message) => message.id === selectedId) : -1;
		this.selectedIndex = nextIndex >= 0 ? nextIndex : Math.max(0, this.visibleMessages.length - 1);
	}

	private setSearch(nextSearch: string) {
		if (this.search.length === 0 && nextSearch.length > 0) {
			this.searchAnchorId = this.visibleMessages[this.selectedIndex]?.id;
		}

		this.search = nextSearch;

		if (this.search.length === 0) {
			const anchorId = this.searchAnchorId;
			this.searchAnchorId = undefined;
			this.refreshMessages(anchorId);
			return;
		}

		this.refreshMessages();
	}

	private move(delta: number) {
		if (this.visibleMessages.length === 0) return;
		this.selectedIndex = Math.max(0, Math.min(this.visibleMessages.length - 1, this.selectedIndex + delta));
	}

	private jumpToTop() {
		if (this.visibleMessages.length === 0) return;
		this.selectedIndex = 0;
	}

	private jumpToBottom() {
		if (this.visibleMessages.length === 0) return;
		this.selectedIndex = this.visibleMessages.length - 1;
	}
}

const COPY_METADATA_FLAGS = ["--with-meta", "--with-metadata", "--with-role"];
const COPY_LATEST_SELECTORS = ["latest", "last", "newest"];

type ParsedCopyMessageArgs = {
	format: CopyFormat;
	selector?: "latest" | { number: number };
};

function parseCopyArgs(args: string | undefined): ParsedCopyMessageArgs {
	const result: ParsedCopyMessageArgs = { format: "raw" };
	for (const token of (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
		if (COPY_METADATA_FLAGS.includes(token)) {
			result.format = "metadata";
			continue;
		}
		if (COPY_LATEST_SELECTORS.includes(token)) {
			result.selector = "latest";
			continue;
		}
		if (/^\d+$/.test(token)) {
			result.selector = { number: Number.parseInt(token, 10) };
		}
	}
	return result;
}

function copyArgumentCompletions(prefix: string, includeSelectors: boolean): AutocompleteItem[] | null {
	if (/^\d+$/.test(prefix)) return null;
	const candidates = includeSelectors ? [...COPY_LATEST_SELECTORS, ...COPY_METADATA_FLAGS] : COPY_METADATA_FLAGS;
	const normalized = prefix.toLowerCase();
	const items = candidates
		.filter((candidate) => candidate.startsWith(normalized))
		.map((candidate) => ({ value: candidate, label: candidate }));
	return items.length > 0 ? items : null;
}

async function pickMessage(ctx: ExtensionCommandContext, messages: CopyableMessage[], initialFormat: CopyFormat, signal: AbortSignal) {
	if (signal.aborted) return null;
	return ctx.ui.custom<{ message: CopyableMessage; text: string } | null>((tui, theme, keybindings, done) => {
		const state = new CopyMessagePickerState(messages, initialFormat);
		const abort = () => done(null);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
		const act = (result: PickerInputResult) => {
			if (result === "copy") {
				const selected = state.selectedMessage();
				const text = state.selectedCopyText();
				done(selected && text !== undefined ? { message: selected, text } : null);
			} else if (result === "cancel") done(null);
			else if (result === "render") tui.requestRender();
		};
		return {
			render(width: number) {
				return state.render(width, theme, keybindings, tui.mode);
			},
			invalidate() {},
			handleInput(data: string) { act(state.handleInput(data, keybindings)); },
			handleMouse(event) {
				const result = state.handleMouse(event);
				act(result);
				if (result !== "none") return { handled: true, focus: result === "render" };
			},
			dispose: () => signal.removeEventListener("abort", abort),
		};
	});
}

function copyNotificationText(selected: CopyableMessage): string {
	return `Copied ${roleLabel(selected.role)} message: “${compactPreview(selected.text, 48)}”`;
}

const runClipboardReader = promisify(execFile);

async function readCopiedText(expected: string): Promise<string | null | undefined> {
	if (process.platform !== "linux") {
		try {
			const text = await getNativeClipboard()?.getText();
			if (text !== undefined) return text;
		} catch {
			// The platform command fallback can still work if the native helper fails.
		}
	}
	const commands: [string, string[]][] = [];
	const windowsRead = ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Write((Get-Clipboard -Raw))"];
	if (process.platform === "darwin") commands.push(["pbpaste", []]);
	else if (process.platform === "win32") commands.push(["powershell", windowsRead]);
	else {
		if (process.env.TERMUX_VERSION) commands.push(["termux-clipboard-get", []]);
		if (process.env.WAYLAND_DISPLAY) commands.push(["wl-paste", ["--no-newline", "--type", "text"]]);
		if (process.env.DISPLAY) commands.push(["xclip", ["-selection", "clipboard", "-out"]], ["xsel", ["--clipboard", "--output"]]);
		if (!commands.length && (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)) commands.push(["powershell.exe", windowsRead]);
	}
	for (const [command, args] of commands) {
		try {
			const { stdout } = await runClipboardReader(command, args, {
				encoding: "utf8", timeout: 3000, maxBuffer: Math.max(1024 * 1024, Buffer.byteLength(expected) + 4096),
			});
			return stdout || null;
		} catch {
			// Try the next platform reader; never expose clipboard contents on failure.
		}
	}
	return undefined;
}

type Notify = ExtensionCommandContext["ui"]["notify"];

async function copySelectedMessage(notify: Notify, selected: CopyableMessage, text = selected.text) {
	try {
		await copyToClipboard(text);
		const actual = await readCopiedText(text);
		const remote = Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.MOSH_CONNECTION);
		if (actual === text && !remote) notify(copyNotificationText(selected), "info");
		else notify(
			actual === text ? "Local clipboard verified; remote terminal clipboard delivery is unverified."
				: "Clipboard command completed, but delivery could not be verified.",
			"warning",
		);
	} catch (error) {
		notify(error instanceof Error ? error.message : "Failed to copy to clipboard", "error");
	}
}

async function copyMostRecentUserMessage(ctx: Pick<ExtensionCommandContext, "sessionManager">, notify: Notify, format: CopyFormat) {
	const result = getMostRecentUserMessage(ctx);
	if (result.kind === "no-user-message") {
		notify("No user messages found", "warning");
		return;
	}
	if (result.kind === "no-text") {
		notify("No user message text found", "warning");
		return;
	}
	await copySelectedMessage(notify, result.message, formatMessageForCopy(result.message, format));
}

export default function copyMessageExtension(pi: Pick<ExtensionAPI, "registerCommand" | "on">) {
	let generation = 0;
	let pickerAbort: AbortController | undefined;
	const reset = () => {
		generation++;
		pickerAbort?.abort();
		pickerAbort = undefined;
	};
	pi.on("session_start", reset);
	pi.on("session_shutdown", reset);
	pi.on("session_tree", reset);
	const notifications = (ctx: ExtensionCommandContext): Notify => {
		const current = generation;
		return (message, type) => { if (current === generation) ctx.ui.notify(message, type); };
	};
	pi.registerCommand("copy-message", {
		description: "Select a session message and copy its text to the clipboard",
		getArgumentCompletions: (argumentPrefix) => copyArgumentCompletions(argumentPrefix, true),
		handler: async (args, ctx) => {
			const notify = notifications(ctx);
			const parsedArgs = parseCopyArgs(args);
			const messages = parsedArgs.selector === "latest" ? collectProjectedMessages(ctx) : collectCopyableMessages(ctx);
			if (messages.length === 0) {
				notify("No copyable messages found in the current branch", "error");
				return;
			}
			if (parsedArgs.selector === "latest") {
				const latestVisible = latestDefaultMessage(messages);
				if (latestVisible) await copySelectedMessage(notify, latestVisible, formatMessageForCopy(latestVisible, parsedArgs.format));
				return;
			}
			if (typeof parsedArgs.selector === "object") {
				const selected = messageByDefaultNumber(messages, parsedArgs.selector.number);
				if (!selected) {
					notify(`No default visible message #${parsedArgs.selector.number} (found ${defaultVisibleMessages(messages).length})`, "warning");
					return;
				}
				await copySelectedMessage(notify, selected, formatMessageForCopy(selected, parsedArgs.format));
				return;
			}
			if (ctx.mode !== "tui") {
				notify("/copy-message requires interactive TUI mode unless you pass latest/last/newest or a message number", "error");
				return;
			}
			pickerAbort?.abort();
			const controller = new AbortController();
			pickerAbort = controller;
			try {
				const selected = await pickMessage(ctx, messages, parsedArgs.format, controller.signal);
				if (!selected || controller.signal.aborted) return;
				await copySelectedMessage(notify, selected.message, selected.text);
			} finally {
				if (pickerAbort === controller) pickerAbort = undefined;
			}
		},
	});
	pi.registerCommand("copy-user", {
		description: "Copy the most recent user message to the clipboard",
		getArgumentCompletions: (argumentPrefix) => copyArgumentCompletions(argumentPrefix, false),
		handler: async (args, ctx) => {
			await copyMostRecentUserMessage(ctx, notifications(ctx), parseCopyArgs(args).format);
		},
	});
}
