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

Follow the [shared release procedure](https://github.com/fitchmultz/.github#automatic-npm-releases): merge a reviewed PR into `main` with an intentional `package.json` version bump and a matching versioned `CHANGELOG.md` section. Once configured and enabled, publication is unattended after the existing compatibility checks and candidate-tarball qualification pass. Complete applicable package-specific release evidence before merging the bump. Automation never bumps versions, overwrites releases, or republishes an existing version; existing manual publisher instructions remain valid.

Failed/unpublished candidates can retry daily at 12:17 UTC or via manual dispatch of `npm release` on `main`, without another bump. Set repository variable `NPM_RELEASE_ENABLED` to anything other than `true` to stop new release plans; cancel pending runs separately when needed. Workflow validation is not evidence of a completed real OIDC publication.
