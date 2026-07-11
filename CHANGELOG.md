# Changelog

## Unreleased

- Update the local Pi development baseline and compatibility documentation to 0.80.6.
- Read current branch-summary, compaction-summary, and visible custom-message session entries in `/copy-message`; hidden custom messages stay excluded.
- Honor configured Pi selection keybindings before local picker shortcuts and render their effective hints.

## 1.0.8 - 2026-06-24

- Add `/copy-message` and `/copy-user` argument completions for `latest`/`last`/`newest` and `--with-meta`/`--with-metadata`/`--with-role`.
- Bound clipboard commands with a 3s timeout so a wedged `xclip`/`wl-copy` daemon cannot hang the command.
- Drop the obsolete `basic-ftp` npm override (no longer in the dependency tree).
- Align pi core peer dependencies with package guidance (non-optional wildcard peers; pi aliases them to its bundled copies at load time).
- Update the local pi development baseline to `0.80.2` and refresh the npm lockfile.

## 1.0.7 - 2026-06-23

- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.80.1` and refreshed the npm lockfile
- refreshed the README compatibility note for pi `0.80.1`
- reviewed the Pi 0.80.0/0.80.1 changelog; no runtime source migration was required

## 1.0.6 - 2026-06-22

- updated the local pi development baseline to `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` `0.79.10` and refreshed the npm lockfile
- refreshed the README compatibility note for pi `0.79.10` and removed the obsolete fleet-tested marker
- validated with `npm run check` and an isolated Pi package-load smoke under pi `0.79.10`

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
