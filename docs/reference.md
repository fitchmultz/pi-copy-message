# Copy-message reference

[Back to the README](../README.md)

Pi's built-in Ctrl+X copies the latest assistant response. This extension adds searchable history, other roles, metadata, and direct selectors. It supersedes [pi-copy-user-message](https://github.com/fitchmultz/pi-copy-user-message), which only copied the most recent user message.

## Commands and copy format

`/copy-message` opens the picker. `/copy-user` directly copies the most recent user message with nonblank text.

```text
/copy-message latest
/copy-message last
/copy-message newest
/copy-message 3
/copy-message latest --with-meta
/copy-message 3 --with-role
/copy-user --with-meta
```

`latest`, `last`, and `newest` select the same message. Numbers use the default-visible list, counted from 1 in oldest-to-newest order; picker filters do not change direct command numbering.

Copies contain raw text by default. `--with-meta`, `--with-metadata`, and `--with-role` all add the role and displayed local time, when available, as a prefix: `assistant at 02:30 PM: message text`. The time format follows your locale. In the picker, **Alt+M** toggles this format; **Tab** previews the selected format before copying.

Command argument completion offers the selector aliases and metadata flags.

## Keyboard controls

| Key                                                                                     | Action                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Configured `tui.select.up` (default: `↑`)                                               | Move to older visible message                                      |
| Configured `tui.select.down` (default: `↓`)                                             | Move to newer visible message                                      |
| Configured `tui.select.pageUp` / `tui.select.pageDown` (default: `PageUp` / `PageDown`) | Move by one visible page in regular mode                           |
| `Ctrl+PageUp` / `Ctrl+PageDown`                                                         | Move by one visible page in fullscreen mode                        |
| `Home` / `End`                                                                          | Jump to oldest/newest visible message in regular mode              |
| `Ctrl+Home` / `Ctrl+End`                                                                | Jump to oldest/newest visible message in fullscreen mode           |
| Type or paste text                                                                      | Filter visible messages; pasted line breaks and tabs become spaces |
| `time:<term>`                                                                           | Search displayed timestamps                                        |
| `Backspace`                                                                             | Delete one search character (a whole grapheme)                     |
| `Ctrl+U`                                                                                | Toggle user messages                                               |
| `Ctrl+A`                                                                                | Toggle assistant messages                                          |
| `Ctrl+T`                                                                                | Toggle tool/bash messages                                          |
| `Alt+C`                                                                                 | Toggle custom messages                                             |
| `Tab`                                                                                   | Toggle a wrapped preview of the selected message                   |
| `Alt+M`                                                                                 | Toggle raw vs metadata copy format                                 |
| Configured `tui.select.confirm` (default: `Enter`)                                      | Copy selected message text                                         |
| Configured `tui.select.cancel` (default: `Esc`/`Ctrl+C`)                                | Cancel                                                             |

Selection key hints show the active Pi bindings. Configured selection actions take precedence if they collide with filter, preview, or format shortcuts; conflicting shortcut hints are hidden. Filter labels use the active Pi theme.

Mouse wheel moves the selection. Clicking a message copies it and returns keyboard focus to the unchanged draft.

## Search and selection

- Messages appear in chat order, oldest at the top and newest at the bottom. The newest visible message is selected initially.
- The picker shows at most eight message rows and scrolls through longer lists. The wrapped preview shows up to 16 lines, with a count of any remaining lines. For very long messages it wraps only enough text to fill the preview and notes that more lines remain without counting them.
- Entry IDs are hidden.
- Search matches roles and message text case-insensitively. Every whitespace-separated term must match. General search excludes timestamps; use `time:<term>` to search the displayed local time.
- Search preserves the original selected message and restores it when the search is cleared, if that message is still visible under the current role filters.
- User, assistant, and visible custom messages are enabled by default. Tool/bash messages are hidden by default. Branch and compaction summaries can also appear.
- Only custom messages with `display: true` can appear or be copied, whether stored as current `custom_message` entries or legacy message-wrapped entries. **Alt+C** toggles them in the picker only.
- Session replacement, tree navigation, shutdown, and reload cancel pending pickers without stale-context notifications.

## History versus active context

`latest` uses Pi's canonical session projection, honoring context edits, omissions, and compaction. Numbered selectors, the picker, and `/copy-user` use raw active-branch history, including older pre-compaction messages.

`latest` and numbered selectors include user, assistant, and visible custom messages by default while hiding tool/bash messages. If only hidden messages exist, `latest` falls back to the newest message. Numbered selectors do not use that fallback.

The picker coalesces legacy in-progress assistant snapshots within their context-window boundaries so each response appears once. Current official Pi and the maintained fork no longer write those legacy boundaries.

`/copy-message` without a direct selector requires interactive TUI mode. Direct commands do not require TUI mode, though other modes may not display notifications.

## Clipboard delivery

Previews and copy notifications remove terminal control characters for safe display. Copied text stays raw, preserving stored text and newlines. Image and other non-text content blocks are not copied.

The extension keeps Pi's native/platform clipboard writes and OSC 52 fallback. It reports success only after reading back matching local clipboard text. The success notification includes the role and a short preview. Unavailable, empty, or mismatched readback warns; rejected writes report an error. Remote terminal delivery via OSC 52 cannot be verified, even when the remote machine's local clipboard matches.

Native clipboard reads are preferred where available on macOS and Windows. Platform command readers are bounded by a three-second timeout and preserve exact text, including newlines. Readers include `pbpaste`, PowerShell, `termux-clipboard-get`, `wl-paste`, `xclip`, and `xsel`, selected for the platform and environment. The extension does not replace Pi's working write fallback chain.

Android/Termux writes use Pi's normal fallback chain, including OSC 52 when native clipboard commands are unavailable. Actual Android/Termux, Windows/WSL, and remote terminal delivery require platform qualification beyond the isolated native test fixtures.
