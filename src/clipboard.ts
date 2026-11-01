import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyToClipboard, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getNativeClipboard } from "@earendil-works/pi-tui";
import { compactPreview, roleLabel } from "./display-text.ts";
import {
  type CopyFormat,
  type CopyableMessage,
  formatMessageForCopy,
  getMostRecentUserMessage,
} from "./session-content.ts";

const runClipboardReader = promisify(execFile);
const READER_TIMEOUT_MS = 3000;

const WINDOWS_READ = [
  "-NoProfile",
  "-Command",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Write((Get-Clipboard -Raw))",
];

type Reader = [command: string, args: string[]];

export type Notify = ExtensionCommandContext["ui"]["notify"];

function copyNotificationText(selected: CopyableMessage): string {
  return `Copied ${roleLabel(selected.role)} message: “${compactPreview(selected.text, 48)}”`;
}

/** Platform readers that can show what the clipboard holds now, in the order they should be tried. */
function clipboardReaders(): Reader[] {
  if (process.platform === "darwin") {
    return [["pbpaste", []]];
  }
  if (process.platform === "win32") {
    return [["powershell", WINDOWS_READ]];
  }
  const readers: Reader[] = [];
  if (process.env.TERMUX_VERSION !== undefined) {
    readers.push(["termux-clipboard-get", []]);
  }
  if (process.env.WAYLAND_DISPLAY !== undefined) {
    readers.push(["wl-paste", ["--no-newline", "--type", "text"]]);
  }
  if (process.env.DISPLAY !== undefined) {
    readers.push(
      ["xclip", ["-selection", "clipboard", "-out"]],
      ["xsel", ["--clipboard", "--output"]],
    );
  }
  if (
    readers.length === 0 &&
    (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined)
  ) {
    readers.push(["powershell.exe", WINDOWS_READ]);
  }
  return readers;
}

async function readViaNativeHelper(): Promise<string | null | undefined> {
  try {
    return await getNativeClipboard()?.getText();
  } catch {
    // A platform command can still work when the native helper fails.
    return undefined;
  }
}

async function readViaReader(reader: Reader, expected: string): Promise<string | null | undefined> {
  const [command, args] = reader;
  try {
    const { stdout } = await runClipboardReader(command, args, {
      encoding: "utf8",
      timeout: READER_TIMEOUT_MS,
      maxBuffer: Math.max(1024 * 1024, Buffer.byteLength(expected) + 4096),
    });
    return stdout === "" ? null : stdout;
  } catch {
    // Unavailable readers are skipped; failure never echoes clipboard contents.
    return undefined;
  }
}

async function readCopiedText(expected: string): Promise<string | null | undefined> {
  if (process.platform !== "linux") {
    const native = await readViaNativeHelper();
    if (native !== undefined) {
      return native;
    }
  }
  for (const reader of clipboardReaders()) {
    const text = await readViaReader(reader, expected);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function remoteSession(): boolean {
  return (
    process.env.SSH_CONNECTION !== undefined ||
    process.env.SSH_CLIENT !== undefined ||
    process.env.MOSH_CONNECTION !== undefined
  );
}

export async function copySelectedMessage(
  notify: Notify,
  selected: CopyableMessage,
  text = selected.text,
): Promise<void> {
  try {
    await copyToClipboard(text);
    const actual = await readCopiedText(text);
    if (actual !== text) {
      notify("Clipboard command completed, but delivery could not be verified.", "warning");
    } else if (remoteSession()) {
      notify(
        "Local clipboard verified; remote terminal clipboard delivery is unverified.",
        "warning",
      );
    } else {
      notify(copyNotificationText(selected), "info");
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : "Failed to copy to clipboard", "error");
  }
}

export async function copyMostRecentUserMessage(
  ctx: Pick<ExtensionCommandContext, "sessionManager">,
  notify: Notify,
  format: CopyFormat,
): Promise<void> {
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
