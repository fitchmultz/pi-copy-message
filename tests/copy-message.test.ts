import assert from "node:assert/strict";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type KeyId, visibleWidth } from "@earendil-works/pi-tui";

import extension, {
	collectCopyableMessages,
	copyArgumentCompletions,
	CopyMessagePickerState,
	defaultVisibleMessages,
	type CopyableMessage,
	filteredMessages,
	formatMessageForCopy,
	getMostRecentUserMessage,
	latestDefaultMessage,
	messageByDefaultNumber,
} from "../extensions/copy-message.ts";

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

const captureRegisteredCommands = () => {
	const commands = new Map<string, CommandOptions>();
	const pi: Pick<ExtensionAPI, "registerCommand"> = {
		registerCommand: (name, options) => {
			commands.set(name, options);
		},
	};

	extension(pi);
	return commands;
};

const copyableMessage = (id: string, role: string, text: string, minute: number): CopyableMessage => ({
	id,
	role,
	text,
	timestamp: new Date(Date.UTC(2026, 5, 7, 0, minute)).toISOString(),
});

const press = (state: CopyMessagePickerState, keys: string) => {
	for (const key of keys) state.handleInput(key);
};

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

const registrations = captureRegisteredCommands();
assert.deepEqual([...registrations.keys()], ["copy-message", "copy-user"]);
assert.equal(registrations.get("copy-user")?.description, "Copy the most recent user message to the clipboard");
assert.equal(typeof registrations.get("copy-user")?.handler, "function");
assert.equal(registrations.get("copy-message")?.description, "Select a session message and copy its text to the clipboard");
assert.equal(typeof registrations.get("copy-message")?.handler, "function");

{
	// argument completion helper
	assert.deepEqual(copyArgumentCompletions("", true), [
		{ value: "latest", label: "latest" },
		{ value: "last", label: "last" },
		{ value: "newest", label: "newest" },
		{ value: "--with-meta", label: "--with-meta" },
		{ value: "--with-metadata", label: "--with-metadata" },
		{ value: "--with-role", label: "--with-role" },
	]);
	assert.deepEqual(copyArgumentCompletions("la", true), [
		{ value: "latest", label: "latest" },
		{ value: "last", label: "last" },
	]);
	assert.deepEqual(copyArgumentCompletions("--with-r", true), [{ value: "--with-role", label: "--with-role" }]);
	assert.deepEqual(copyArgumentCompletions("new", true), [{ value: "newest", label: "newest" }]);
	assert.deepEqual(copyArgumentCompletions("5", true), null);
	assert.deepEqual(copyArgumentCompletions("zzz", true), null);
	assert.deepEqual(copyArgumentCompletions("", false), [
		{ value: "--with-meta", label: "--with-meta" },
		{ value: "--with-metadata", label: "--with-metadata" },
		{ value: "--with-role", label: "--with-role" },
	]);
	assert.deepEqual(copyArgumentCompletions("la", false), null);
	assert.deepEqual(copyArgumentCompletions("latest", false), null);

	// wired onto both registered commands
	assert.equal(typeof registrations.get("copy-message")?.getArgumentCompletions, "function");
	assert.equal(typeof registrations.get("copy-user")?.getArgumentCompletions, "function");
	assert.deepEqual(registrations.get("copy-message")?.getArgumentCompletions?.("la"), [
		{ value: "latest", label: "latest" },
		{ value: "last", label: "last" },
	]);
	assert.deepEqual(registrations.get("copy-user")?.getArgumentCompletions?.("--with-meta"), [
		{ value: "--with-meta", label: "--with-meta" },
		{ value: "--with-metadata", label: "--with-metadata" },
	]);
	assert.deepEqual(registrations.get("copy-user")?.getArgumentCompletions?.("latest"), null);
}

const mixedBranch = {
	sessionManager: {
		getBranch: () => [
			{ type: "message", id: "u0", timestamp: "2026-06-07T00:00:00.000Z", message: { role: "user", content: "raw user text" } },
			{
				type: "message",
				id: "a0",
				timestamp: "2026-06-07T00:01:00.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "raw assistant text" }] },
			},
			{ type: "message", id: "empty", timestamp: "2026-06-07T00:02:00.000Z", message: { role: "assistant", content: "   " } },
			{ type: "message", id: "legacy-visible", message: { role: "custom", display: true, content: "visible legacy custom message" } },
			{ type: "message", id: "legacy-hidden-false", message: { role: "custom", display: false, content: "hidden legacy custom message" } },
			{ type: "message", id: "legacy-hidden-missing", message: { role: "custom", content: "hidden legacy custom message" } },
			{ type: "branch_summary", id: "b0", timestamp: "2026-06-07T00:03:00.000Z", summary: "branch summary text" },
			{ type: "compaction", id: "c0", timestamp: "2026-06-07T00:04:00.000Z", summary: "compaction summary text" },
			{
				type: "custom_message",
				id: "m0",
				timestamp: "2026-06-07T00:05:00.000Z",
				display: true,
				content: [{ type: "text", text: "visible custom message text" }],
			},
			{ type: "custom_message", id: "hidden-false", display: false, content: "hidden custom message" },
			{ type: "custom_message", id: "hidden-missing", content: "hidden custom message" },
			{ type: "custom", id: "ignored" },
		],
	},
};

assert.deepEqual(collectCopyableMessages(mixedBranch), [
	{ id: "u0", role: "user", timestamp: "2026-06-07T00:00:00.000Z", text: "raw user text" },
	{ id: "a0", role: "assistant", timestamp: "2026-06-07T00:01:00.000Z", text: "raw assistant text" },
	{ id: "legacy-visible", role: "custom", timestamp: undefined, text: "visible legacy custom message" },
	{ id: "b0", role: "branchSummary", timestamp: "2026-06-07T00:03:00.000Z", text: "branch summary text" },
	{ id: "c0", role: "compactionSummary", timestamp: "2026-06-07T00:04:00.000Z", text: "compaction summary text" },
	{ id: "m0", role: "custom", timestamp: "2026-06-07T00:05:00.000Z", text: "visible custom message text" },
]);

assert.deepEqual(getMostRecentUserMessage(mixedBranch), {
	kind: "message",
	message: { id: "u0", role: "user", timestamp: "2026-06-07T00:00:00.000Z", text: "raw user text" },
});

assert.deepEqual(
	getMostRecentUserMessage({
		sessionManager: {
			getBranch: () => [
				{ type: "message", id: "u0", timestamp: "2026-06-07T00:00:00.000Z", message: { role: "user", content: "older text" } },
				{ type: "message", id: "u1", timestamp: "2026-06-07T00:01:00.000Z", message: { role: "user", content: "   " } },
			],
		},
	}),
	{
		kind: "message",
		message: { id: "u0", role: "user", timestamp: "2026-06-07T00:00:00.000Z", text: "older text" },
	},
);

assert.deepEqual(
	getMostRecentUserMessage({
		sessionManager: {
			getBranch: () => [{ type: "message", id: "u0", timestamp: "2026-06-07T00:00:00.000Z", message: { role: "user", content: "   " } }],
		},
	}),
	{ kind: "no-text" },
);

assert.deepEqual(
	getMostRecentUserMessage({
		sessionManager: {
			getBranch: () => [{ type: "message", id: "a0", timestamp: "2026-06-07T00:00:00.000Z", message: { role: "assistant", content: "reply" } }],
		},
	}),
	{ kind: "no-user-message" },
);

{
	const messages = [
		copyableMessage("a0", "assistant", "raw assistant message", 0),
		copyableMessage("t0", "toolResult", "raw newest tool message", 1),
	];
	assert.equal(latestDefaultMessage(messages)?.text, "raw assistant message");
	assert.equal(latestDefaultMessage([copyableMessage("t0", "toolResult", "only tool message", 0)])?.text, "only tool message");
}

{
	const messages = [
		copyableMessage("u0", "user", "first user", 0),
		copyableMessage("t0", "toolResult", "hidden tool", 1),
		copyableMessage("a0", "assistant", "second assistant", 2),
	];
	assert.deepEqual(defaultVisibleMessages(messages).map((message) => message.id), ["u0", "a0"]);
	assert.equal(messageByDefaultNumber(messages, 1)?.id, "u0");
	assert.equal(messageByDefaultNumber(messages, 2)?.id, "a0");
	assert.equal(messageByDefaultNumber(messages, 3), undefined);
}

{
	const messages = [
		copyableMessage("u0", "user", "alpha user text", 0),
		copyableMessage("a0", "assistant", "beta assistant text", 1),
		copyableMessage("a1", "assistant", "gamma final answer", 2),
		copyableMessage("t0", "toolResult", "delta tool text", 3),
	];

	assert.deepEqual(
		filteredMessages(messages, { showAssistant: true, showUser: true, showTools: false }).map((message) => message.id),
		["u0", "a0", "a1"],
	);
	assert.deepEqual(
		filteredMessages(messages, { showAssistant: false, showUser: true, showTools: true }, "delta").map((message) => message.id),
		["t0"],
	);
	assert.deepEqual(
		filteredMessages([copyableMessage("u0", "user", "alpha", 0)], { showAssistant: true, showUser: true, showTools: true }, "00").map(
			(message) => message.id,
		),
		[],
	);
	assert.deepEqual(
		filteredMessages([copyableMessage("u0", "user", "alpha", 0)], { showAssistant: true, showUser: true, showTools: true }, "time:00").map(
			(message) => message.id,
		),
		["u0"],
	);
}

{
	const messages = [
		copyableMessage("u0", "user", "alpha user text", 0),
		copyableMessage("a0", "assistant", "beta assistant text", 1),
		copyableMessage("a1", "assistant", "gamma final answer", 2),
		copyableMessage("t0", "toolResult", "delta tool text", 3),
	];
	const state = new CopyMessagePickerState(messages);

	assert.equal(state.visibility.showUser, true);
	assert.equal(state.visibility.showAssistant, true);
	assert.equal(state.visibility.showTools, false);
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["u0", "a0", "a1"]);

	press(state, "beta");
	assert.equal(state.search, "beta");
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["a0"]);

	press(state, "\x7f\x7f\x7f\x7f");
	assert.equal(state.search, "");
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["u0", "a0", "a1"]);

	assert.equal(state.handleInput("\x01"), "render");
	assert.equal(state.visibility.showAssistant, false);
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["u0"]);

	assert.equal(state.handleInput("\x01"), "render");
	press(state, "gamma");
	assert.equal(state.selectedMessage()?.text, "gamma final answer");
	assert.equal(state.handleInput("\x1bm"), "render");
	assert.equal(state.format, "metadata");
	assert.match(state.selectedCopyText() ?? "", /^assistant at .*: gamma final answer$/);
	assert.equal(state.handleInput("\t"), "render");
	assert.equal(state.peek, true);
	assert.ok(state.render(60, plainTheme).some((line) => line.includes("Peek metadata assistant message")));
	assert.equal(state.handleInput("\r"), "copy");
}

{
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const hints60 = state.render(60, plainTheme).at(-2) ?? "";
	const hints80 = state.render(80, plainTheme).at(-2) ?? "";

	assert.ok(hints60.length <= 60);
	assert.match(hints60, /up\/down nav/);
	assert.match(hints60, /enter copy/);
	assert.match(hints60, /escape\/ctrl\+c cancel/);
	assert.match(hints60, /Tab peek/);
	assert.doesNotMatch(hints60, /type search|Home\/End jump|filters|Alt\+M meta/);

	assert.ok(hints80.length <= 80);
	assert.match(hints80, /up older · down newer/);
	assert.match(hints80, /enter copy/);
	assert.match(hints80, /escape\/ctrl\+c cancel/);
	assert.match(hints80, /type search/);
	assert.doesNotMatch(hints80, /Home\/End jump|Tab peek|filters|Alt\+M meta/);
}

{
	const state = new CopyMessagePickerState([
		copyableMessage("u0", "user", "first", 0),
		copyableMessage("a0", "assistant", "second", 1),
	]);
	const inputs = {
		"tui.select.up": "\x14",
		"tui.select.down": "\x01",
		"tui.select.confirm": "\t",
		"tui.select.cancel": "\x1bm",
	} as const;
	const keyHints = {
		"tui.select.up": "ctrl+t",
		"tui.select.down": "ctrl+a",
		"tui.select.confirm": "tab",
		"tui.select.cancel": "alt+m",
	} as const;
	const keybindings = {
		matches: (data: string, id: keyof typeof inputs) => data === inputs[id],
		getKeys: (id: keyof typeof keyHints) => [keyHints[id]],
	} as never;

	assert.equal(state.handleInput("\x1b[A", keybindings), "none");
	assert.equal(state.handleInput("\x14", keybindings), "render");
	assert.equal(state.selectedMessage()?.id, "u0");
	assert.equal(state.visibility.showTools, false);
	assert.equal(state.handleInput("\x01", keybindings), "render");
	assert.equal(state.selectedMessage()?.id, "a0");
	assert.equal(state.visibility.showAssistant, true);
	assert.equal(state.handleInput("\t", keybindings), "copy");
	assert.equal(state.peek, false);
	assert.equal(state.handleInput("\x1bm", keybindings), "cancel");
	assert.equal(state.format, "raw");

	const hints60 = state.render(60, plainTheme, keybindings).at(-2) ?? "";
	const hints80 = state.render(80, plainTheme, keybindings).at(-2) ?? "";
	for (const [width, hints] of [
		[60, hints60],
		[80, hints80],
	] as const) {
		assert.ok(hints.length <= width);
		assert.match(hints, /ctrl\+t/);
		assert.match(hints, /ctrl\+a/);
		assert.match(hints, /tab copy/);
		assert.match(hints, /alt\+m cancel/);
		assert.doesNotMatch(hints, /Tab peek|Ctrl\+[^·]*[AT][^·]* filters|Alt\+M meta|↑|↓|Enter|Esc/);
	}
	assert.match(hints60, /Home\/End jump/);
	assert.doesNotMatch(hints60, /type search|Ctrl\+U filters/);
	assert.match(hints80, /type search/);
	assert.doesNotMatch(hints80, /Home\/End jump|Ctrl\+U filters/);
}

{
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const keys = {
		"tui.select.up": ["up", "ctrl+p", "alt+k"],
		"tui.select.down": ["down", "ctrl+n", "alt+j"],
		"tui.select.confirm": ["enter", "space"],
		"tui.select.cancel": ["escape", "ctrl+c"],
	} as const;
	const keybindings = {
		matches: () => false,
		getKeys: (id: keyof typeof keys) => [...keys[id]],
	} as never;

	for (const width of [60, 80]) {
		const hints = state.render(width, plainTheme, keybindings).at(-2) ?? "";
		assert.ok(hints.length <= width);
		assert.match(hints, /up/);
		assert.match(hints, /down/);
		assert.match(hints, /enter copy/);
		assert.match(hints, /escape cancel/);
	}
}

{
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const keys = {
		"tui.select.up": ["ctrl+shift+alt+super+backspace"],
		"tui.select.down": ["shift+ctrl+alt+super+backspace"],
		"tui.select.confirm": ["alt+super+shift+ctrl+backspace"],
		"tui.select.cancel": ["super+alt+shift+ctrl+backspace"],
	} as const satisfies Record<string, readonly KeyId[]>;
	const keybindings = {
		matches: () => false,
		getKeys: (id: keyof typeof keys) => [...keys[id]],
	} as never;

	for (const width of [60, 80]) {
		const lines = state.render(width, plainTheme, keybindings);
		const rendered = lines.join("\n");
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		assert.match(rendered, /ctrl\+shift\+alt\+super\+backspace older/);
		assert.match(rendered, /shift\+ctrl\+alt\+super\+backspace newer/);
		assert.match(rendered, /alt\+super\+shift\+ctrl\+backspace copy/);
		assert.match(rendered, /super\+alt\+shift\+ctrl\+backspace cancel/);
	}
}

{
	const messages = Array.from({ length: 5 }, (_, index) => copyableMessage(`a${index}`, "assistant", `raw assistant message ${index}`, index));
	const state = new CopyMessagePickerState(messages);

	assert.equal(state.selectedMessage()?.text, "raw assistant message 4");
	assert.equal(state.handleInput("\x1b[H"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 0");
	assert.equal(state.handleInput("\x1b[F"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 4");
}

{
	const messages = Array.from({ length: 12 }, (_, index) => copyableMessage(`a${index}`, "assistant", `raw assistant message ${index}`, index));
	const state = new CopyMessagePickerState(messages);

	state.handleInput("\x1b[A");
	state.handleInput("\x1b[A");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 9");
	press(state, "message 3");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 3");
	press(state, "\x7f\x7f\x7f\x7f\x7f\x7f\x7f\x7f\x7f");
	assert.equal(state.search, "");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 9");
}

{
	const message = copyableMessage("u0", "user", "raw user text", 0);
	assert.equal(formatMessageForCopy(message, "raw"), "raw user text");
	assert.match(formatMessageForCopy(message, "metadata"), /^user at .*: raw user text$/);
}
