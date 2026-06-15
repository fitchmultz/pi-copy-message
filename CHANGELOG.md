# Changelog

## 1.0.5 - 2026-06-15

- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.79.4` and refreshed the npm lockfile
- validated direct non-TUI command handling under pi `0.79.4`

## 1.0.4 - 2026-06-08

- Copy notifications now include the role and a short grapheme-safe preview.
- `/copy-user` now skips blank user entries and copies the most recent user message with text.
- Add direct numbered copies with `/copy-message <number>`.
- Add metadata copy format via `--with-meta`, `--with-metadata`, `--with-role`, and the picker `Alt+M` toggle.
- Add picker `Tab` peek mode for a wrapped preview of the selected message.
- Shorten picker help at narrow widths and remove the always-on subtitle.
- Stop matching timestamps in normal search; use `time:<term>` for timestamp search.
- Cache clipboard command lookups and try later clipboard commands when an earlier command fails.
- Document direct non-TUI usage for `/copy-user` and direct `/copy-message` selectors.

## 1.0.3 - 2026-06-07

- Register `/copy-message` before `/copy-user` so package command autocomplete prefers the picker over the shortcut.

## 1.0.2 - 2026-06-07

- Add `/copy-user` shortcut for copying the most recent user message directly.

## 1.0.1 - 2026-06-07

- Improve npm package description and keywords.
- Add GitHub repository description and topics.

## 1.0.0 - 2026-06-07

Initial release.

- Add `/copy-message` custom TUI picker.
- Copy raw stored session message text instead of rendered terminal lines.
- Show messages in chronological chat order with newest selected by default.
- Add role filters for user, assistant, and tool/bash messages.
- Hide tool/bash messages by default.
- Add type-to-filter search with selection restore when search is cleared.
- Add Home/End jumps for oldest/newest visible messages.
- Add fast paths: `/copy-message latest`, `/copy-message last`, and `/copy-message newest`.
