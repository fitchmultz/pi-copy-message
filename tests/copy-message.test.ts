import assert from "node:assert/strict";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import extension, {
	collectCopyableMessages,
	CopyMessagePickerState,
	type CopyableMessage,
	filteredMessages,
	latestDefaultMessage,
} from "../extensions/copy-message.ts";

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

const captureRegisteredCommand = () => {
	let registeredName: string | undefined;
	let registeredOptions: CommandOptions | undefined;
	const pi: Pick<ExtensionAPI, "registerCommand"> = {
		registerCommand: (name, options) => {
			registeredName = name;
			registeredOptions = options;
		},
	};

	extension(pi);

	assert.equal(registeredName, "copy-message");
	assert.ok(registeredOptions);
	return registeredOptions;
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

const registration = captureRegisteredCommand();
assert.equal(registration.description, "Select a session message and copy its raw text to the clipboard");
assert.equal(typeof registration.handler, "function");

assert.deepEqual(
	collectCopyableMessages({
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
				{ type: "custom", id: "ignored" },
			],
		},
	}),
	[
		{ id: "u0", role: "user", timestamp: "2026-06-07T00:00:00.000Z", text: "raw user text" },
		{ id: "a0", role: "assistant", timestamp: "2026-06-07T00:01:00.000Z", text: "raw assistant text" },
	],
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
	assert.equal(state.handleInput("\r"), "copy");
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
