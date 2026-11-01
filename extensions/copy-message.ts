import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type Notify, copyMostRecentUserMessage, copySelectedMessage } from "../src/clipboard.ts";
import { CopyMessagePickerState, type PickerInputResult } from "../src/picker-state.ts";
import {
	copyArgumentCompletions,
	parseCopyArgs,
	type ParsedCopyMessageArgs,
} from "../src/arguments.ts";
import {
	type CopyFormat,
	type CopyableMessage,
	collectCopyableMessages,
	defaultVisibleMessages,
	collectProjectedMessages,
	formatMessageForCopy,
	latestDefaultMessage,
	messageByDefaultNumber,
} from "../src/session-content.ts";

type PickResult = { message: CopyableMessage; text: string } | null;
type PickerComponent = Parameters<ExtensionCommandContext["ui"]["custom"]>[0];
type PickerHandles =
	Parameters<PickerComponent> extends [infer Tui, infer Theme, infer Kb, ...unknown[]]
		? { tui: Tui; theme: Theme; keybindings: Kb }
		: never;

/**
 * Session lifecycle for the picker. A replaced session, rebuilt tree, or shutdown invalidates earlier
 * commands: their notifications are dropped and their open picker is cancelled.
 */
class PickerSession {
	private generation = 0;
	private activePicker: AbortController | undefined;

	reset(): void {
		this.generation++;
		this.activePicker?.abort();
		this.activePicker = undefined;
	}

	notifications(ctx: ExtensionCommandContext): Notify {
		const current = this.generation;
		return (message, type) => {
			if (current === this.generation) {
				ctx.ui.notify(message, type);
			}
		};
	}

	/** Returns the controller for this picker, cancelling any picker still open from an earlier command. */
	beginPicker(): AbortController {
		this.activePicker?.abort();
		const controller = new AbortController();
		this.activePicker = controller;
		return controller;
	}

	endPicker(controller: AbortController): void {
		if (this.activePicker === controller) {
			this.activePicker = undefined;
		}
	}
}

function count(messages: CopyableMessage[]): number {
	return defaultVisibleMessages(messages).length;
}

function pickerComponent(
	state: CopyMessagePickerState,
	finish: (result: PickResult, defer?: boolean) => void,
	signal: AbortSignal,
	handles: PickerHandles,
): ReturnType<PickerComponent> {
	let settled = false;
	const settle = (result: PickResult, defer = false): void => {
		if (settled) {
			return;
		}
		settled = true;
		if (defer) {
			queueMicrotask(() => finish(result));
		} else {
			finish(result);
		}
	};
	const abort = (): void => settle(null);
	if (signal.aborted) {
		abort();
	} else {
		signal.addEventListener("abort", abort, { once: true });
	}
	const act = (result: PickerInputResult): void => {
		if (result === "copy") {
			const selected = state.selectedMessage();
			const text = state.selectedCopyText();
			settle(
				selected !== undefined && text !== undefined ? { message: selected, text } : null,
			);
		} else if (result === "cancel") {
			settle(null);
		} else if (result === "render") {
			handles.tui.requestRender();
		}
	};
	return {
		render(width) {
			return state.render(width, handles.theme, handles.keybindings, handles.tui.mode);
		},
		invalidate(): void {
			// The picker caches no render state; every line is rebuilt from current state on demand.
		},
		handleInput(data: string): void {
			act(state.handleInput(data, handles.keybindings));
		},
		handleMouse(event) {
			const result = state.handleMouse(event);
			act(result);
			if (result !== "none") {
				return { handled: true, focus: result === "render" };
			}
			return;
		},
		dispose(): void {
			signal.removeEventListener("abort", abort);
			// Settle even if disposal precedes session_shutdown. Defer the host callback: it can remove
			// this component from a live dialog-disposal iteration.
			settle(null, true);
		},
	};
}

async function pickMessage(
	ctx: ExtensionCommandContext,
	messages: CopyableMessage[],
	initialFormat: CopyFormat,
	signal: AbortSignal,
): Promise<PickResult> {
	if (signal.aborted) {
		return null;
	}
	return ctx.ui.custom<PickResult>((tui, theme, keybindings, done) =>
		pickerComponent(new CopyMessagePickerState(messages, initialFormat), done, signal, {
			tui,
			theme,
			keybindings,
		}),
	);
}

async function copySelectedBySelector(
	notify: Notify,
	messages: CopyableMessage[],
	selector: "latest" | { number: number },
	format: CopyFormat,
): Promise<void> {
	// The latest selector stays quiet when nothing matches; a requested number reports what was found.
	if (selector === "latest") {
		const latest = latestDefaultMessage(messages);
		if (latest !== undefined) {
			await copySelectedMessage(notify, latest, formatMessageForCopy(latest, format));
		}
		return;
	}
	const selected = messageByDefaultNumber(messages, selector.number);
	if (selected === undefined) {
		notify(
			`No default visible message #${selector.number} (found ${count(messages)})`,
			"warning",
		);
		return;
	}
	await copySelectedMessage(notify, selected, formatMessageForCopy(selected, format));
}

async function copyMessageCommand(
	session: PickerSession,
	parsed: ParsedCopyMessageArgs,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const notify = session.notifications(ctx);
	const messages =
		parsed.selector === "latest" ? collectProjectedMessages(ctx) : collectCopyableMessages(ctx);
	if (messages.length === 0) {
		notify("No copyable messages found in the current branch", "error");
		return;
	}
	if (parsed.selector !== undefined) {
		await copySelectedBySelector(notify, messages, parsed.selector, parsed.format);
		return;
	}
	if (ctx.mode !== "tui") {
		notify(
			"/copy-message requires interactive TUI mode unless you pass latest/last/newest or a message number",
			"error",
		);
		return;
	}
	const controller = session.beginPicker();
	try {
		const selected = await pickMessage(ctx, messages, parsed.format, controller.signal);
		if (selected === null || controller.signal.aborted) {
			return;
		}
		await copySelectedMessage(notify, selected.message, selected.text);
	} finally {
		session.endPicker(controller);
	}
}

export default function copyMessageExtension(
	pi: Pick<ExtensionAPI, "registerCommand" | "on">,
): void {
	const session = new PickerSession();
	pi.on("session_start", session.reset.bind(session));
	pi.on("session_shutdown", session.reset.bind(session));
	pi.on("session_tree", session.reset.bind(session));
	pi.registerCommand("copy-message", {
		description: "Select a session message and copy its text to the clipboard",
		getArgumentCompletions: (argumentPrefix) => copyArgumentCompletions(argumentPrefix, true),
		handler: async (args, ctx) => {
			await copyMessageCommand(session, parseCopyArgs(args), ctx);
		},
	});
	pi.registerCommand("copy-user", {
		description: "Copy the most recent user message to the clipboard",
		getArgumentCompletions: (argumentPrefix) => copyArgumentCompletions(argumentPrefix, false),
		handler: async (args, ctx) => {
			await copyMostRecentUserMessage(
				ctx,
				session.notifications(ctx),
				parseCopyArgs(args).format,
			);
		},
	});
}
