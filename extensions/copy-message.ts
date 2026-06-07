import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_VISIBLE_MESSAGES = 8;

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

function compactPreview(text: string, max = 96): string {
	const preview = text.replace(/\s+/g, " ").trim();
	if (preview.length <= max) return preview;
	return `${preview.slice(0, max - 1)}…`;
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

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry === null || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		if (record.type !== "message") continue;
		if (record.message === null || typeof record.message !== "object") continue;

		const message = record.message as Record<string, unknown>;
		if (message.role !== "user") continue;

		const text = textFromMessage(message);
		if (!text.trim()) return { kind: "no-text" };

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

	return { kind: "no-user-message" };
}

function commandExists(command: string): boolean {
	const result = spawnSync("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command], { stdio: "ignore" });
	return result.status === 0;
}

function copyWith(command: string, args: string[], text: string): boolean {
	const result = spawnSync(command, args, { input: text, encoding: "utf8" });
	return !result.error && result.status === 0;
}

function copyToClipboard(text: string): string | undefined {
	if (process.platform === "darwin" && commandExists("pbcopy")) {
		return copyWith("pbcopy", [], text) ? undefined : "pbcopy failed";
	}

	if (process.env.TERMUX_VERSION && commandExists("termux-clipboard-set")) {
		return copyWith("termux-clipboard-set", [], text) ? undefined : "termux-clipboard-set failed";
	}

	if (commandExists("wl-copy")) {
		return copyWith("wl-copy", [], text) ? undefined : "wl-copy failed";
	}

	if (commandExists("xclip")) {
		return copyWith("xclip", ["-selection", "clipboard"], text) ? undefined : "xclip failed";
	}

	if (commandExists("xsel")) {
		return copyWith("xsel", ["--clipboard", "--input"], text) ? undefined : "xsel failed";
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
	return [roleLabel(message.role), formatTime(message.timestamp), message.text].join(" ").toLowerCase();
}

function messageMatchesSearch(message: CopyableMessage, search: string): boolean {
	const terms = search
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (terms.length === 0) return true;
	const haystack = messageSearchText(message);
	return terms.every((term) => haystack.includes(term));
}

export function filteredMessages(messages: CopyableMessage[], visibility: MessageVisibility, search = ""): CopyableMessage[] {
	return messages.filter((message) => isVisibleMessage(message, visibility) && messageMatchesSearch(message, search));
}

export function latestDefaultMessage(messages: CopyableMessage[]): CopyableMessage | undefined {
	return filteredMessages(messages, { showAssistant: true, showUser: true, showTools: false }).at(-1) ?? messages.at(-1);
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
	private searchAnchorId: string | undefined;

	constructor(private readonly messages: CopyableMessage[]) {
		this.visibleMessages = filteredMessages(messages, this.visibility, this.search);
		this.selectedIndex = Math.max(0, this.visibleMessages.length - 1);
	}

	selectedMessage(): CopyableMessage | undefined {
		return this.visibleMessages[this.selectedIndex];
	}

	render(width: number, theme: CopyMessageTheme): string[] {
		const maxVisible = Math.min(this.visibleMessages.length, MAX_VISIBLE_MESSAGES);
		const start = maxVisible === 0 ? 0 : Math.max(0, Math.min(this.selectedIndex - maxVisible + 1, this.visibleMessages.length - maxVisible));
		const end = Math.min(this.visibleMessages.length, start + maxVisible);
		const userState = filterLabel(theme, "user", this.visibility.showUser, "warning");
		const assistantState = filterLabel(theme, "assistant", this.visibility.showAssistant, "accent");
		const toolState = filterLabel(theme, "tools", this.visibility.showTools, "dim");
		const searchState = this.search ? theme.fg("accent", `search “${this.search}”`) : theme.fg("dim", "type to filter");

		const lines = [
			theme.bold(theme.fg("accent", "Copy raw message")),
			theme.fg("muted", "Newest is selected at bottom. Up goes back in time."),
			"",
		];

		if (this.visibleMessages.length === 0) {
			lines.push(theme.fg("warning", this.search ? "No messages match current filters and search." : "No messages visible with current filters."));
		} else {
			for (let i = start; i < end; i++) {
				const message = this.visibleMessages[i];
				if (!message) continue;
				lines.push(renderMessageLine(message, i, this.visibleMessages.length, width, i === this.selectedIndex, theme));
			}
		}

		const position = this.visibleMessages.length === 0 ? "0/0" : `${this.selectedIndex + 1}/${this.visibleMessages.length}`;
		lines.push(`${theme.fg("dim", `(${position})`)} · ${userState} · ${assistantState} · ${toolState} · ${searchState}`);
		lines.push("");
		lines.push(hotkeyHint(theme, "type search · Home/End jump · Ctrl+U/A/T filters · Enter copy · Esc cancel"));
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

async function pickMessage(ctx: ExtensionCommandContext, messages: CopyableMessage[]) {
	return ctx.ui.custom<CopyableMessage | null>((tui, theme, _keybindings, done) => {
		const state = new CopyMessagePickerState(messages);
		return {
			render(width: number) {
				return state.render(width, theme);
			},
			invalidate() {},
			handleInput(data: string) {
				const result = state.handleInput(data);
				if (result === "copy") {
					done(state.selectedMessage() ?? null);
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

function copySelectedMessage(ctx: Pick<ExtensionCommandContext, "ui">, selected: CopyableMessage) {
	const error = copyToClipboard(selected.text);
	if (error) {
		ctx.ui.notify(error, "error");
		return;
	}

	ctx.ui.notify(`Copied ${roleLabel(selected.role)} message`, "info");
}

function copyMostRecentUserMessage(ctx: Pick<ExtensionCommandContext, "sessionManager" | "ui">) {
	const result = getMostRecentUserMessage(ctx);
	if (result.kind === "no-user-message") {
		ctx.ui.notify("No user messages found", "warning");
		return;
	}
	if (result.kind === "no-text") {
		ctx.ui.notify("The most recent user message has no text to copy", "warning");
		return;
	}

	copySelectedMessage(ctx, result.message);
}

export default function copyMessageExtension(pi: Pick<ExtensionAPI, "registerCommand">) {
	pi.registerCommand("copy-user", {
		description: "Copy the most recent user message to the clipboard",
		handler: async (_args, ctx) => {
			copyMostRecentUserMessage(ctx);
		},
	});

	pi.registerCommand("copy-message", {
		description: "Select a session message and copy its raw text to the clipboard",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/copy-message requires interactive TUI mode", "error");
				return;
			}

			const messages = collectCopyableMessages(ctx);
			if (messages.length === 0) {
				ctx.ui.notify("No copyable messages found in the current branch", "error");
				return;
			}

			const trimmedArgs = (args ?? "").trim().toLowerCase();
			if (trimmedArgs === "last" || trimmedArgs === "latest" || trimmedArgs === "newest") {
				const latestVisible = latestDefaultMessage(messages);
				if (latestVisible) copySelectedMessage(ctx, latestVisible);
				return;
			}

			const selected = await pickMessage(ctx, messages);
			if (!selected) return;

			copySelectedMessage(ctx, selected);
		},
	});
}
