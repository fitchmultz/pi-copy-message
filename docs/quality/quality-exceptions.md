# Quality exceptions

This repository adopts [Strict Oxlint and Oxfmt Engineering Standard v5.1.2](strict-oxlint-oxfmt-5.1.2.md).
Recorded exceptions are listed below using the standard's Appendix B template. Maintained sources carry
no suppression directives; `npm run policy:check` fails if one appears.

## QX-001 — node:test registration allowance in the test profile

```text
ID and title:
  QX-001 — node:test registration allowance on the test-profile override.

Rule, option, or threshold; installed tool versions:
  typescript/no-floating-promises with allowForKnownSafeCalls =
  [{from: "package", package: "@types/node", name: [nodeTest, nodeIt, nodeDescribe, nodeSuite]}].
  oxlint 1.94.0; tsrs 7.1.0-beta.tsrs2 (type-aware); oxfmt 0.79.0; oxc-parser 0.156.0.

Scope: files, authorized operations, origins, or bounded pattern:
  The test-profile override in .oxlintrc.json (**/*.test.*, **/*.spec.*, **/__tests__/**). Authorized
  operations: top-level test registrations made through those four mapped local names. Nothing else in
  the file changes; every other rule and option in the baseline stays exactly as the standard sets it.

Directive selectors/inventory and optional duplication bounds:
  No directives are used. Four mapped names, one package origin, test profile only.

Diagnostic and required contract:
  An un-awaited `nodeTest(...)` registration reports "Promises must be awaited". The registration is
  fire-and-forget by design: the node:test runner owns the returned promise, schedules the test, and
  reports the result through its own reporter, so awaiting it is not the contract. Both test files
  import the framework under the mapped names for this reason.

Actual compliant alternative and demonstrated quality cost:
  The compliant alternative is `void nodeTest(...)` (or `await`) at every registration site, because
  ignoreVoid and every other option stay at the baseline. That adds non-semantic ceremony to every test
  in the repository while removing no real risk. The standard defines this mapping for precisely this
  case (Section 6.4), so the allowance is the narrower choice: it exempts four named functions instead
  of silencing the rule for a file, a directory, or the whole test profile.

Chosen adjustment and why its scope is appropriate:
  Declaration-qualified allowance limited to the four names the repository actually uses, applied only
  in the test profile. Production sources keep the rule unrestricted.

Structural comparison or unsafe-type evidence, where applicable:
  Not a structural exception. Type flow is the standard's own example mapping, narrowed to the names in
  use (see lost detection below).

Verification commands, relevant tests, and results:
  npm run quality:probes (tests/quality-harness.test.ts) on the qualification host. Valid fixtures
  (registration, default-import, long test) report zero diagnostics; each intended violation fixture
  (subtest, same-named-local, same-named-import, body-promise, unrelated-promise) reports exactly one
  floating-promise diagnostic, and the checker exits nonzero. Results are asserted per fixture file,
  per rule id, and by exit status.

Retained protection, lost detection, and established assumptions:
  Retained: all other floating-promise options (ignoreVoid false, ignoreIIFE false, checkThenables
  true, allowForKnownSafePromises empty) plus every other rule in both profiles. Lost detection: the
  shorthand modifiers cannot be mapped here — adding skip/todo/only to the name list makes the installed
  checker panic when a shorthand is called through a mapped alias, so registrations using them through
  those names are not exempted. The repository uses none; a new one will surface as an ordinary finding
  in `npm run lint`.

Review and revisit trigger:
  Any upgrade of oxlint or tsrs, any new registration form, or the first use of a shorthand
  modifier through a mapped name. Re-measure with npm run quality:probes and update this record.
```

## QX-002 — prerelease tsrs type-aware backend in place of stable oxlint-tsgolint

```text
ID and title:
  QX-002 — adopt prerelease tsrs@7.1.0-beta.tsrs2 as the type-aware backend in place of stable
  oxlint-tsgolint.

Rule, option, or threshold; installed tool versions:
  Section 5.1 ("latest stable published releases of Oxlint, oxlint-tsgolint, Oxfmt"). oxlint
  1.94.0 (2026-11-16T12:26Z); tsrs 7.1.0-beta.tsrs2 (2026-11-16T11:59Z); oxfmt 0.79.0
  (2026-11-16T12:27Z); oxc-parser 0.156.0; typescript 7.0.2.

Scope: files, authorized operations, origins, or bounded pattern:
  package.json / package-lock.json devDependencies and scripts/policy-baseline.ts toolFloors
  (`tsrs: "7.1.0-beta.tsrs2"`), plus type-aware lint execution (oxlint discovers
  node_modules/.bin/tsrs-lint natively).

Directive selectors/inventory and optional duplication bounds:
  None (backend package substitution only; directive budget stays zero).

Diagnostic and required contract:
  Section 5.1 mandates stable published releases, whereas tsrs publishes prereleases only
  (dist-tags.latest is 0.25.0-ts7.1.0-beta; 7.1.0-beta.tsrs2 is an untagged newer prerelease;
  stable oxlint-tsgolint 7.0.2007 remains published on npm).

Actual compliant alternative and demonstrated quality cost:
  Keeping stable oxlint-tsgolint@7.0.2007 preserves Section 5.1 directly. In a matched A/B
  benchmark on mitchs-m5-mbp (Darwin arm64, oxlint 1.94.0 running
  `oxlint --deny-warnings --ignore-pattern 'tests/probes/**' .`, median of 3 warm runs each via
  OXLINT_TSGOLINT_PATH), oxlint-tsgolint@7.0.2007 took 0.16s wall time and 301.3 MiB maximum RSS vs
  0.10s wall time and 159.7 MiB maximum RSS with tsrs@7.1.0-beta.tsrs2 (1.60x slower, 1.89x /
  141.6 MiB higher peak RSS; both exited 0).

Chosen adjustment and why its scope is appropriate:
  Owner-approved substitution of tsrs@7.1.0-beta.tsrs2, enforced by semver.lt/semver.valid in
  scripts/check-policy.ts so downgrades below 7.1.0-beta.tsrs2 fail policy:check. oxlint 1.94.0
  discovers tsrs-lint natively and fails closed (exit 1) if absent.

Structural comparison or unsafe-type evidence, where applicable:
  Not a structural exception. `npm run quality:probes` exercises committed floating-promise probes
  and 26 generated type-aware and structural controls under tsrs@7.1.0-beta.tsrs2.

Verification commands, relevant tests, and results:
  `npm run check` (`policy:check`, `format:check`, `lint`, `typecheck`, `test`, `pack:check`),
  `npm run check:compat` (all except `pack:check`), and `npm run quality:probes` all exit 0 on
  2026-11-18 with oxlint 1.94.0 + tsrs 7.1.0-beta.tsrs2 + oxfmt 0.79.0.

Retained protection, lost detection, and established assumptions:
  All type-aware rules, QX-001 probe assertions, and tsc compiler checks remain active; diagnostic
  parity across the exercised type-aware rules is verified directly by `npm run quality:probes`.

Review and revisit trigger:
  First stable tsrs release, any oxlint upgrade changing backend discovery, or any type-aware
  diagnostic discrepancy.
```

No other exceptions exist. Structural thresholds, formatter settings, and the baseline rule set are the
standard's own values.
