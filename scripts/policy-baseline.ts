/**
 * The recorded policy baseline for `npm run policy:check`. The normative configuration lives in the
 * adopted standard copy (`docs/quality/strict-oxlint-oxfmt-5.1.1.md`); this file records what the
 * repository itself decides: the recorded allowance, the source-profile mapping, and the tool
 * versions the configuration was qualified against. Evidence for the allowance lives in
 * `docs/quality/quality-exceptions.md` and is exercised by `npm run quality:probes`.
 */
export const sourceProfiles = {
  standard: "Strict Oxlint and Oxfmt Engineering Standard v5.1.1",
  /** Versions the reference configuration has been checked with (section 5.1). */
  toolFloors: {
    oxlint: "1.90.0",
    "oxlint-tsgolint": "7.0.2005",
    oxfmt: "0.75.0",
    "oxc-parser": "0.156.0",
  },
  /** Compiler options that must stay enabled project-wide (section 4.2). */
  requiredCompilerOptions: [
    "strict",
    "noImplicitReturns",
    "noFallthroughCasesInSwitch",
    "noImplicitOverride",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "noUncheckedSideEffectImports",
    "forceConsistentCasingInFileNames",
    "allowJs",
    "checkJs",
  ],
  /** Repository inventory mapped to the standard's source profiles (section 4.1). */
  profiles: [
    {
      profile: "production",
      globs: ["src/**/*.ts", "extensions/**/*.ts", "scripts/**/*.ts"],
    },
    {
      profile: "tests",
      globs: ["tests/**/*.ts", "tests/**/*.cjs", "tests/**/*.mjs", "tests/**/*.js"],
    },
  ],
} as const;

/** The node:test registration allowance recorded as QX-001; options do not inherit. */
export const qualityExceptions = [
  {
    id: "QX-001",
    rule: "typescript/no-floating-promises",
    options: [
      "error",
      {
        checkThenables: true,
        ignoreIIFE: false,
        ignoreVoid: false,
        allowForKnownSafeCalls: [
          {
            from: "package",
            package: "@types/node",
            name: ["nodeTest", "nodeIt", "nodeDescribe", "nodeSuite"],
          },
        ],
        allowForKnownSafePromises: [],
      },
    ],
  },
] as const;
