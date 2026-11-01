/**
 * Policy conformance verifier for the adopted standard (`docs/quality/strict-oxlint-oxfmt-5.1.2.md`).
 * It compares the effective lint and formatter configuration against the standard's own normative
 * blocks, permits only the recorded quality allowance, requires compiler membership for every
 * maintained source, and fails on any suppression directive.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSync } from "oxc-parser";

import { qualityExceptions, sourceProfiles } from "./policy-baseline.ts";

const repo = resolve(import.meta.dirname, "..");
const cliArgs = process.argv.slice(2);
const lintConfigPath = cliValue("--lint-config") ?? ".oxlintrc.json";
const formatConfigPath = cliValue("--format-config") ?? ".oxfmtrc.json";

/** Optional override so the qualification harness can verify drift detection against a mutated copy. */
function cliValue(flag: string): string | undefined {
  const index = cliArgs.indexOf(flag);
  return index === -1 ? undefined : cliArgs[index + 1];
}
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

const devDependencies = readJson("package.json").devDependencies;
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
  const root = glob.split("/")[0] ?? "";
  for (const file of walk(root, `${root}/`)) {
    if (matches(glob, file)) {
      recordMaintainedSource(file);
    }
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
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
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
  if (!include.some((entry) => matches(entry, file))) {
    problems.push(`${file} has no compiler project owner`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

function walk(dir: string, prefix: string): string[] {
  const found: string[] = [];
  let names: string[];
  try {
    names = readdirSync(join(repo, dir));
  } catch {
    return found;
  }
  for (const name of names) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full, `${prefix}${name}/`));
    } else {
      found.push(`${prefix}${name}`);
    }
  }
  return found;
}

function matches(glob: string, file: string): boolean {
  const pattern = glob
    .replace(/\*\*\//g, "GLOBSTAR/")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/GLOBSTAR\//g, "(?:[^/]+/)*");
  return new RegExp(`^${pattern}$`).test(file);
}
