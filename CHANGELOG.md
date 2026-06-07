# Changelog

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
