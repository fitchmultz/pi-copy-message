# pi-copy-message

A [Pi](https://github.com/earendil-works/pi-mono) extension for copying message text from your session. Search for an old prompt or answer, then copy it with its code, spacing, and line breaks intact.

![Open /copy-message, search session history, press Enter or click a message, and copy its raw text to the clipboard.](.github/readme/copy-flow.png)

*Find a message in your session, then copy its text; local clipboard readback checks delivery.*

## Install and start

Requires **Pi 1.0.0 or later** and **Node.js 24.15.0 or later**.

```bash
pi install npm:pi-copy-message
```

Start Pi, or run `/reload` in an open session. Then enter:

```text
/copy-message
```

Type a few words to find a message, use ↑ / ↓ to select it, and press Enter to copy. The picker starts on the newest visible message.

Prefer GitHub? Use `pi install https://github.com/fitchmultz/pi-copy-message` instead. Restart Pi after changing dependencies or the host runtime.

## Quick copies

Use these commands inside Pi when you already know what you want:

| Command | What it copies |
|---|---|
| `/copy-user` | Your most recent message with text |
| `/copy-message latest` | The latest default-visible message in Pi's active context |
| `/copy-message 3` | The third default-visible message in branch history, counted oldest to newest |
| `/copy-message latest --with-meta` | The latest message with its role and local time, when available |

`last` and `newest` are aliases for `latest`. `--with-metadata` and `--with-role` are aliases for `--with-meta`; the flag also works with `/copy-user` and numbered copies.

The picker, numbered copies, and `/copy-user` use stored messages on your current branch, including history from before compaction. `latest` uses Pi's active context, so it follows context edits, omissions, and compaction.

## Find the right message

Messages run oldest to newest. User, assistant, and visible custom messages appear by default. Press `Ctrl+T` to include tool and bash output; `Ctrl+U`, `Ctrl+A`, and `Alt+C` toggle the other roles.

Type or paste to search roles and message text. Search ignores case and matches every word you enter. Use `time:<term>` to search displayed timestamps.

Press Tab to preview the message, or Alt+M to add its role and time to the copied text. Enter copies; Esc or Ctrl+C cancels. The mouse wheel moves the selection, and clicking a message copies it.

If you've changed Pi's selection bindings, the picker uses them and shows the active key hints. Your bindings take precedence when they overlap with picker shortcuts.

See the [full keyboard controls and behavior reference](https://github.com/fitchmultz/pi-copy-message/blob/main/docs/reference.md) for page jumps, fullscreen controls, and selection details.

## Clipboard behavior

Copied text keeps the stored message's code, spacing, and line breaks. Previews and notifications remove terminal control characters for safe display; the clipboard text stays raw. Copying or cancelling returns you to your unchanged draft.

The extension uses Pi's clipboard support, including its OSC 52 terminal fallback. You'll see a “Copied” notification only when local clipboard readback matches the text. Unverified delivery gets a warning, and a failed write reports an error. Over SSH or another remote terminal connection, delivery to your own clipboard can't be verified, even if the remote machine's clipboard matches.

The picker requires interactive TUI mode. Direct commands (`/copy-user`, `latest`, and numbered copies) also work outside TUI mode, where notifications may not be shown. More [platform and delivery details](https://github.com/fitchmultz/pi-copy-message/blob/main/docs/reference.md#clipboard-delivery) are in the reference.

## Docs and support

- [Reference](https://github.com/fitchmultz/pi-copy-message/blob/main/docs/reference.md) — all controls, message selection, and platform notes.
- [Development](https://github.com/fitchmultz/pi-copy-message/blob/main/docs/development.md) — tests, host qualification, and maintainer release procedure.
- [Changelog](CHANGELOG.md) — release history.
- [Issues](https://github.com/fitchmultz/pi-copy-message/issues) — report a problem or suggest an improvement.

Pi's built-in Ctrl+X copies the latest assistant response. This extension adds searchable history, other roles, metadata, and direct selectors. It supersedes [pi-copy-user-message](https://github.com/fitchmultz/pi-copy-user-message), which only copied the most recent user message.

## License

[MIT](LICENSE) · Mitch Fultz
