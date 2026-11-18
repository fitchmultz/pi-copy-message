/**
 * Policy conformance verifier for the adopted standard (`docs/quality/strict-oxlint-oxfmt-5.1.2.md`).
 * It compares the effective lint and formatter configuration against the standard's own normative
 * blocks, permits only the recorded quality allowance, requires compiler membership for every
 * maintained source, and fails on any suppression directive.
 */
import { hash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseSync } from "oxc-parser";

import { qualityExceptions, sourceProfiles } from "./policy-baseline.ts";

const repo = resolve(import.meta.dirname, "..");
const { values: cliValues } = parseArgs({
  options: {
    "lint-config": { type: "string" },
    "format-config": { type: "string" },
    package: { type: "string" },
  },
  strict: false,
});
const lintConfigPath =
  typeof cliValues["lint-config"] === "string" ? cliValues["lint-config"] : ".oxlintrc.json";
const formatConfigPath =
  typeof cliValues["format-config"] === "string" ? cliValues["format-config"] : ".oxfmtrc.json";
const packagePath = typeof cliValues.package === "string" ? cliValues.package : "package.json";
const guidePath = join(repo, "docs/quality/strict-oxlint-oxfmt-5.1.2.md");
const problems: string[] = [];
const report: string[] = [];

const exception = qualityExceptions[0];
const floatingRule = "typescript/no-floating-promises";

const guideLint = jsonBlocks(readFileSync(guidePath, "utf8")).find(isLintBlock);
const guideFormat = jsonBlocks(readFileSync(guidePath, "utf8")).find(isFormatBlock);
if (guideLint === undefined || guideFormat === undefined) {
  problems.push("the adopted standard copy is missing its normative configuration blocks");
}

const expectedLint = structuredClone(guideLint);
if (expectedLint !== undefined) {
  const candidates: readonly unknown[] = Array.isArray(expectedLint.overrides)
    ? expectedLint.overrides
    : [];
  const override = candidates.find((o) => isRecord(o) && isRecord(o.rules) && isTestProfile(o));
  if (isRecord(override) && isRecord(override.rules)) {
    override.rules[floatingRule] = exception.options;
  }
}
if (!same(readJson(lintConfigPath), expectedLint)) {
  problems.push(".oxlintrc.json differs from the standard's baseline plus the recorded allowance");
}
if (guideFormat !== undefined && !same(readJson(formatConfigPath), guideFormat)) {
  problems.push(".oxfmtrc.json differs from the standard's formatter block");
}
report.push(
  `config digests: lint ${digest(readJson(lintConfigPath))} format ${digest(readJson(formatConfigPath))}`,
);
report.push(`recorded quality allowance: ${exception.id}`);

const devDependencies = readJson(packagePath).devDependencies;
for (const [name, floor] of Object.entries(sourceProfiles.toolFloors)) {
  const declared = isRecord(devDependencies) ? devDependencies[name] : undefined;
  if (typeof declared !== "string") {
    problems.push(`${name} is not a dev dependency`);
  } else if (compareVersions(declared.replace(/^[^0-9]*/, ""), floor) < 0) {
    problems.push(`${name} ${declared} is below the qualified version ${floor}`);
  }
}

const compilerProject = readJson("tsconfig.json");
const compilerOptions = compilerProject.compilerOptions;
if (isRecord(compilerOptions)) {
  for (const option of sourceProfiles.requiredCompilerOptions) {
    if (compilerOptions[option] !== true) {
      problems.push(`compiler option ${option} must stay enabled`);
    }
  }
}
const include: string[] = Array.isArray(compilerProject.include)
  ? compilerProject.include.map(String)
  : [];
const maintained: string[] = [];
const globs = sourceProfiles.profiles.flatMap((profile) => [...profile.globs]);
for (const glob of globs) {
  for (const file of globSync(glob, { cwd: repo }).map((entry) => entry.replaceAll("\\", "/"))) {
    recordMaintainedSource(file);
  }
}

report.push(`maintained sources: ${maintained.length}`);

let directives = 0;
for (const file of maintained) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) {
    continue;
  }
  const text = readFileSync(join(repo, file), "utf8");
  for (const comment of parseSync(file, text, { sourceType: "module" }).comments) {
    const body = text.slice(comment.start, comment.end);
    if (/(?:eslint|oxlint)-disable/.test(body)) {
      directives += 1;
      problems.push(`${file}: suppression directive found where none is authorized`);
    }
    if (/@(?:ts-ignore|ts-expect-error|ts-nocheck|ts-check)/.test(body)) {
      problems.push(`${file}: TypeScript suppression comment`);
    }
  }
}
report.push(`suppression directives: ${directives}`);

console.log(`policy conformance (${sourceProfiles.standard})`);
for (const line of report) {
  console.log(`  ${line}`);
}
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`  FAIL ${problem}`);
  }
  process.exit(1);
}
console.log("  OK: configuration, allowance, tool floors, coverage, and directive budget conform.");

/** The test-profile override is the one carrying the reduced structural limits. */
function isTestProfile(override: Record<string, unknown>): boolean {
  return JSON.stringify(override.rules ?? {}).includes('"max":15');
}

function jsonBlocks(markdown: string): unknown[] {
  const found: unknown[] = [];
  for (const match of markdown.matchAll(/```json\n([\s\S]*?)```/g)) {
    const body: unknown = JSON.parse(match[1] ?? "");
    found.push(body);
  }
  return found;
}

function isLintBlock(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && "plugins" in value && "categories" in value && "overrides" in value;
}

function isFormatBlock(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && "printWidth" in value;
}

function digest(value: unknown): string {
  return hash("sha256", JSON.stringify(value), "hex").slice(0, 16);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(repo, path), "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function recordMaintainedSource(file: string): void {
  if (maintained.includes(file)) {
    return;
  }
  maintained.push(file);
  if (!include.some((entry) => posix.matchesGlob(file, entry))) {
    problems.push(`${file} has no compiler project owner`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSemver(
  raw: string,
): { core: [number, number, number]; prerelease: readonly string[] } | null {
  const withoutBuild = raw.split("+", 1)[0] ?? raw;
  const dash = withoutBuild.indexOf("-");
  const coreText = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const preText = dash === -1 ? "" : withoutBuild.slice(dash + 1);
  if (!/^\d+\.\d+\.\d+$/.test(coreText)) {
    return null;
  }
  const parts = coreText.split(".").map((part) => Number.parseInt(part, 10));
  return {
    core: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    prerelease: preText === "" ? [] : preText.split("."),
  };
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Math.sign(Number(left) - Number(right));
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left < right ? -1 : 1;
}

function comparePrereleases(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) {
      return 0;
    }
    return left.length === 0 ? 1 : -1;
  }
  const limit = Math.max(left.length, right.length);
  for (let i = 0; i < limit; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined || r === undefined) {
      return l === undefined ? -1 : 1;
    }
    if (l !== r) {
      return comparePrereleaseIdentifier(l, r);
    }
  }
  return 0;
}

function compareVersions(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left === null || right === null) {
    if (left === right) {
      return 0;
    }
    return left === null ? -1 : 1;
  }
  for (let i = 0; i < 3; i += 1) {
    const l = left.core[i] ?? 0;
    const r = right.core[i] ?? 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return comparePrereleases(left.prerelease, right.prerelease);
}
