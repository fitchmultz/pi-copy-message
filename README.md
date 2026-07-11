# pi copy-message extension

A [pi](https://github.com/earendil-works/pi-mono) extension that adds `/copy-message`: a keyboard-first picker for copying raw session message text without terminal wrapping, padding, or rendered TUI artifacts. It also adds `/copy-user` as a direct shortcut for the most recent user message.

`pi-copy-message` supersedes [`pi-copy-user-message`](https://github.com/fitchmultz/pi-copy-user-message), which only copied the most recent user message.

## What it does

- Adds `/copy-message`
- Adds `/copy-user` for copying the most recent user message directly
- Copies raw stored session message text, not rendered terminal lines
- Shows messages in chat order: oldest at top, newest at bottom
- Selects the newest visible message by default
- Supports role filters for user, assistant, and tool/bash messages
- Hides tool/bash messages by default
- Supports type-to-filter search across role and message text, with `time:<term>` for timestamp search
- Supports Home/End jumps for oldest/newest visible messages
- Uses Pi's configured selection bindings for navigation, copy, and cancel
- Includes fast paths: `/copy-message latest`, `/copy-message last`, and `/copy-message newest`
- Supports direct numbered copies like `/copy-message 3`
- Supports metadata copies with `--with-meta`, `--with-metadata`, or `--with-role`

## Install

Install it from npm with pi:

```bash
pi install npm:pi-copy-message
```

Or install it directly from GitHub with pi:

```bash
pi install https://github.com/fitchmultz/pi-copy-message
```

Then reload pi from inside the app:

```text
/reload
```

If you prefer to load it directly from a local checkout during development:

```bash
pi -e ./extensions/copy-message.ts
```

## Usage

Open the picker:

```text
/copy-message
```

Copy the most recent user message directly:

```text
/copy-user
```

Copy the latest visible default message directly:

```text
/copy-message latest
```

Aliases:

```text
/copy-message last
/copy-message newest
```

Copy the 3rd default-visible message directly, matching the picker's 1-based oldest-to-newest numbering:

```text
/copy-message 3
```

Copy with role and timestamp metadata instead of raw text only:

```text
/copy-message latest --with-meta
/copy-message 3 --with-role
/copy-user --with-meta
```

## Keyboard controls

| Key | Action |
|---|---|
| Configured `tui.select.up` (default: `↑`) | Move to older visible message |
| Configured `tui.select.down` (default: `↓`) | Move to newer visible message |
| `Home` | Jump to oldest visible message |
| `End` | Jump to newest visible message |
| Type text | Filter visible messages |
| `time:<term>` | Search timestamps |
| `Backspace` | Delete one search character |
| `Ctrl+U` | Toggle user messages |
| `Ctrl+A` | Toggle assistant messages |
| `Ctrl+T` | Toggle tool/bash messages |
| `Tab` | Toggle a wrapped preview of the selected message |
| `Alt+M` | Toggle raw vs metadata copy format |
| Configured `tui.select.confirm` (default: `Enter`) | Copy selected message text |
| Configured `tui.select.cancel` (default: `Esc`/`Ctrl+C`) | Cancel |

## Behavior notes

- Entry IDs are hidden from the picker.
- The picker caps visible rows and scrolls instead of filling the screen.
- Search preserves your original selected message and restores it when the search is cleared.
- General search does not match timestamps; use `time:<term>` when you want to search by displayed time.
- Filter labels honor the active pi theme.
- Selection key hints show the active Pi bindings. Configured selection actions take precedence if they collide with the picker's filter, preview, or format shortcuts.
- Hidden custom messages are excluded in both current `custom_message` entries and legacy message-wrapped entries; only messages with `display: true` can appear or be copied.
- Copy notifications include the role and a short preview so you can verify what was copied.
- `/copy-message latest` respects default visibility: user and assistant messages are visible, tool/bash messages are hidden. If only hidden messages exist, it falls back to the newest message so the command still does something useful.
- `/copy-message` with no direct selector requires interactive TUI mode because the picker is a custom TUI component.
- Direct commands such as `/copy-user`, `/copy-message latest`, and `/copy-message 3` do not require TUI mode, though non-UI modes may not display notifications.

## Compatibility

- Tested with pi 0.80.6
- Supported Node.js range for local repo tooling: `>=22.19.0`
- `.nvmrc` pins Node 22.19.0 for local development

This package keeps pi core packages as wildcard peers (`*`) per pi package guidance. Pi aliases these imports to its own bundled copies when loading the extension, so the package never bundles or shadows pi core. Local development uses `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as dev dependencies for typechecking and tests.

## Development

```bash
npm install
npm run check
```

Key files:

- `extensions/copy-message.ts` — publishable extension implementation
- `tests/copy-message.test.ts` — regression tests for command wiring, filtering, search, jumps, and clipboard behavior
