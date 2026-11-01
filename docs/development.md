# Development and maintenance

[Back to the README](../README.md)

## Install from GitHub

Pi can also install this package directly from GitHub:

```bash
pi install https://github.com/fitchmultz/pi-copy-message
```

## Local checks

Requires Node.js `>=24.15.0`; `.nvmrc` pins Node 24.21.0. The npm version is declared in `package.json`.

```bash
npm ci
npm run check # node --test + tsc --noEmit + pack dry-run
```

To load the source directly from a checkout:

```bash
pi -e ./extensions/copy-message.ts
```

Use `/reload` after updating extension code on current official Pi and the maintained fork. Restart Pi after changing dependencies or the host runtime.

No production build or `prepare` is required. Tests run TypeScript directly with Node's type stripping, so source must stay erasable (`erasableSyntaxOnly`).

Tests cover formatting, native command execution, canonical context and branch selection, both TUI modes, pointer focus, and pending-picker disposal. Native addon interception and an isolated command PATH keep clipboard writes in temporary fixture files, never the operator clipboard. Actual Android/Termux, Windows/WSL, and remote terminal delivery still require platform qualification.

Completion cases belong to registered command hooks. Filter/search and copy-format cases belong to the picker and native delivery, rather than duplicate private-helper tests.

### Key files

- [`extensions/copy-message.ts`](../extensions/copy-message.ts) — publishable extension implementation.
- [`tests/copy-message.test.ts`](../tests/copy-message.test.ts) — command wiring, filtering, search, navigation, and copy formatting regressions.
- [`tests/native-ui.test.ts`](../tests/native-ui.test.ts) — native clipboard delivery, SDK lifecycle, and TUI integration.

### Public registry lockfile

`package-lock.json` must only reference `registry.npmjs.org`; a test fails on private-registry URLs. Behind a registry proxy that rewrites tarball URLs, refresh the lock from public metadata and install through the proxy:

```bash
npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org/
npm ci
```

## Host compatibility and qualification

The support floor is Pi 1.0.0. CI and standalone/packed qualification use the latest stable official Pi and latest maintained fork `main`, resolving each version/commit once per workflow run and retaining exact SDK/CLI evidence. Locked development dependencies are reproducible snapshots, not qualification targets; the support floor does not make fork qualification optional.

This package keeps Pi core packages as wildcard peers (`*`) per [Pi package guidance](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md). Pi aliases these imports to its bundled copies when loading the extension, so the package does not bundle or shadow Pi core. Local development uses `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as dev dependencies for typechecking and tests.

Qualification uses the selected host installed in this checkout's dependency graph. With a checkout of the [shared automation repository](https://github.com/fitchmultz/.github), qualify latest official Pi:

```bash
node /path/to/automation/scripts/qualify.mjs \
  --repo pi-copy-message --source "$PWD" \
  --host official --target latest --output /tmp/pi-copy-message-official
```

Then qualify the packed latest maintained fork with `--host fork --target /path/to/fork-package`. Plain `npm ci` checks only the locked development snapshot, not latest qualification. The [compatibility workflow](../.github/workflows/pi-compatibility.yml) builds and packs the exact fork revision before qualifying both hosts.

## Automatic npm releases (maintainers)

Once configured and enabled, merges to `main` trigger automatic versioning and releases to npm and GitHub after the compatibility checks and candidate-tarball qualification pass. Follow the [shared release procedure](https://github.com/fitchmultz/.github#automatic-npm-releases) for setup, retries, and recovery.

Set repository variable `NPM_RELEASE_ENABLED` to anything other than `true` to stop new release plans; cancel pending runs separately when needed. Workflow validation is not evidence of a completed real OIDC publication.

## Lint, format, and policy conformance

The repository follows the Strict Oxlint and Oxfmt Engineering Policy (release `strict-quality-4.5`).

| Tool                        | Floor           | Role                                                                            |
| --------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `oxlint`                    | 1.90.0          | Lints every maintained source file with type-aware checking enabled             |
| `oxlint-tsgolint`           | 7.0.2005        | Supplies type information to the checker                                        |
| `oxfmt`                     | 0.75.0          | Formats every maintained source file; `npm run format:check` must stay clean    |
| `oxc-parser`                | 0.156.0         | Powers the policy verifier                                                      |
| TypeScript compiler options | `tsconfig.json` | The checker reads the project's compiler options; the verifier reports coverage |

`.oxlintrc.json` is the recorded policy baseline. Changing a rule, option, override profile, or the
test-profile registration mapping is a policy decision; `npm run policy:check` fails when the
effective configuration drifts from the recorded digest, when a tool drops below its floor, when a
maintained file falls outside the compiler project, or when any suppression directive appears. The
repository keeps zero lint-disable directives and zero TypeScript suppression comments.

`tests/probes/` holds diagnostic inputs: files whose purpose is to produce findings. The lint gate
skips that directory, and `npm run quality:probes` lints it with the repository configuration and
asserts the exact expected diagnostic count for each input, that every other maintained source is
clean, and that the checker exits nonzero. Type-aware checking needs the checker binary for the host
platform; where it is unavailable the harness reports the skip and CI covers the assertion.

`npm run check` runs policy conformance, lint, format check, typecheck, tests, and the pack check;
that is the gate before pushing.
