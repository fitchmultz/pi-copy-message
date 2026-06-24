import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

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
		.join("\n\n");
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

type SegmenterCtor = new (locale?: string, options?: { granularity?: "grapheme" }) => {
	segment(input: string): Iterable<{ segment: string }>;
};

function splitGraphemes(text: string): string[] {
	const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
	if (!Segmenter) return Array.from(text);
	return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
}

function truncateGraphemes(text: string, max: number): string {
	if (max <= 0) return "";
	const graphemes = splitGraphemes(text);
	if (graphemes.length <= max) return text;
	if (max === 1) return "…";
	return `${graphemes.slice(0, max - 1).join("")}…`;
}

function compactPreview(text: string, max = 96): string {
	const preview = text.replace(/\s+/gu, " ").trim();
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
			return role || "message";
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
	if (record.type !== "message") return undefined;
	if (record.message === null || typeof record.message !== "object") return undefined;

	const message = record.message as Record<string, unknown>;
	const role = typeof message.role === "string" ? message.role : "message";
	const text = textFromMessage(message);
	if (!text.trim()) return undefined;

	return {
		id: typeof record.id === "string" ? record.id : "unknown",
		role,
		timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
		text,
	};
}

export function collectCopyableMessages(ctx: { sessionManager: { getBranch(): unknown[] } }): CopyableMessage[] {
	return ctx.sessionManager.getBranch().flatMap((entry) => {
		const message = entryToCopyableMessage(entry);
		return message ? [message] : [];
	});
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

type ClipboardCommand = {
	name: string;
	args: string[];
	enabled: () => boolean;
};

const clipboardCommands: ClipboardCommand[] = [
	{ name: "pbcopy", args: [], enabled: () => process.platform === "darwin" },
	{ name: "termux-clipboard-set", args: [], enabled: () => Boolean(process.env.TERMUX_VERSION) },
	{ name: "wl-copy", args: [], enabled: () => true },
	{ name: "xclip", args: ["-selection", "clipboard"], enabled: () => true },
	{ name: "xsel", args: ["--clipboard", "--input"], enabled: () => true },
];

const CLIPBOARD_TIMEOUT_MS = 3000;
const commandExistsCache = new Map<string, boolean>();

function commandExists(command: string): boolean {
	const cached = commandExistsCache.get(command);
	if (cached !== undefined) return cached;

	const result = spawnSync("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command], {
		stdio: "ignore",
		timeout: CLIPBOARD_TIMEOUT_MS,
		killSignal: "SIGKILL",
	});
	const exists = result.status === 0;
	commandExistsCache.set(command, exists);
	return exists;
}

function copyWith(command: string, args: string[], text: string): boolean {
	const result = spawnSync(command, args, { input: text, encoding: "utf8", timeout: CLIPBOARD_TIMEOUT_MS, killSignal: "SIGKILL" });
	return !result.error && result.status === 0;
}

function copyToClipboard(text: string): string | undefined {
	const failedCommands: string[] = [];

	for (const command of clipboardCommands) {
		if (!command.enabled() || !commandExists(command.name)) continue;
		if (copyWith(command.name, command.args, text)) return undefined;
		failedCommands.push(command.name);
	}

	if (failedCommands.length > 0) {
		return `Clipboard command${failedCommands.length === 1 ? "" : "s"} failed (${failedCommands.join(", ")})`;
	}

	return "No clipboard command found (tried pbcopy, termux-clipboard-set, wl-copy, xclip, xsel)";
}

function isToolMessage(message: CopyableMessage): boolean {
	return message.role === "toolResult" || message.role === "bashExecution";
}

export interface MessageVisibility {
	showAssistant: boolean;
	showUser: boolean;
	showTools: boolean;
}

function isVisibleMessage(message: CopyableMessage, visibility: MessageVisibility): boolean {
	if (isToolMessage(message)) return visibility.showTools;
	if (message.role === "assistant") return visibility.showAssistant;
	if (message.role === "user") return visibility.showUser;
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

export function filteredMessages(messages: CopyableMessage[], visibility: MessageVisibility, search = ""): CopyableMessage[] {
	return messages.filter((message) => isVisibleMessage(message, visibility) && messageMatchesSearch(message, search));
}

export function defaultVisibleMessages(messages: CopyableMessage[]): CopyableMessage[] {
	return filteredMessages(messages, { showAssistant: true, showUser: true, showTools: false });
}

export function latestDefaultMessage(messages: CopyableMessage[]): CopyableMessage | undefined {
	return defaultVisibleMessages(messages).at(-1) ?? messages.at(-1);
}

export function messageByDefaultNumber(messages: CopyableMessage[], number: number): CopyableMessage | undefined {
	if (!Number.isInteger(number) || number < 1) return undefined;
	return defaultVisibleMessages(messages)[number - 1];
}

export function formatMessageForCopy(message: CopyableMessage, format: CopyFormat): string {
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
	const text = formatMessageForCopy(message, format);
	const wrapped = wrapTextWithAnsi(styleRoleText(theme, message.role, text, false), contentWidth);
	const shown = wrapped.slice(0, MAX_PEEK_LINES);
	const remaining = wrapped.length - shown.length;
	const title = theme.fg("dim", `Peek ${format === "metadata" ? "metadata" : "raw"} ${roleLabel(message.role)} message`);
	const lines = [title, ...shown.map((line) => `  ${line}`)];
	if (remaining > 0) lines.push(theme.fg("dim", `  … ${remaining} more wrapped line${remaining === 1 ? "" : "s"}`));
	return lines;
}

function helpLine(width: number): string {
	if (width < 48) return "↑↓ · Tab peek · Alt+M meta · Enter · Esc";
	if (width < 74) return "↑↓ nav · Home/End · Tab peek · Ctrl+U/A/T filters · Enter · Esc";
	return "type search · ↑↓ navigate · Home/End · Tab peek · Ctrl+U/A/T filters · Alt+M meta · Enter · Esc";
}

type PickerInputResult = "copy" | "cancel" | "render" | "none";

export class CopyMessagePickerState {
	readonly visibility: MessageVisibility = {
		showAssistant: true,
		showUser: true,
		showTools: false,
	};
	search = "";
	visibleMessages: CopyableMessage[];
	selectedIndex: number;
	format: CopyFormat;
	peek = false;
	private searchAnchorId: string | undefined;

	constructor(private readonly messages: CopyableMessage[], initialFormat: CopyFormat = "raw") {
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

	render(width: number, theme: CopyMessageTheme): string[] {
		const maxVisible = Math.min(this.visibleMessages.length, MAX_VISIBLE_MESSAGES);
		const start = maxVisible === 0 ? 0 : Math.max(0, Math.min(this.selectedIndex - maxVisible + 1, this.visibleMessages.length - maxVisible));
		const end = Math.min(this.visibleMessages.length, start + maxVisible);
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
		lines.push(`${theme.fg("dim", `(${position})`)} · ${userState} · ${assistantState} · ${toolState} · ${formatState} · ${searchState}`);
		lines.push("");
		lines.push(hotkeyHint(theme, helpLine(width)));
		lines.push("");
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	handleInput(data: string): PickerInputResult {
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
		if (matchesKey(data, "alt+m")) {
			this.format = this.format === "raw" ? "metadata" : "raw";
			return "render";
		}
		if (matchesKey(data, "tab")) {
			this.peek = !this.peek;
			return "render";
		}
		if (matchesKey(data, "backspace") || data === "\x7f") {
			this.setSearch(this.search.slice(0, -1));
			return "render";
		}
		if (isPrintableSearchInput(data)) {
			this.setSearch(this.search + data);
			return "render";
		}
		if (matchesKey(data, "up")) {
			this.move(-1);
			return "render";
		}
		if (matchesKey(data, "down")) {
			this.move(1);
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
		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			return this.visibleMessages.length > 0 ? "copy" : "none";
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			return "cancel";
		}
		return "none";
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

export function copyArgumentCompletions(prefix: string, includeSelectors: boolean): AutocompleteItem[] | null {
	if (/^\d+$/.test(prefix)) return null;
	const candidates = includeSelectors ? [...COPY_LATEST_SELECTORS, ...COPY_METADATA_FLAGS] : COPY_METADATA_FLAGS;
	const normalized = prefix.toLowerCase();
	const items = candidates
		.filter((candidate) => candidate.startsWith(normalized))
		.map((candidate) => ({ value: candidate, label: candidate }));
	return items.length > 0 ? items : null;
}

async function pickMessage(ctx: ExtensionCommandContext, messages: CopyableMessage[], initialFormat: CopyFormat) {
	return ctx.ui.custom<{ message: CopyableMessage; text: string } | null>((tui, theme, _keybindings, done) => {
		const state = new CopyMessagePickerState(messages, initialFormat);
		return {
			render(width: number) {
				return state.render(width, theme);
			},
			invalidate() {},
			handleInput(data: string) {
				const result = state.handleInput(data);
				if (result === "copy") {
					const selected = state.selectedMessage();
					const text = state.selectedCopyText();
					done(selected && text !== undefined ? { message: selected, text } : null);
					return;
				}
				if (result === "cancel") {
					done(null);
					return;
				}
				if (result === "render") tui.requestRender();
			},
		};
	});
}

function copyNotificationText(selected: CopyableMessage): string {
	return `Copied ${roleLabel(selected.role)} message: “${compactPreview(selected.text, 48)}”`;
}

function copySelectedMessage(ctx: Pick<ExtensionCommandContext, "ui">, selected: CopyableMessage, text = selected.text) {
	const error = copyToClipboard(text);
	if (error) {
		ctx.ui.notify(error, "error");
		return;
	}

	ctx.ui.notify(copyNotificationText(selected), "info");
}

function copyMostRecentUserMessage(ctx: Pick<ExtensionCommandContext, "sessionManager" | "ui">, format: CopyFormat) {
	const result = getMostRecentUserMessage(ctx);
	if (result.kind === "no-user-message") {
		ctx.ui.notify("No user messages found", "warning");
		return;
	}
	if (result.kind === "no-text") {
		ctx.ui.notify("No user message text found", "warning");
		return;
	}

	copySelectedMessage(ctx, result.message, formatMessageForCopy(result.message, format));
}

export default function copyMessageExtension(pi: Pick<ExtensionAPI, "registerCommand">) {
	pi.registerCommand("copy-message", {
		description: "Select a session message and copy its text to the clipboard",
		getArgumentCompletions: (argumentPrefix) => copyArgumentCompletions(argumentPrefix, true),
		handler: async (args, ctx) => {
			const parsedArgs = parseCopyArgs(args);
			const messages = collectCopyableMessages(ctx);
			if (messages.length === 0) {
				ctx.ui.notify("No copyable messages found in the current branch", "error");
				return;
			}

			if (parsedArgs.selector === "latest") {
				const latestVisible = latestDefaultMessage(messages);
				if (latestVisible) copySelectedMessage(ctx, latestVisible, formatMessageForCopy(latestVisible, parsedArgs.format));
				return;
			}

			if (typeof parsedArgs.selector === "object") {
				const selected = messageByDefaultNumber(messages, parsedArgs.selector.number);
				if (!selected) {
					ctx.ui.notify(`No default visible message #${parsedArgs.selector.number} (found ${defaultVisibleMessages(messages).length})`, "warning");
					return;
				}
				copySelectedMessage(ctx, selected, formatMessageForCopy(selected, parsedArgs.format));
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("/copy-message requires interactive TUI mode unless you pass latest/last/newest or a message number", "error");
				return;
			}

			const selected = await pickMessage(ctx, messages, parsedArgs.format);
			if (!selected) return;

			copySelectedMessage(ctx, selected.message, selected.text);
		},
	});

	pi.registerCommand("copy-user", {
		description: "Copy the most recent user message to the clipboard",
		getArgumentCompletions: (argumentPrefix) => copyArgumentCompletions(argumentPrefix, false),
		handler: async (args, ctx) => {
			copyMostRecentUserMessage(ctx, parseCopyArgs(args).format);
		},
	});
}
