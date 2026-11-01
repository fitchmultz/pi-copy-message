# Quality standard adoption record

This repository follows [Strict Oxlint and Oxfmt Engineering Standard v5.1.2](strict-oxlint-oxfmt-5.1.2.md).
The record below states what is installed, what runs, and what the current state is. Decisions that
depart from the standard's own values are recorded in [quality-exceptions.md](quality-exceptions.md).

## Repository and version

- Repository: `fitchmultz/pi-copy-message` (a Pi extension package, published to npm).
- Adopted standard: Strict Oxlint and Oxfmt Engineering Standard v5.1.2. The adopted copy in this
  repository is `docs/quality/strict-oxlint-oxfmt-5.1.2.md`; it is the version the tools and checks here
  were measured against.

## Runtimes and package manager

- Node.js 24 line (`.nvmrc` pins 24.21.0); `package.json` pins `npm@12.2.0` as the package manager.
- Install uses the public npm registry only, and the lockfile reflects it.
- Pi runtime targets: the official `pi-coding-agent` 1.4.0 release and the fork release this repository is
  developed against; both are dev dependencies at the versions listed below.

## Installed tool versions

| Tool            | Version  | Role                                                 |
| --------------- | -------- | ---------------------------------------------------- |
| oxlint          | 1.90.0   | Lint gate, type-aware through the checker below      |
| oxlint-tsgolint | 7.0.2005 | Type-aware checker                                   |
| oxfmt           | 0.75.0   | Formatter                                            |
| oxc-parser      | 0.156.0  | Parser used by the policy verifier                   |
| typescript      | 7.0.2    | Compiler gate (`tsc --noEmit`)                       |
| @types/node     | 24.19.2  | Node declarations (renovate pins the major below 25) |

`scripts/policy-baseline.ts` records these as the qualification floors the verifier checks against.

## Configuration and acceptance paths

- Lint configuration: `.oxlintrc.json` — the standard's baseline plus the single recorded allowance.
- Formatter configuration: `.oxfmtrc.json` — the standard's formatter block.
- Acceptance entry points: `npm run check` and `npm run check:compat`, both implemented by
  `scripts/run-gates.ts`. Gates run independently — every one runs and every failure counts — and the
  aggregate exit status reports them all. Individual gates: `policy:check`, `format:check`, `lint`,
  `lint:agent`, `lint:fix`, `format`, `typecheck`, `test`, `quality:probes`, `pack:check`.

## Compiler projects and source profiles

- One TypeScript project (`tsconfig.json`) covers `src`, `extensions`, `scripts`, and `tests`, including
  checked JavaScript (`allowJs` with `checkJs`), so the `.cjs`/`.mjs` test fixtures are compiled.
- Source profiles follow the standard: production sources are `src/**`, `extensions/**`, and
  `scripts/**`; test sources are `*.test.*`/`*.spec.*`/`__tests__/**`. Test diagnostic inputs live under
  `tests/probes/` and are skipped by the ordinary lint gate; the harness in
  `tests/quality-harness.test.ts` is what enforces them, so they must never satisfy a rule by suppression.
- Published content: `extensions/` and `src/` (see `package.json` `files`).

## Formatter and generator ownership

- oxfmt owns every supported file it is pointed at, including Markdown and JSON configuration; formatting
  is expected to be idempotent, and `format:check` proves it.
- No code generators produce maintained sources. Files under `tests/probes/generated/` are runtime
  scratch space created and removed by the harness.

## Migration status

Complete. Sources, tests, configuration, and documentation satisfy the adopted standard at the revision
below, with one recorded quality exception (QX-001) and no suppression directives.

## Integrated verification

| Host                           | Role                                                                                                                    | Result                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| macOS arm64 qualification host | Full toolchain: format, lint (type-aware), typecheck, tests, pack, policy                                               | All gates pass                                       |
| CI (ubuntu-latest)             | Dual-host acceptance at the integrated revision                                                                         | See the PR checks for the integrated commit          |
| android-arm64 device           | Verifier, formatter, and the on-device test suite; the type-aware checker and compiler have no binary for this platform | Passes what can run here; the harness reports a skip |

Integrated revision: recorded in the PR head commit for this change; the qualification-host run above is
at that revision and CI reproduces it.
