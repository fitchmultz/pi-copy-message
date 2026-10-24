import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type KeyId, KeybindingsManager, setKittyProtocolActive, TUI_KEYBINDINGS, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import extension, {
	collectCopyableMessages,
	CopyMessagePickerState,
	defaultVisibleMessages,
	type CopyableMessage,
	getMostRecentUserMessage,
	latestDefaultMessage,
	messageByDefaultNumber,
} from "../extensions/copy-message.ts";

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

const captureRegisteredCommands = () => {
	const commands = new Map<string, CommandOptions>();
	const pi: Pick<ExtensionAPI, "registerCommand" | "on"> = {
		on: (() => () => {}) as ExtensionAPI["on"],
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

test("previews strip terminal control sequences", () => {
	const clipboardWrite = `\x1b]52;c;${Buffer.from("injected").toString("base64")}\x07`;
	const text = `Before ${clipboardWrite}after`;
	const state = new CopyMessagePickerState([copyableMessage("a0", "assistant", text, 0)]);

	assert.equal(state.selectedCopyText(), text);
	assert.doesNotMatch(state.render(120, plainTheme).join("\n"), /\x1b/);
	state.handleInput("\t");
	assert.doesNotMatch(state.render(120, plainTheme).join("\n"), /\x1b/);

	const unknownRole = `unrecognized\r${clipboardWrite}`;
	const messages = collectCopyableMessages({
		sessionManager: { getBranch: () => [{ type: "message", id: "a1", message: { role: unknownRole, content: "answer" } }] },
	});
	const roleState = new CopyMessagePickerState(messages);
	assert.ok(roleState.render(120, plainTheme).every((line) => !/[\x1b\r\n\t]/.test(line)));
});

test("picker previews retain full-split output at grapheme boundaries", () => {
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	const patterns = ["a", "e\u0301", "👨‍👩‍👧‍👦", "🇺🇸", "界", "\ud800", "\udc00", "a\r\nb", " a\t b ", "a\x1bb"];
	for (const pattern of patterns) {
		for (const length of [0, 1, 2, 48, 298, 299, 300, 301]) {
			const text = pattern.repeat(length);
			// The old full-split rule is the output oracle, after existing sanitization.
			const compact = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "").replace(/\s+/gu, " ").trim();
			const parts = Array.from(segmenter.segment(compact), (part) => part.segment);
			const preview = parts.length <= 300 ? compact : parts.slice(0, 299).join("") + "…";
			const message = copyableMessage("a0", "user", text, 0);
			const state = new CopyMessagePickerState([message]);
			const expected = new CopyMessagePickerState([{ ...message, text: preview }]);
			for (const width of [1, 44]) assert.deepEqual(state.render(width, plainTheme), expected.render(width, plainTheme));
			// A short sentinel keeps the wide oracle independent of candidate truncation,
			// especially when the original fits exactly at 300 graphemes.
			const template = new CopyMessagePickerState([{ ...message, text: "preview sentinel" }]);
			const wide = template.render(1000, plainTheme).map((line) => line.replace("  preview sentinel", preview ? "  " + preview : ""));
			assert.deepEqual(state.render(1000, plainTheme), wide);
			assert.equal(state.selectedCopyText(), text);
		}
	}
});

// #40: bound native peek work, not just the final displayed array.
test("Tab peek stops at overflow and retains native wrapping and complete copy text", (t) => {
	const text = "e\u0301👩‍💻🇺🇸界".repeat(2048);
	const expected = wrapTextWithAnsi(text, 42).slice(0, 16).map((line) => `  ${line}`);
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	const iterator = segmenter.segment("")[Symbol.iterator]();
	const prototype = Object.getPrototypeOf(iterator) as typeof iterator;
	const next = prototype.next;
	const counts = new Map<object, number>();
	t.mock.method(prototype, "next", function (this: typeof iterator) {
		const result = next.call(this);
		if (!result.done && result.value.input === text) counts.set(this, (counts.get(this) ?? 0) + 1);
		return result;
	});
	const state = new CopyMessagePickerState([copyableMessage("long", "user", text, 0)]);
	assert.equal(state.handleInput("\t"), "render");
	for (let redraw = 0; redraw < 2; redraw++) {
		counts.clear();
		const lines = state.render(44, plainTheme);
		const start = lines.indexOf("Peek raw user message") + 1;
		assert.ok(start > 0);
		assert.deepEqual(lines.slice(start, start + 16), expected);
		assert.match(lines[start + 16], /more/);
		assert.equal(state.selectedCopyText(), text);
		assert.ok(counts.size > 0, "observe real native segmentation");
		for (const count of counts.values()) assert.ok(count <= 42 * 17 + 1, `${count} yields exceeds the peek column window`);
	}
});

test("Tab peek bounds total native segmentation for low-column words", (t) => {
	const text = "\u0301 ".repeat(250);
	const expected = wrapTextWithAnsi(text, 198).slice(0, 16).map((line) => `  ${line}`);
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	const iterator = segmenter.segment("")[Symbol.iterator]();
	const prototype = Object.getPrototypeOf(iterator) as typeof iterator;
	const next = prototype.next;
	let yields = 0;
	t.mock.method(prototype, "next", function (this: typeof iterator) {
		const result = next.call(this);
		if (!result.done && result.value.input.length > 300 && result.value.input.startsWith("\u0301 ")) yields++;
		return result;
	});
	const state = new CopyMessagePickerState([copyableMessage("low-column", "user", text, 0)]);
	state.handleInput("\t");
	const lines = state.render(200, plainTheme);
	assert.deepEqual(lines.slice(5, 5 + expected.length), expected);
	assert.equal(state.selectedCopyText(), text);
	assert.ok(yields > 0, "observe actual native prefix segmentation");
	assert.ok(yields <= text.length * 16, `${yields} total yields exceeds the linear work window`);
});

test("peek reflows native word, whitespace, newline and grapheme boundaries", () => {
	const fixtures = [
		"short message", "x".repeat(4096), "word ".repeat(512),
		"lead" + " ".repeat(4096) + "tail", " ".repeat(4096) + "tail",
		"\t".repeat(4096) + "tail", "a\t b\u00a0".repeat(512),
		"\t".repeat(4096) + "界", "\u00a0".repeat(4096) + "界",
		"界" + "\t".repeat(4096) + "tail", "界" + "\u00a0".repeat(4096) + "tail",
		"e\u0301👩‍💻🇺🇸界".repeat(128), "👨‍👩‍👧‍👦 ".repeat(128),
		"\n".repeat(20), "\r\nline\rnext\n".repeat(20),
		"safe\x1b]52;c;payload\x07\r\n".repeat(20),
		"x\n".repeat(15) + "last", "x\n".repeat(16),
	];
	for (const text of fixtures) {
		const state = new CopyMessagePickerState([copyableMessage("one", "user", text, 0)]);
		state.handleInput("\t");
		for (const format of ["raw", "metadata"]) {
			if (format === "metadata") state.handleInput("\x1bm");
			const copied = state.selectedCopyText()!;
			const safe = copied.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
			for (const width of [4, 44, 100, 44]) {
				const wrapped = wrapTextWithAnsi(safe, Math.max(1, width - 2));
				const lines = state.render(width, plainTheme);
				const start = 5;
				assert.deepEqual(lines.slice(start, start + Math.min(16, wrapped.length)), wrapped.slice(0, 16).map((line) => truncateToWidth(`  ${line}`, width, "")), `${format}, width ${width}, fixture ${fixtures.indexOf(text)}`);
				if (wrapped.length > 16) assert.match(lines[start + 16], /…/);
			}
			assert.equal(state.selectedCopyText(), copied);
		}
	}
});

test("bracketed paste extends search without submitting", () => {
	const messages = [
		copyableMessage("a0", "assistant", "invoice 123", 0),
		copyableMessage("a1", "assistant", "unrelated newest answer", 1),
	];
	const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
	const state = new CopyMessagePickerState(messages);
	assert.equal(state.handleInput("\x1b[200~invoice\x1b[201~", keybindings), "render");
	assert.equal(state.search, "invoice");
	assert.equal(state.selectedCopyText(), "invoice 123");
	assert.equal(state.handleInput("\r", keybindings), "copy");

	// Pasting multiple lines adds search terms without submitting the picker.
	assert.equal(state.handleInput("\x1b[200~\r\n123\x1b[201~", keybindings), "render");
	assert.equal(state.search, "invoice 123");
	assert.equal(state.selectedCopyText(), "invoice 123");

	// Clipboard control characters must not trigger picker shortcuts.
	assert.equal(state.handleInput("\x1b[200~\x14\x1b[201~", keybindings), "none");
	assert.equal(state.visibility.showTools, false);
	assert.equal(state.search, "invoice 123");
});

const registrations = captureRegisteredCommands();
test("backspace deletes whole graphemes and restores selection", () => {
	// Backspace removes a whole visible character and restores the unfiltered selection.
	const messages = [
		copyableMessage("a0", "assistant", "😀 👨‍👩‍👧‍👦 e\u0301", 0),
		copyableMessage("a1", "assistant", "ordinary answer", 1),
	];
	for (const character of ["😀", "👨‍👩‍👧‍👦", "e\u0301"]) {
		const state = new CopyMessagePickerState(messages);
		state.handleInput(character);
		assert.equal(state.selectedMessage()?.id, "a0");
		assert.equal(state.handleInput("\x7f"), "render");
		assert.equal(state.search, "");
		assert.deepEqual(state.visibleMessages, messages);
		assert.equal(state.selectedMessage()?.id, "a1");
	}
});

test("argument completions", () => {
	const messageCompletions = registrations.get("copy-message")!.getArgumentCompletions!;
	const userCompletions = registrations.get("copy-user")!.getArgumentCompletions!;
	assert.deepEqual(messageCompletions(""), [
		{ value: "latest", label: "latest" },
		{ value: "last", label: "last" },
		{ value: "newest", label: "newest" },
		{ value: "--with-meta", label: "--with-meta" },
		{ value: "--with-metadata", label: "--with-metadata" },
		{ value: "--with-role", label: "--with-role" },
	]);
	assert.deepEqual(messageCompletions("la"), [
		{ value: "latest", label: "latest" },
		{ value: "last", label: "last" },
	]);
	assert.deepEqual(messageCompletions("--with-r"), [{ value: "--with-role", label: "--with-role" }]);
	assert.deepEqual(messageCompletions("new"), [{ value: "newest", label: "newest" }]);
	assert.deepEqual(messageCompletions("5"), null);
	assert.deepEqual(messageCompletions("zzz"), null);
	assert.deepEqual(userCompletions(""), [
		{ value: "--with-meta", label: "--with-meta" },
		{ value: "--with-metadata", label: "--with-metadata" },
		{ value: "--with-role", label: "--with-role" },
	]);
	assert.deepEqual(userCompletions("la"), null);
	assert.deepEqual(userCompletions("latest"), null);
	assert.deepEqual(userCompletions("--with-meta"), [
		{ value: "--with-meta", label: "--with-meta" },
		{ value: "--with-metadata", label: "--with-metadata" },
	]);
});

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

test("collects copyable entries from a mixed branch", () => {
	assert.deepEqual(collectCopyableMessages(mixedBranch), [
		{ id: "u0", role: "user", timestamp: "2026-06-07T00:00:00.000Z", text: "raw user text" },
		{ id: "a0", role: "assistant", timestamp: "2026-06-07T00:01:00.000Z", text: "raw assistant text" },
		{ id: "legacy-visible", role: "custom", timestamp: undefined, text: "visible legacy custom message" },
		{ id: "b0", role: "branchSummary", timestamp: "2026-06-07T00:03:00.000Z", text: "branch summary text" },
		{ id: "c0", role: "compactionSummary", timestamp: "2026-06-07T00:04:00.000Z", text: "compaction summary text" },
		{ id: "m0", role: "custom", timestamp: "2026-06-07T00:05:00.000Z", text: "visible custom message text" },
	]);
});

test("most recent user message joins adjacent text blocks", () => {
	const content = [{ type: "text", text: 'print("sa' }, { type: "text", text: 'fe")' }];
	const branch = {
		sessionManager: {
			getBranch: () => [{ type: "message", id: "u0", message: { role: "user", content } }],
		},
	};
	assert.deepEqual(getMostRecentUserMessage(branch), {
		kind: "message",
		message: { id: "u0", role: "user", timestamp: undefined, text: 'print("safe")' },
	});
});

test("pending checkpoints collapse into the final response", () => {
	const messages = collectCopyableMessages({
		sessionManager: {
			getBranch: () => [
				{ type: "message", id: "u0", message: { role: "user", content: "Question" } },
				{
					type: "message",
					id: "a0",
					checkpoint: true,
					message: { role: "assistant", responseId: "r1", stopReason: "pending", content: [{ type: "text", text: "Draft" }] },
				},
				{ type: "message", id: "t0", message: { role: "toolResult", content: [{ type: "text", text: "tool output" }] } },
				{
					type: "message",
					id: "a1",
					message: { role: "assistant", responseId: "r1", stopReason: "stop", content: [{ type: "text", text: "Final answer" }] },
				},
			],
		},
	});
	assert.deepEqual(messages.map(({ id, text }) => [id, text]), [
		["u0", "Question"],
		["a1", "Final answer"],
		["t0", "tool output"],
	]);
	assert.equal(messageByDefaultNumber(messages, 2)?.text, "Final answer");
});

test("the longest pending checkpoint wins", () => {
	const messages = collectCopyableMessages({
		sessionManager: {
			getBranch: () => [
				{ type: "message", id: "u0", message: { role: "user", content: "Question" } },
				{
					type: "message",
					id: "a0",
					checkpoint: true,
					message: {
						role: "assistant",
						responseId: "r1",
						stopReason: "pending",
						content: [{ type: "text", text: "First" }, { type: "text", text: "Second" }],
					},
				},
				{
					type: "message",
					id: "a1",
					checkpoint: true,
					message: { role: "assistant", responseId: "r1", stopReason: "pending", content: [{ type: "text", text: "First" }] },
				},
			],
		},
	});
	assert.equal(messageByDefaultNumber(messages, 2)?.text, "FirstSecond");
});

test("context windows reset response coalescing", () => {
	const messages = collectCopyableMessages({
		sessionManager: {
			getBranch: () => [
				{ type: "message", id: "a0", message: { role: "assistant", responseId: "r1", stopReason: "stop", content: [{ type: "text", text: "Earlier" }] } },
				{ type: "context_window", id: "w0" },
				{ type: "message", id: "a1", message: { role: "assistant", responseId: "r1", stopReason: "stop", content: [{ type: "text", text: "Later" }] } },
			],
		},
	});
	assert.deepEqual(messages.map(({ text }) => text), ["Earlier", "Later"]);
});

test("most recent user message skips blank text and reports why none matched", () => {
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
});

test("latest default message skips hidden tool messages", () => {
	const messages = [
		copyableMessage("a0", "assistant", "raw assistant message", 0),
		copyableMessage("t0", "toolResult", "raw newest tool message", 1),
	];
	assert.equal(latestDefaultMessage(messages)?.text, "raw assistant message");
	assert.equal(latestDefaultMessage([copyableMessage("t0", "toolResult", "only tool message", 0)])?.text, "only tool message");
	assert.equal(latestDefaultMessage([copyableMessage("c0", "custom", "custom message", 0)])?.text, "custom message");
});

test("numbered selection uses default-visible order", () => {
	const messages = [
		copyableMessage("u0", "user", "first user", 0),
		copyableMessage("t0", "toolResult", "hidden tool", 1),
		copyableMessage("a0", "assistant", "second assistant", 2),
		copyableMessage("c0", "custom", "third custom", 3),
	];
	assert.deepEqual(defaultVisibleMessages(messages).map((message) => message.id), ["u0", "a0", "c0"]);
	assert.equal(messageByDefaultNumber(messages, 1)?.id, "u0");
	assert.equal(messageByDefaultNumber(messages, 2)?.id, "a0");
	assert.equal(messageByDefaultNumber(messages, 3)?.id, "c0");
	assert.equal(messageByDefaultNumber(messages, 4), undefined);
});

test("picker filters, search, metadata, and peek", () => {
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

	assert.equal(state.handleInput("\x14"), "render");
	press(state, "delta");
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["t0"]);
	press(state, "\x7f\x7f\x7f\x7f\x7f");
	assert.equal(state.handleInput("\x14"), "render");
	press(state, "00");
	assert.deepEqual(state.visibleMessages.map((message) => message.id), []);
	press(state, "\x7f\x7f");
	press(state, "time:00");
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["u0"]);
	press(state, "\x7f\x7f\x7f\x7f\x7f\x7f\x7f");

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
});

test("custom message filter", () => {
	const state = new CopyMessagePickerState([
		copyableMessage("u0", "user", "user text", 0),
		copyableMessage("c0", "custom", "custom text", 1),
	]);

	assert.equal(state.visibility.showCustom, true);
	assert.equal(state.selectedMessage()?.id, "c0");
	assert.equal(state.handleInput("\x1bc"), "render");
	assert.equal(state.visibility.showCustom, false);
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["u0"]);
	assert.match(state.render(180, plainTheme).join("\n"), /custom —/);
	assert.equal(state.handleInput("\x1bc"), "render");
	press(state, "custom");
	assert.deepEqual(state.visibleMessages.map((message) => message.id), ["c0"]);
	assert.match(state.render(134, plainTheme).at(-2) ?? "", /Alt\+C custom/);
	assert.equal(state.handleInput("\x1bc"), "render");
	assert.deepEqual(state.visibleMessages, []);

	const narrowState = new CopyMessagePickerState([copyableMessage("c0", "custom", "custom", 0)]);
	press(narrowState, "abcdefghij");
	assert.match(narrowState.render(80, plainTheme).join("\n"), /search “abcdefghij”/);
});

test("help hints fit the width", () => {
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const hints60 = state.render(60, plainTheme).at(-2) ?? "";
	const hints80 = state.render(80, plainTheme).at(-2) ?? "";
	const fullscreenHints = state.render(100, plainTheme, undefined, "fullscreen").at(-2) ?? "";

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
	assert.doesNotMatch(hints80, /Home\/End jump|Tab peek|filters|Alt\+M meta|Alt\+C custom/);
	press(state, "abcdefghij");
	const searchedRender = state.render(80, plainTheme).join("\n");
	assert.match(searchedRender, /search “abcdefghij”/);
	assert.doesNotMatch(searchedRender, /custom [✓—]/);

	assert.match(fullscreenHints, /Ctrl\+Home\/Ctrl\+End jump/);
	assert.doesNotMatch(fullscreenHints, /(?:^| · )Home\/End jump/);
});

test("configured selection bindings take precedence", () => {
	const state = new CopyMessagePickerState([
		copyableMessage("u0", "user", "first", 0),
		copyableMessage("a0", "assistant", "second", 1),
	]);
	const inputs = {
		"tui.select.up": "\x14",
		"tui.select.down": "\x01",
		"tui.select.pageUp": "\x1b[5~",
		"tui.select.pageDown": "\x1b[6~",
		"tui.select.confirm": "\t",
		"tui.select.cancel": "\x1b[109;3u",
	} as const;
	const keyHints = {
		"tui.select.up": "ctrl+t",
		"tui.select.down": "ctrl+a",
		"tui.select.pageUp": "pageUp",
		"tui.select.pageDown": "pageDown",
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
	assert.equal(state.handleInput("\x1b[109;3u", keybindings), "cancel");
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
});

test("configured cancel wins over Kitty Alt shortcuts", () => {
	const state = new CopyMessagePickerState([copyableMessage("c0", "custom", "custom", 0)]);
	const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.cancel": ["alt+c", "alt+m"] });
	const kittyAltC = "\x1b[99;3u";
	const kittyAltM = "\x1b[109;3u";
	setKittyProtocolActive(true);
	try {
		assert.equal(state.handleInput(kittyAltC, keybindings), "cancel");
		assert.equal(state.visibility.showCustom, true);
		assert.equal(state.handleInput(kittyAltM, keybindings), "cancel");
		assert.equal(state.format, "raw");
		assert.doesNotMatch(state.render(180, plainTheme, keybindings).at(-2) ?? "", /Alt\+[CM]/);
	} finally {
		setKittyProtocolActive(false);
	}
});

test("Tab peek yields to a selection binding", () => {
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const keybindings = {
		matches: (data: string, id: string) => data === "\t" && id === "tui.select.pageUp",
		getKeys: () => [],
	} as never;

	const hints = state.render(120, plainTheme, keybindings).at(-2) ?? "";
	assert.doesNotMatch(hints, /Tab peek/);
	assert.equal(state.handleInput("\t", keybindings), "render");
	assert.equal(state.peek, false);
});

test("configured page bindings", () => {
	const messages = Array.from({ length: 12 }, (_, index) => copyableMessage(`a${index}`, "assistant", `message ${index}`, index));
	const state = new CopyMessagePickerState(messages);
	const pageBindings = {
		matches: (data: string, id: string) =>
			(data === "P" && id === "tui.select.pageUp") || (data === "N" && id === "tui.select.pageDown"),
		getKeys: () => [],
	} as never;

	assert.equal(state.handleInput("P", pageBindings), "render");
	assert.equal(state.selectedMessage()?.id, "a3");
	assert.equal(state.handleInput("N", pageBindings), "render");
	assert.equal(state.selectedMessage()?.id, "a11");
});

test("shortest configured key hint", () => {
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const keys = {
		"tui.select.up": ["up", "ctrl+p", "alt+k"],
		"tui.select.down": ["down", "ctrl+n", "alt+j"],
		"tui.select.pageUp": ["pageUp"],
		"tui.select.pageDown": ["pageDown"],
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
});

test("long key hints stay within width", () => {
	const state = new CopyMessagePickerState([copyableMessage("u0", "user", "first", 0)]);
	const keys = {
		"tui.select.up": ["ctrl+shift+alt+super+backspace"],
		"tui.select.down": ["shift+ctrl+alt+super+backspace"],
		"tui.select.pageUp": ["pageUp"],
		"tui.select.pageDown": ["pageDown"],
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
});

test("Home and End jumps", () => {
	const messages = Array.from({ length: 5 }, (_, index) => copyableMessage(`a${index}`, "assistant", `raw assistant message ${index}`, index));
	const state = new CopyMessagePickerState(messages);

	assert.equal(state.selectedMessage()?.text, "raw assistant message 4");
	assert.equal(state.handleInput("\x1b[H"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 0");
	assert.equal(state.handleInput("\x1b[F"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 4");
});

test("page and Ctrl jumps restore selection after search", () => {
	const messages = Array.from({ length: 12 }, (_, index) => copyableMessage(`a${index}`, "assistant", `raw assistant message ${index}`, index));
	const state = new CopyMessagePickerState(messages);

	assert.equal(state.handleInput("\x1b[5~"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 3");
	assert.equal(state.handleInput("\x1b[6~"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 11");
	assert.equal(state.handleInput("\x1b[1;5H"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 0");
	assert.equal(state.handleInput("\x1b[1;5F"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 11");
	assert.equal(state.handleInput("\x1b[5;5~"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 3");
	assert.equal(state.handleInput("\x1b[6;5~"), "render");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 11");
	state.handleInput("\x1b[A");
	state.handleInput("\x1b[A");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 9");
	assert.equal(state.handleInput("\x1b[109u"), "render");
	assert.equal(state.search, "m");
	press(state, "essage 3");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 3");
	press(state, "\x7f\x7f\x7f\x7f\x7f\x7f\x7f\x7f\x7f");
	assert.equal(state.search, "");
	assert.equal(state.selectedMessage()?.text, "raw assistant message 9");
});

test("package lock excludes WorkOS URLs", () => {
	const lock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
	assert.doesNotMatch(lock, /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"]*(?:workos|socket-firewall)/i);
});


test("picker disposal defers host completion and rejects reentrant input", async () => {
	let component: { dispose?(): void; handleInput?(data: string): void } | undefined;
	let disposing = false;
	let completions = 0;
	const ctx = {
		mode: "tui",
		sessionManager: { getBranch: () => [{ type: "message", id: "user", message: { role: "user", content: "Do not copy after disposal" } }] },
		ui: {
			notify: () => assert.fail("Disposed picker must not notify or copy"),
			custom: (factory: (_tui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => NonNullable<typeof component>) =>
				new Promise((resolve) => {
					component = factory(undefined, plainTheme, new KeybindingsManager(TUI_KEYBINDINGS), (value) => {
						assert.equal(disposing, false, "Host completion must not mutate an active disposal iteration");
						completions++;
						resolve(value);
					});
				}),
		},
	} as unknown as ExtensionCommandContext;
	const command = captureRegisteredCommands().get("copy-message")!.handler("", ctx);
	assert.ok(component?.dispose);
	disposing = true;
	component.dispose();
	component.dispose();
	component.handleInput?.("\r");
	assert.equal(completions, 0);
	disposing = false;
	await command;
	assert.equal(completions, 1, "Repeated disposal and late confirm complete cancellation only once");
});
