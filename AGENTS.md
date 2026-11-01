# Project instructions

## Dependency maintenance

- Frequently and proactively check releases and make appropriate upgrades across maintained packages and all runtime, development, build, test, and tool dependencies, prioritizing the latest stable official Pi and the intended maintained Pi fork. Routine in-scope maintenance needs no repeated approval; delivery remains subject to existing authority and gates.
- Review crossed release notes, changelogs, migration guidance, and security advisories before upgrading. Verify real APIs and contracts across supported hosts and platforms using each target's exact SDK/CLI and compatible, consistently locked dependency cohort, including host-supplied companions. Preserve lockfile policies, peer contracts, and support floors; a matching version string or locked snapshot alone is not latest-host qualification.
- Adopt beneficial current conventions, patterns, APIs, and functionality instead of extending deprecated or obsolete approaches. Preserve supported behavior and independent use; align affected callers, documentation, generated surfaces, and fixtures through their canonical owners.
- Follow [development, public-lockfile, qualification, and release rules](docs/development.md). Run all applicable required lint, format, type, test, build, package, native, CI, and review gates; report exact targets, commands, results, skips, and unverified limits honestly. Documentation checks alone do not qualify runtime behavior. Never weaken safety, checkers, fixture contracts, or supported-target requirements to make an update pass.
- Roll out updates controllably with a rollback path through existing review, approval, and release gates; honor every explicit hold. This authorization is not blanket permission to publish, install into or restart an active runtime, disclose private data, or change global model or authentication settings.

## Lint, format, and code quality

- This repository follows the Strict Oxlint and Oxfmt Engineering Policy (release `strict-quality-4.5`). `.oxlintrc.json` and `.oxfmtrc.json` carry the policy configuration, and `npm run policy:check` fails when the effective configuration, tool floors, project coverage, or the zero-suppression budget drifts from the recorded baseline. Rule and option changes are policy decisions.
- `npm run check` is the pre-push gate: policy conformance, lint, format check, typecheck, tests, and pack check. Findings are fixed in code; the repository keeps zero lint-disable directives and zero TypeScript suppression comments.
- `tests/probes/` holds diagnostic inputs whose purpose is to produce findings; the lint gate skips that directory and `npm run quality:probes` asserts each input's expected diagnostics.

