import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@earendil-works/pi-tui";

class MemoryTerminal implements Terminal {
  columns = 100;
  rows = 30;
  kittyProtocolActive = false;
  onInput?: (data: string) => void;
  onResize?: () => void;
  start(input: (data: string) => void, resize: () => void) { this.onInput = input; this.onResize = resize; }
  stop() { this.onInput = undefined; this.onResize = undefined; }
  async drainInput() {}
  write(_data: string) {}
  moveBy(_lines: number) {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle(_title: string) {}
  setProgress(_active: boolean) {}
  send(data: string) { assert.ok(this.onInput); this.onInput(data); }
  resize(columns: number, rows: number) { this.columns = columns; this.rows = rows; this.onResize?.(); }
}
const rendered = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

test("native copy commands verify clipboard delivery and preserve branch/picker lifecycle", { timeout: 20_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-copy-native-"));
  const agentDir = join(home, "agent");
  const bin = join(home, "bin");
  mkdirSync(agentDir); mkdirSync(bin);
  const keys = ["HOME", "PATH", "PI_CODING_AGENT_DIR", "COPY_TEST_CLIPBOARD", "SSH_CONNECTION", "SSH_CLIENT", "MOSH_CONNECTION", "DISPLAY", "WAYLAND_DISPLAY", "TERMUX_VERSION"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.HOME = home;
  process.env.PATH = bin;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.COPY_TEST_CLIPBOARD = join(home, "clipboard.json");
  for (const key of keys.slice(4)) delete process.env[key];
  if (process.platform === "linux") process.env.WAYLAND_DISPLAY = "fixture";
  const state = (value: object) => writeFileSync(process.env.COPY_TEST_CLIPBOARD!, JSON.stringify(value));
  const clipboard = () => JSON.parse(readFileSync(process.env.COPY_TEST_CLIPBOARD!, "utf8"));
  const writes = () => {
    try { return readFileSync(process.env.COPY_TEST_CLIPBOARD! + ".writes", "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
    catch { return []; }
  };
  const helper = fileURLToPath(new URL("./fixtures/clipboard-helper.cjs", import.meta.url));
  const command = `#!${process.execPath}\nconst helper = require(${JSON.stringify(helper)});\nconst read = /paste|get|powershell/.test(require('node:path').basename(process.argv[1])) || process.argv.includes('-out') || process.argv.includes('--output');\nif (read) { const text = helper.getText(); if (text === undefined) process.exit(1); process.stdout.write(text ?? ''); } else { let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => text += c); process.stdin.on('end', () => helper.setText(text)); }\n`;
  for (const name of ["pbcopy", "pbpaste", "clip", "powershell", "powershell.exe", "wl-copy", "wl-paste", "xclip", "xsel", "termux-clipboard-set", "termux-clipboard-get"]) writeFileSync(join(bin, name), command, { mode: 0o700 });
  state({});
  await import(new URL("./fixtures/clipboard-preload.mjs", import.meta.url).href);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No network in native copy test"); });
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    let context: ExtensionCommandContext | undefined;
    const settingsManager = pi.SettingsManager.inMemory({ theme: "dark", quietStartup: true });
    const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false });
    const runtime = await pi.createAgentSessionRuntime(async ({ cwd, sessionManager }) => {
      const services = await pi.createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager,
        resourceLoaderOptions: {
          noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
          additionalExtensionPaths: [fileURLToPath(new URL("../extensions/copy-message.ts", import.meta.url))],
          extensionFactories: [(api) => api.registerCommand("qa-context", { handler: async (_args, ctx) => { context = ctx; } })],
        },
      });
      assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
      return { ...await pi.createAgentSessionFromServices({ services, sessionManager, tools: [] }), services, diagnostics: services.diagnostics };
    }, { cwd: home, agentDir, sessionManager: pi.SessionManager.inMemory(home) });
    const terminal = new MemoryTerminal();
    const mode = new pi.InteractiveMode(runtime, { terminal, initialThemeSetting: "dark" });
    cleanup = async () => { try { mode.stop(); } finally { await runtime.dispose(); } };
    await mode.init();
    await runtime.session.prompt("/qa-context");
    // ponytail: no public viewport observer exists; this fixture uses the host renderer until one does.
    const renderer = () => (mode as unknown as { renderer: { mode: string; previousScreen?: string[]; previousLines?: string[] } }).renderer;
    const screen = () => (renderer().mode === "fullscreen" ? renderer().previousScreen : renderer().previousLines) ?? [];
    assert.equal(renderer().mode, "fullscreen");
    const notes: Array<{ text: string; type?: string }> = [];
    // ponytail: no public notification observer exists; observe the native sink until the SDK exposes one.
    const notifications = mode as unknown as { showExtensionNotify(text: string, type?: "info" | "warning" | "error"): void };
    const notify = notifications.showExtensionNotify.bind(mode);
    t.mock.method(notifications, "showExtensionNotify", (text: string, type?: "info" | "warning" | "error") => { notes.push({ text, type }); notify(text, type); });
    const manager = runtime.session.sessionManager;
    manager.appendMessage({ role: "user", content: "Stored user 界🙂\nsecond line\n", timestamp: Date.now() });
    const answer = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Stored answer" }], api: "openai-responses", provider: "fixture", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
    manager.appendContextEdit(answer, { content: [{ type: "text", text: "Canonical answer 界🙂" }] });

    await t.test("latest uses canonical edits; numbered and user commands retain raw history and metadata", async () => {
      state({}); await runtime.session.prompt("/copy-message latest");
      assert.equal(clipboard().text, "Canonical answer 界🙂");
      assert.equal(notes.at(-1)?.type, "info");
      await runtime.session.prompt("/copy-message 2");
      assert.equal(clipboard().text, "Stored answer");
      await runtime.session.prompt("/copy-user --with-meta");
      assert.match(clipboard().text, /^user at .*: Stored user 界🙂\nsecond line\n$/);
      manager.appendContextEdit(answer, null);
      await runtime.session.prompt("/copy-message latest");
      assert.equal(clipboard().text, "Stored user 界🙂\nsecond line\n");
      manager.appendCompaction("Native summary", null, 100);
      await runtime.session.prompt("/copy-message latest");
      assert.equal(clipboard().text, "Native summary");
    });

    await t.test("false writes, empty/unavailable/error reads and remote delivery never claim verified success", async () => {
      for (const value of [{ write: "false", text: "other" }, { read: "empty" }, { read: "unavailable" }, { read: "throw" }]) {
        state(value); await runtime.session.prompt("/copy-user");
        assert.equal(notes.at(-1)?.type, "warning");
        assert.doesNotMatch(notes.at(-1)!.text, /^Copied /);
      }
      state({ write: "throw" }); await runtime.session.prompt("/copy-user");
      assert.equal(notes.at(-1)?.type, "error");
      process.env.SSH_CONNECTION = "fixture";
      state({}); await runtime.session.prompt("/copy-user");
      assert.equal(notes.at(-1)?.type, "warning");
      assert.match(notes.at(-1)!.text, /remote terminal.*unverified/);
      delete process.env.SSH_CONNECTION;
    });

    state({});
    for (const tuiMode of ["fullscreen", "regular"] as const) {
      (mode as unknown as { switchTuiMode(mode: string): boolean }).switchTuiMode(tuiMode);
      await t.test(`${tuiMode} search, peek, metadata, resize and cancel preserve editor focus`, async () => {
        context!.ui.setEditorText("untouched draft 界🙂");
        const before = writes().length;
        const picker = runtime.session.prompt("/copy-message");
        await rendered(); terminal.resize(44, 24); await rendered();
        terminal.send("Stored user"); terminal.send("\t"); terminal.send("\x1b[109;3u"); await rendered();
        assert.ok(screen().some((line) => line.includes("Peek metadata user")));
        terminal.resize(160, 38); await rendered();
        terminal.send("\x1b"); await picker;
        assert.equal(writes().length, before);
        assert.equal(context!.ui.getEditorText(), "untouched draft 界🙂");
        terminal.send("!");
        assert.equal(context!.ui.getEditorText(), "untouched draft 界🙂!");
        terminal.resize(100, 30);
      });
    }
    await t.test("native pointer copies the clicked historical message and returns keyboard focus", async () => {
      (mode as unknown as { switchTuiMode(mode: string): boolean }).switchTuiMode("fullscreen");
      const picker = runtime.session.prompt("/copy-message"); await rendered();
      const row = screen().findIndex((line) => line.includes("Stored answer")); assert.ok(row >= 0);
      terminal.send(`\x1b[<0;5;${row + 1}M`); terminal.send(`\x1b[<0;5;${row + 1}m`);
      await picker;
      assert.equal(clipboard().text, "Stored answer");
      terminal.send("!"); assert.match(context!.ui.getEditorText(), /!!$/);
    });
    await t.test("tree and replacement cancel pending pickers; fork/resume/reload keep active-branch selection", async () => {
      const before = writes().length;
      let picker = runtime.session.prompt("/copy-message"); await rendered();
      assert.equal((await context!.navigateTree(answer, { summarize: false })).cancelled, false); await picker;
      await runtime.session.prompt("/copy-message latest"); assert.equal(clipboard().text, "Stored answer");
      picker = runtime.session.prompt("/copy-message"); await rendered();
      const outgoing = context!; assert.equal((await outgoing.newSession()).cancelled, false); await picker;
      assert.equal(writes().length, before + 1);
      assert.throws(() => outgoing.ui.getEditorText(), /stale|invalid|disposed|active/i);
      await runtime.session.prompt("/qa-context");
      const marker = runtime.session.sessionManager.appendMessage({ role: "user", content: "New branch marker", timestamp: Date.now() });
      picker = runtime.session.prompt("/copy-message"); await rendered();
      assert.equal((await context!.fork(marker, { position: "at" })).cancelled, false);
      await picker;
      await runtime.session.prompt("/qa-context");
      const m = runtime.session.sessionManager; const journal = join(home, "resume.jsonl");
      writeFileSync(journal, [m.getHeader(), ...m.getBranch()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      picker = runtime.session.prompt("/copy-message"); await rendered();
      assert.equal((await context!.switchSession(journal)).cancelled, false);
      await picker;
      await runtime.session.prompt("/qa-context");
      picker = runtime.session.prompt("/copy-message"); await rendered();
      await context!.reload(); await picker;
      await runtime.session.prompt("/qa-context");
      await runtime.session.prompt("/copy-message latest"); assert.equal(clipboard().text, "New branch marker");
      assert.equal(writes().length, before + 2);
    });
    await t.test("an already-dispatched clipboard operation cannot notify a replaced session", async () => {
      state({ write: "delay" });
      const before = notes.length;
      const copy = runtime.session.prompt("/copy-user");
      await rendered();
      assert.equal((await context!.newSession()).cancelled, false);
      await copy;
      assert.equal(notes.length, before);
    });
  } finally {
    try { await cleanup?.(); } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      rmSync(home, { recursive: true, force: true });
    }
  }
});
