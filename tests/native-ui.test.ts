import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** The fixture clipboard file's shape, validated on read rather than asserted. */
interface ClipboardState {
  read?: string | undefined;
  text?: string | undefined;
  write?: string | undefined;
}

/** Host internals this suite observes because the SDK exposes no public observer for them. */
interface RendererProbe {
  mode: string;
  previousLines?: string[] | undefined;
  previousScreen?: string[] | undefined;
}

type NotifyFn = (text: string, type?: "info" | "warning" | "error") => void;

function isNotifyFn(value: unknown): value is NotifyFn {
  return typeof value === "function";
}

interface ModeSwitchProbe {
  switchTuiMode: (mode: string) => boolean;
}

function withModeSwitch(value: object): ModeSwitchProbe {
  assert.ok(isModeSwitchHost(value));
  return value;
}

interface GraphemeIterator {
  next: () => { done?: boolean | undefined; value: { input: string } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRendererProbe(value: unknown): value is RendererProbe {
  return isRecord(value) && typeof value.mode === "string";
}

function isModeSwitchHost(value: unknown): value is ModeSwitchProbe {
  return isRecord(value) && typeof value.switchTuiMode === "function";
}

function isGraphemeIterator(value: unknown): value is GraphemeIterator {
  return isRecord(value) && typeof value.next === "function";
}

function readClipboardState(json: string): ClipboardState {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    return {};
  }
  const record: Record<string, unknown> = parsed;
  const state: ClipboardState = {};
  for (const key of ["read", "text", "write"] as const) {
    const value = record[key];
    if (typeof value === "string") {
      state[key] = value;
    }
  }
  return state;
}
import { type Terminal, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

class MemoryTerminal implements Terminal {
  columns = 100;
  rows = 30;
  kittyProtocolActive = false;
  onInput?: ((data: string) => void) | undefined;
  onResize?: (() => void) | undefined;
  start(input: (data: string) => void, resize: () => void) {
    this.onInput = input;
    this.onResize = resize;
  }
  stop() {
    this.onInput = undefined;
    this.onResize = undefined;
  }
  async drainInput() {
    // The memory terminal has no buffered input to deliver.
  }
  write(_data: string) {
    // Renders are observed through the host's previous screen, not captured writes.
  }
  moveBy(_lines: number) {
    // Cursor movement is a no-op; the memory terminal has no cursor state.
  }
  hideCursor() {
    // Nothing to hide: the memory terminal does not track cursor visibility.
  }
  showCursor() {
    // Nothing to show: the memory terminal does not track cursor visibility.
  }
  clearLine() {
    // Repaint happens through the host's previous-screen snapshot.
  }
  clearFromCursor() {
    // Repaint happens through the host's previous-screen snapshot.
  }
  clearScreen() {
    // Repaint happens through the host's previous-screen snapshot.
  }
  setTitle(_title: string) {
    // Terminal titles are not observable in the memory terminal.
  }
  setProgress(_active: boolean) {
    // Progress reporting is not observable in the memory terminal.
  }
  setProgramStatus() {
    // Program status is not observable in the memory terminal.
  }
  send(data: string) {
    assert.ok(this.onInput);
    this.onInput(data);
  }
  resize(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }
}
const rendered = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 40);
  });

nodeTest(
  "native copy commands verify clipboard delivery and preserve branch/picker lifecycle",
  { timeout: 20_000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), "pi-copy-native-"));
    const agentDir = join(home, "agent");
    const bin = join(home, "bin");
    mkdirSync(agentDir);
    mkdirSync(bin);
    const keys = [
      "HOME",
      "PATH",
      "PI_CODING_AGENT_DIR",
      "COPY_TEST_CLIPBOARD",
      "SSH_CONNECTION",
      "SSH_CLIENT",
      "MOSH_CONNECTION",
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "TERMUX_VERSION",
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.HOME = home;
    process.env.PATH = bin;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.COPY_TEST_CLIPBOARD = join(home, "clipboard.json");
    for (const key of keys.slice(4)) {
      delete process.env[key];
    }
    if (process.platform === "linux") {
      process.env.WAYLAND_DISPLAY = "fixture";
    }
    const clipboardPath = (): string => {
      const path = process.env.COPY_TEST_CLIPBOARD;
      assert.ok(path !== undefined);
      return path;
    };
    const state = (value: ClipboardState): void =>
      writeFileSync(clipboardPath(), JSON.stringify(value));
    const clipboard = (): ClipboardState =>
      readClipboardState(readFileSync(clipboardPath(), "utf8"));
    const writes = (): ClipboardState[] => {
      try {
        return readFileSync(clipboardPath() + ".writes", "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => readClipboardState(line));
      } catch {
        return [];
      }
    };
    const helper = fileURLToPath(new URL("./fixtures/clipboard-helper.cjs", import.meta.url));
    const command = `#!${process.execPath}\nconst helper = require(${JSON.stringify(helper)});\nconst read = /paste|get|powershell/.test(require('node:path').basename(process.argv[1])) || process.argv.includes('-out') || process.argv.includes('--output');\nif (read) { const text = helper.getText(); if (text === undefined) process.exit(1); process.stdout.write(text ?? ''); } else { let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => text += c); process.stdin.on('end', () => helper.setText(text)); }\n`;
    for (const name of [
      "pbcopy",
      "pbpaste",
      "clip",
      "powershell",
      "powershell.exe",
      "wl-copy",
      "wl-paste",
      "xclip",
      "xsel",
      "termux-clipboard-set",
      "termux-clipboard-get",
    ]) {
      writeFileSync(join(bin, name), command, { mode: 0o700 });
    }
    state({});
    await import(new URL("./fixtures/clipboard-preload.mjs", import.meta.url).href);
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("No network in native copy test");
    });
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const pi = await import("@earendil-works/pi-coding-agent");
      let context: ExtensionCommandContext | undefined;
      const settingsManager = pi.SettingsManager.inMemory({
        theme: "dark",
        quietStartup: true,
      });
      const modelRuntime = await pi.ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
      });
      const runtime = await pi.createAgentSessionRuntime(
        async ({ cwd, sessionManager }) => {
          const services = await pi.createAgentSessionServices({
            cwd,
            agentDir,
            modelRuntime,
            settingsManager,
            resourceLoaderOptions: {
              noExtensions: true,
              noSkills: true,
              noPromptTemplates: true,
              noThemes: true,
              noContextFiles: true,
              additionalExtensionPaths: [
                fileURLToPath(new URL("../extensions/copy-message.ts", import.meta.url)),
              ],
              extensionFactories: [
                (api) =>
                  api.registerCommand("qa-context", {
                    handler: async (_args, ctx) => {
                      context = ctx;
                    },
                  }),
              ],
            },
          });
          assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
          return {
            ...(await pi.createAgentSessionFromServices({
              services,
              sessionManager,
              tools: [],
            })),
            services,
            diagnostics: services.diagnostics,
          };
        },
        { cwd: home, agentDir, sessionManager: pi.SessionManager.inMemory(home) },
      );
      const terminal = new MemoryTerminal();
      const mode = new pi.InteractiveMode(runtime, { terminal, initialThemeSetting: "dark" });
      cleanup = async () => {
        try {
          mode.stop();
        } finally {
          await runtime.dispose();
        }
      };
      await mode.init();
      await runtime.session.prompt("/qa-context");
      // ponytail: no public viewport observer exists; this fixture uses the host renderer until one does.
      const renderer = () => {
        const value: unknown = Reflect.get(mode, "renderer");
        assert.ok(isRendererProbe(value));
        return value;
      };
      const screen = () =>
        (renderer().mode === "fullscreen" ? renderer().previousScreen : renderer().previousLines) ??
        [];
      assert.equal(renderer().mode, "fullscreen");
      const notes: Array<{ text: string; type?: string | undefined }> = [];
      const lastNote = () => {
        const note = notes.at(-1);
        assert.ok(note !== undefined);
        return note;
      };
      const activeContext = () => {
        assert.ok(context !== undefined);
        return context;
      };
      // ponytail: no public notification observer exists; observe the native sink until the SDK exposes one.
      const originalNotify: unknown = Reflect.get(mode, "showExtensionNotify");
      assert.ok(isNotifyFn(originalNotify));
      const hostNotify = originalNotify;
      const notify = (text: string, type?: "info" | "warning" | "error"): void => {
        notes.push({ text, type });
        hostNotify.call(mode, text, type);
      };
      Reflect.set(mode, "showExtensionNotify", notify);
      t.after(() => {
        Reflect.set(mode, "showExtensionNotify", hostNotify);
      });
      const manager = runtime.session.sessionManager;
      manager.appendMessage({
        role: "user",
        content: "Stored user 界🙂\nsecond line\n",
        timestamp: Date.now(),
      });
      const answer = manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Stored answer" }],
        api: "openai-responses",
        provider: "fixture",
        model: "fixture",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });
      manager.appendContextEdit(answer, {
        content: [{ type: "text", text: "Canonical answer 界🙂" }],
      });

      await t.test(
        "latest uses canonical edits; numbered and user commands retain raw history and metadata",
        async () => {
          state({});
          await runtime.session.prompt("/copy-message latest");
          assert.equal(clipboard().text, "Canonical answer 界🙂");
          assert.equal(notes.at(-1)?.type, "info");
          await runtime.session.prompt("/copy-message 2");
          assert.equal(clipboard().text, "Stored answer");
          await runtime.session.prompt("/copy-user --with-meta");
          assert.match(clipboard().text ?? "", /^user at .*: Stored user 界🙂\nsecond line\n$/);
          manager.appendContextEdit(answer, null);
          await runtime.session.prompt("/copy-message latest");
          assert.equal(clipboard().text, "Stored user 界🙂\nsecond line\n");
          manager.appendCompaction("Native summary", null, 100);
          await runtime.session.prompt("/copy-message latest");
          assert.equal(clipboard().text, "Native summary");
        },
      );

      await t.test(
        "false writes, empty/unavailable/error reads and remote delivery never claim verified success",
        async () => {
          for (const value of [
            { write: "false", text: "other" },
            { read: "empty" },
            { read: "unavailable" },
            { read: "throw" },
          ]) {
            state(value);
            await runtime.session.prompt("/copy-user");
            assert.equal(notes.at(-1)?.type, "warning");
            assert.doesNotMatch(lastNote().text, /^Copied /);
          }
          state({ write: "throw" });
          await runtime.session.prompt("/copy-user");
          assert.equal(notes.at(-1)?.type, "error");
          process.env.SSH_CONNECTION = "fixture";
          state({});
          await runtime.session.prompt("/copy-user");
          assert.equal(notes.at(-1)?.type, "warning");
          assert.match(lastNote().text, /remote terminal.*unverified/);
          delete process.env.SSH_CONNECTION;
        },
      );

      await t.test(
        "native picker bounds long-preview enumeration across redraws and navigation",
        async (subtest) => {
          const ascii = "x".repeat(4096);
          const unicode = "e\u0301👩‍💻🇺🇸界".repeat(256);
          const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
          const expected = (text: string, max: number) => {
            const parts = Array.from(segmenter.segment(text), (part) => part.segment);
            return parts.length <= max ? text : parts.slice(0, max - 1).join("") + "…";
          };
          const previews = [ascii, unicode].map((text) => expected(text, 300));
          const notification = expected(unicode, 48);
          manager.appendMessage({
            role: "user",
            content: ascii,
            timestamp: Date.UTC(2026, 9, 22),
          });
          const unicodeEntry = manager.appendMessage({
            role: "user",
            content: unicode,
            timestamp: Date.UTC(2026, 9, 22),
          });
          const iterator = segmenter.segment("")[Symbol.iterator]();
          const prototype: unknown = Object.getPrototypeOf(iterator);
          assert.ok(isGraphemeIterator(prototype));
          const next = prototype.next;
          const counts = new Map<object, { text: string; yields: number }>();
          // Count actual native iterator yields, not elapsed time or ICU preprocessing.
          const counter = subtest.mock.method(prototype, "next", function (this: GraphemeIterator) {
            const result = next.call(this);
            if (
              result.done !== true &&
              (result.value.input === ascii || result.value.input === unicode)
            ) {
              const record = counts.get(this) ?? {
                text: result.value.input,
                yields: 0,
              };
              record.yields++;
              counts.set(this, record);
            }
            return result;
          });
          const before = writes().length;
          terminal.resize(1000, 30);
          const picker = runtime.session.prompt("/copy-message");
          const work: number[][] = [];
          for (const action of [
            () => {
              // The first sample renders without an intervening action.
            },
            () => terminal.resize(1000, 31),
            () => terminal.send("\x1b[A"),
          ]) {
            counts.clear();
            action();
            await rendered();
            work.push([...counts.values()].map((record) => record.yields));
            for (const preview of previews) {
              assert.ok(screen().some((line) => line.includes(preview)));
            }
            for (const text of [ascii, unicode]) {
              assert.ok([...counts.values()].some((record) => record.text === text));
            }
          }
          terminal.send("\x1b");
          await picker;
          assert.equal(
            writes().length,
            before,
            "render/redraw/navigation must not write the clipboard",
          );
          counter.mock.restore();
          subtest.diagnostic(
            `native long-preview yields (open/redraw/up): ${JSON.stringify(work)}`,
          );
          for (const render of work) {
            for (const yields of render) {
              assert.ok(yields <= 301, `${yields} yields exceeds the 300-preview lookahead bound`);
            }
          }

          // Existing isolated native delivery, never the operator clipboard.
          state({});
          await runtime.session.prompt("/copy-user");
          assert.equal(clipboard().text, unicode);
          assert.equal(notes.at(-1)?.text, `Copied user message: “${notification}”`);
          await runtime.session.prompt("/copy-user --with-meta");
          assert.ok((clipboard().text ?? "").endsWith(": " + unicode));
          const parts = Array.from(segmenter.segment(unicode), (part) => part.segment);
          for (const length of [47, 48, 49]) {
            const text = parts.slice(0, length).join("");
            manager.appendContextEdit(unicodeEntry, { content: text });
            await runtime.session.prompt("/copy-message latest");
            assert.equal(clipboard().text, text);
            assert.equal(notes.at(-1)?.text, `Copied user message: “${expected(text, 48)}”`);
          }
          terminal.resize(100, 30);
        },
      );

      state({});
      for (const tuiMode of ["fullscreen", "regular"] as const) {
        withModeSwitch(mode).switchTuiMode(tuiMode);
        await t.test(
          `${tuiMode} search, peek, metadata, resize and cancel preserve editor focus`,
          async () => {
            activeContext().ui.setEditorText("untouched draft 界🙂");
            const before = writes().length;
            const picker = runtime.session.prompt("/copy-message");
            await rendered();
            terminal.resize(44, 24);
            await rendered();
            terminal.send("Stored user");
            terminal.send("\t");
            terminal.send("\x1b[109;3u");
            await rendered();
            assert.ok(screen().some((line) => line.includes("Peek metadata user")));
            terminal.resize(160, 38);
            await rendered();
            terminal.send("\x1b");
            await picker;
            assert.equal(writes().length, before);
            assert.equal(activeContext().ui.getEditorText(), "untouched draft 界🙂");
            terminal.send("!");
            assert.equal(activeContext().ui.getEditorText(), "untouched draft 界🙂!");
            terminal.resize(100, 30);
          },
        );
      }
      await t.test(
        "native pointer copies the clicked historical message and returns keyboard focus",
        async () => {
          withModeSwitch(mode).switchTuiMode("fullscreen");
          const picker = runtime.session.prompt("/copy-message");
          await rendered();
          const row = screen().findIndex((line) => line.includes("Stored answer"));
          assert.ok(row >= 0);
          terminal.send(`\x1b[<0;5;${row + 1}M`);
          terminal.send(`\x1b[<0;5;${row + 1}m`);
          await picker;
          assert.equal(clipboard().text, "Stored answer");
          terminal.send("!");
          assert.match(activeContext().ui.getEditorText(), /!!$/);
        },
      );
      await t.test(
        "tree and replacement cancel pending pickers; fork/resume keep active-branch selection",
        async () => {
          const before = writes().length;
          let picker = runtime.session.prompt("/copy-message");
          await rendered();
          assert.equal(
            (await activeContext().navigateTree(answer, { summarize: false })).cancelled,
            false,
          );
          await picker;
          await runtime.session.prompt("/copy-message latest");
          assert.equal(clipboard().text, "Stored answer");
          picker = runtime.session.prompt("/copy-message");
          await rendered();
          const outgoing = activeContext();
          assert.equal((await outgoing.newSession()).cancelled, false);
          await picker;
          assert.equal(writes().length, before + 1);
          assert.throws(() => outgoing.ui.getEditorText(), /stale|invalid|disposed|active/i);
          await runtime.session.prompt("/qa-context");
          const marker = runtime.session.sessionManager.appendMessage({
            role: "user",
            content: "New branch marker",
            timestamp: Date.now(),
          });
          picker = runtime.session.prompt("/copy-message");
          await rendered();
          assert.equal((await activeContext().fork(marker, { position: "at" })).cancelled, false);
          await picker;
          await runtime.session.prompt("/qa-context");
          const m = runtime.session.sessionManager;
          const journal = join(home, "resume.jsonl");
          writeFileSync(
            journal,
            [m.getHeader(), ...m.getBranch()].map((entry) => JSON.stringify(entry)).join("\n") +
              "\n",
          );
          picker = runtime.session.prompt("/copy-message");
          await rendered();
          assert.equal((await activeContext().switchSession(journal)).cancelled, false);
          await picker;
          await runtime.session.prompt("/qa-context");
          await runtime.session.prompt("/copy-message latest");
          assert.equal(clipboard().text, "New branch marker");
          assert.equal(writes().length, before + 2);
        },
      );
      await t.test(
        "reload disposal settles the pending picker without a clipboard write",
        async () => {
          const before = writes().length;
          const picker = runtime.session.prompt("/copy-message");
          let settled = false;
          picker
            .then(() => {
              settled = true;
            })
            .catch((error: unknown) => {
              assert.fail(`disposed picker promise rejected: ${String(error)}`);
            });
          await rendered();
          await activeContext().reload();
          await runtime.session.prompt("/qa-context");
          await rendered();
          // Reload disposes custom UI before session_shutdown on the maintained fork.
          // Assert settlement before awaiting: regressions fail here, not at the parent deadline.
          assert.equal(settled, true, "disposed picker command must settle after reload");
          await picker;
          assert.equal(writes().length, before);
          await runtime.session.prompt("/copy-message latest");
          assert.equal(clipboard().text, "New branch marker");
          terminal.send("!");
          assert.match(activeContext().ui.getEditorText(), /!$/);
        },
      );
      await t.test(
        "picker completion preserves sibling disposal during native reload",
        async () => {
          let disposals = 0;
          const sibling = () => {
            let complete!: (value: null) => void;
            const closed = activeContext().ui.custom<null>((_tui, _theme, _keys, done) => {
              complete = done;
              return {
                render: () => ["Sibling disposal fixture"],
                invalidate() {
                  // The fixture caches nothing, so there is nothing to invalidate.
                },
                dispose() {
                  disposals++;
                },
              };
            });
            return { closed, complete: () => complete(null) };
          };
          // Compare with the host's own sibling-only behavior. Official 1.3.0 does not
          // dispose inline custom UI at reload; the fork's dialog stack does.
          const baseline = sibling();
          await rendered();
          await activeContext().reload();
          await runtime.session.prompt("/qa-context");
          const expectedDisposals = disposals;
          baseline.complete();
          await baseline.closed;

          const before = disposals;
          const beforeWrites = writes().length;
          const picker = runtime.session.prompt("/copy-message");
          let settled = false;
          picker
            .then(() => {
              settled = true;
            })
            .catch((error: unknown) => {
              assert.fail(`disposed picker promise rejected: ${String(error)}`);
            });
          await rendered();
          const peer = sibling();
          await rendered();
          await activeContext().reload();
          await runtime.session.prompt("/qa-context");
          await rendered();
          assert.equal(
            disposals - before,
            expectedDisposals,
            "Picker completion must not skip a sibling's native disposal",
          );
          assert.equal(settled, true);
          await picker;
          peer.complete();
          await peer.closed;
          assert.equal(writes().length, beforeWrites);
        },
      );
      await t.test(
        "an already-dispatched clipboard operation cannot notify a replaced session",
        async () => {
          state({ write: "delay" });
          const before = notes.length;
          const copy = runtime.session.prompt("/copy-user");
          await rendered();
          assert.equal((await activeContext().newSession()).cancelled, false);
          await copy;
          assert.equal(notes.length, before);
        },
      );
      await t.test(
        "native peek wrapping work does not grow with message length",
        async (subtest) => {
          withModeSwitch(mode).switchTuiMode("fullscreen");
          const word = "naïve café 🙂 ";
          // Distinct starts keep native width caching from favoring either render.
          const small = "1x " + word.repeat(12_000);
          const large = "10x " + word.repeat(120_000);
          const session = runtime.session.sessionManager;
          for (const content of [small, large]) {
            session.appendMessage({ role: "user", content, timestamp: Date.now() });
          }
          const segments = new Intl.Segmenter(undefined, {
            granularity: "grapheme",
          }).segment("");
          const iterator = segments[Symbol.iterator]();
          const prototype: unknown = Object.getPrototypeOf(iterator);
          assert.ok(isGraphemeIterator(prototype));
          const next = prototype.next;
          let yields = 0;
          // A recording mock would retain every call; count native iterator yields directly.
          prototype.next = function (this: GraphemeIterator) {
            const result = next.call(this);
            if (result.done !== true) {
              yields++;
            }
            return result;
          };
          subtest.after(() => {
            prototype.next = next;
          });
          const peekRows = () => {
            const lines = screen().map((line) => stripTerminalSequences(line));
            const title = lines.findIndex((line) => line.startsWith("Peek raw user message"));
            assert.ok(title >= 0);
            return lines.slice(title + 1, title + 18).map((line) => line.trimEnd());
          };
          const before = writes().length;
          const picker = runtime.session.prompt("/copy-message");
          await rendered();
          const work: number[] = [];
          const peeks: Array<{ text: string; rows: string[] }> = [];
          for (const [key, text] of [
            ["\t", large],
            ["\x1b[A", small],
          ] as const) {
            yields = 0;
            terminal.send(key);
            await rendered();
            work.push(yields);
            peeks.push({ text, rows: peekRows() });
          }
          terminal.send("\x1b");
          await picker;
          assert.equal(writes().length, before);
          subtest.diagnostic(
            `native peek grapheme yields (10x message, 1x message): ${JSON.stringify(work)}`,
          );
          const longRun = work[0];
          const shortRun = work[1];
          assert.ok(longRun !== undefined && shortRun !== undefined);
          assert.ok(
            longRun <= shortRun * 1.25,
            `${longRun} yields for a 10x message exceeds ${shortRun} for the 1x message`,
          );
          for (const { text, rows } of peeks) {
            assert.equal(rows[16], "  … more wrapped lines");
            const shown = rows.slice(0, 16).map((row) => row.slice(2));
            for (const row of shown) {
              assert.ok(visibleWidth(row) <= terminal.columns - 2);
            }
            const joined = shown.join(" ");
            assert.equal(
              joined,
              text.slice(0, joined.length),
              "peek shows the message start in order",
            );
          }
        },
      );
    } finally {
      try {
        await cleanup?.();
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
        rmSync(home, { recursive: true, force: true });
      }
    }
  },
);
