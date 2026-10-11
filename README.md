# pi-copy-message

Copy message text from a [Pi](https://github.com/earendil-works/pi-mono) session with a searchable picker. The copied text keeps the original code, spaces, and line breaks.

![Flow from the /copy-message command through message search and selection to the clipboard.](.github/readme/copy-flow.png)

## Install and start

This extension requires Pi 1.0.0 or later and Node.js 24.15.0 or later.

Run this command:

```bash
pi install npm:pi-copy-message
```

Start Pi. Run `/reload` if Pi is already open.

Enter this command in Pi:

```text
/copy-message
```

Type words to search roles and message text. Use ↑ or ↓ to select a message. Press Enter to copy the message.

## Use the picker

Messages appear from oldest to newest. The picker selects the newest visible message first.

User, assistant, and visible custom messages appear by default. Tool and bash messages stay hidden.

| Key | Action |
|---|---|
| Ctrl+T | Show or hide tool and bash messages |
| Ctrl+U / Ctrl+A / Alt+C | Show or hide user, assistant, or custom messages |
| Tab | Preview the selected message |
| Alt+M | Switch between raw text and text with role/time metadata |
| Esc / Ctrl+C | Cancel |

The picker uses your Pi selection bindings. Its key hints show those bindings.

## Direct copies

| Command | What it copies |
|---|---|
| `/copy-user` | Your most recent message with text |
| `/copy-message latest` | The latest default-visible message in Pi's active context |
| `/copy-message 3` | The third default-visible message, counted oldest to newest |
| `/copy-message latest --with-meta` | The latest message with its role and local time, when available |

`latest` follows Pi's active context, including context edits, omissions, and compaction. The picker, numbered copies, and `/copy-user` use stored messages on the current branch, including history before compaction.

## Limits and clipboard

The picker requires interactive TUI mode. Direct commands also work outside TUI mode, where Pi may hide notifications.

The extension uses Pi's clipboard support and OSC 52 fallback. It reports “Copied” only after local clipboard readback matches the copied text.

Unverified delivery produces a warning. A failed write produces an error.

The extension cannot verify remote terminal delivery. Paste into a local editor to check delivery.

Restart Pi after you change dependencies or the Pi runtime.

## Docs and support

The [reference](https://github.com/fitchmultz/pi-copy-message/blob/main/docs/reference.md) lists all controls, command aliases, and clipboard details. The [development guide](https://github.com/fitchmultz/pi-copy-message/blob/main/docs/development.md) covers tests and releases.

[Changelog](CHANGELOG.md) · [Report an issue](https://github.com/fitchmultz/pi-copy-message/issues)

## License

[MIT](LICENSE) · Mitch Fultz
