/**
 * Qualification harness for the adopted standard (sections 6.4 and 8.2). Diagnostic inputs whose
 * purpose is to produce findings live in `tests/probes/`; the acceptance lint command skips that
 * directory and this harness is what enforces it. Controls are generated at runtime under
 * `tests/probes/generated/` so the repository does not carry oversized synthetic sources.
 *
 * Each control has a valid counterpart, asserts the diagnostic identity and file, and asserts the
 * checker exit status. Requires the type-aware checker; reports a skip on platforms where that
 * binary cannot run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test as nodeTest } from "node:test";

const repo = resolve(import.meta.dirname, "..");
const probes = join(repo, "tests", "probes");
const generated = join(probes, "generated");
const FLOATING = "no-floating-promises";

/** Committed diagnostic inputs: file -> expected diagnostic count. */
const COMMITTED: Record<string, number> = {
  "registration.test.ts": 0,
  "default-import.test.ts": 0,
  "helper.ts": 0,
  "subtest.test.ts": 1,
  "same-named-local.test.ts": 1,
  "same-named-import.test.ts": 1,
  "body-promise.test.ts": 1,
  "unrelated-promise.test.ts": 1,
};

type Control = { file: string; rule: string; expect: number; source: string };

/** Section 8.2: every protection is exercised with a valid counterpart and a real violation. */
const CONTROLS: Control[] = [
  // Base configuration: explicit rule, and a rule reached only through an enabled category.
  {
    file: "explicit-rule.ts",
    rule: "no-var",
    expect: 1,
    source: "var counter = 1;\nconsole.log(counter);\n",
  },
  {
    file: "explicit-rule-valid.ts",
    rule: "none",
    expect: 0,
    source: "const counter = 1;\nconsole.log(counter);\n",
  },
  {
    file: "category-rule.ts",
    rule: "no-unused-vars",
    expect: 1,
    source: "const unusedValue = 1;\n",
  },
  {
    file: "category-rule-valid.ts",
    rule: "none",
    expect: 0,
    source: "const usedValue = 1;\nconsole.log(usedValue);\n",
  },
  // Semantic analysis: unsafe propagation fails, validated narrowing passes.
  {
    file: "semantic-unsafe.ts",
    rule: "no-unsafe-member-access",
    expect: 1,
    source:
      'function read(raw: string): number {\n\tconst parsed = JSON.parse(raw);\n\treturn parsed.count;\n}\nconsole.log(read("{}"));\n',
  },
  {
    file: "semantic-unsafe-valid.ts",
    rule: "none",
    expect: 0,
    source:
      'function read(raw: string): number {\n\tconst parsed: unknown = JSON.parse(raw);\n\tif (typeof parsed === "object" && parsed !== null && "count" in parsed) {\n\t\tconst value: unknown = Reflect.get(parsed, "count");\n\t\tif (typeof value === "number") {\n\t\t\treturn value;\n\t\t}\n\t}\n\treturn 0;\n}\nconsole.log(read("{}"));\n',
  },
  // Async safety: floating work fails; owned work and unknown-failure forwarding pass.
  {
    file: "async-floating.ts",
    rule: FLOATING,
    expect: 1,
    source: "async function work(): Promise<void> {};\nwork();\n",
  },
  {
    file: "async-owned.ts",
    rule: "none",
    expect: 0,
    source:
      "async function work(): Promise<void> {\n\tawait Promise.resolve();\n}\nawait work();\n",
  },
  {
    file: "async-unknown-forward.ts",
    rule: "none",
    expect: 0,
    source:
      "function forward(reason: unknown): Promise<void> {\n\treturn Promise.reject(reason);\n}\nawait forward(new Error(1));\n",
  },
  // Structural profiles: production limits, each with its boundary value.
  {
    file: "struct-complexity.ts",
    rule: "complexity",
    expect: 1,
    source: bounded(12, "complexity"),
  },
  {
    file: "struct-complexity-valid.ts",
    rule: "none",
    expect: 0,
    source: bounded(9, "complexity"),
  },
  { file: "struct-depth.ts", rule: "max-depth", expect: 1, source: bounded(4, "depth") },
  { file: "struct-depth-valid.ts", rule: "none", expect: 0, source: bounded(2, "depth") },
  { file: "struct-params.ts", rule: "max-params", expect: 1, source: bounded(6, "params") },
  { file: "struct-params-valid.ts", rule: "none", expect: 0, source: bounded(3, "params") },
  {
    file: "struct-statements.ts",
    rule: "max-statements",
    expect: 1,
    source: bounded(50, "statements"),
  },
  {
    file: "struct-statements-valid.ts",
    rule: "none",
    expect: 0,
    source: bounded(30, "statements"),
  },
  {
    file: "struct-function-lines.ts",
    rule: "max-lines-per-function",
    expect: 1,
    source: bounded(90, "lines"),
  },
  { file: "struct-function-lines-valid.ts", rule: "none", expect: 0, source: bounded(70, "lines") },
  {
    file: "struct-file-lines.ts",
    rule: "max-lines",
    expect: 1,
    source: codeLines(520),
  },
  {
    file: "struct-file-lines-valid.ts",
    rule: "none",
    expect: 0,
    source: codeLines(480),
  },
  // Test profile: size limits stay off, branching limits stay on.
  {
    file: "test-long.test.ts",
    rule: "none",
    expect: 0,
    source: longTestSource(),
  },
  {
    file: "test-complexity.test.ts",
    rule: "complexity",
    expect: 1,
    source: testWrap(bounded(16, "complexity"), "measure(1)"),
  },
  {
    file: "test-depth.test.ts",
    rule: "max-depth",
    expect: 1,
    source: testWrap(bounded(5, "depth"), "measure(1)"),
  },
  {
    file: "test-params.test.ts",
    rule: "max-params",
    expect: 1,
    source: testWrap(bounded(7, "params"), "measure(1, 2, 3, 4, 5, 6, 7)"),
  },
];

function bounded(n: number, metric: string): string {
  if (metric === "complexity") {
    const arms = Array.from(
      { length: n - 1 },
      (_, i) => `\tif (value === ${i + 1}) {\n\t\treturn ${i + 1};\n\t}`,
    ).join("\n");
    return `export function measure(value: number): number {\n${arms}\n\treturn 0;\n}\n`;
  }
  if (metric === "depth") {
    let body = "\t\t\t\treturn value;";
    for (let i = n; i >= 1; i -= 1) {
      const pad = "\t".repeat(i);
      body = `${pad}if (value > 0) {\n${pad}\t${body}\n${pad}}`;
    }
    return `export function measure(value: number): number {\n${body}\n\treturn 0;\n}\n`;
  }
  if (metric === "params") {
    const params = Array.from({ length: n }, (_, i) => `p${i}: number`).join(", ");
    const uses = Array.from({ length: n }, (_, i) => `\ttotal += p${i};`).join("\n");
    return `export function measure(${params}): number {\n\tlet total = 0;\n${uses}\n\treturn total;\n}\n`;
  }
  if (metric === "statements") {
    const body = Array.from({ length: n - 2 }, (_, i) => `\ttotal += ${i};`).join("\n");
    return `export function measure(): number {\n\tlet total = 0;\n${body}\n\treturn total;\n}\n`;
  }
  const statements = Math.floor((n - 3) / 2);
  const pad = "\n".repeat(Math.max(0, n - 3 - statements * 2));
  const body = Array.from({ length: statements }, (_, i) => `\ttotal +=\n\t\t${i};`).join("\n");
  return `export function measure(): number {\n\tlet total = 0;\n${body}${pad}\n\treturn total;\n}\n`;
}

/** Counted lines must be real code: the rule skips comments and blank lines. */
function longTestSource(): string {
  const body = Array.from({ length: 82 }, (_, i) => `\ttotal += ${i};`).join("\n");
  return `import { test as nodeTest } from "node:test";\n\nnodeTest("a long test body stays allowed", () => {\n\tlet total = 0;\n${body}\n\tconsole.log(total);\n});\n`;
}

function codeLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `export const filler${i} = ${i};`).join("\n");
}

/** The generated function stays at module top level; the test body just calls it. */
function testWrap(body: string, call: string): string {
  return `import { test as nodeTest } from "node:test";\n\n${body.trimEnd()}\nnodeTest("test-profile limit is enforced", () => {\n\tconsole.log(${call});\n});\n`;
}

function checker(targets: string[]): { code: number | null; diagnostics: unknown[] } {
  const result = spawnSync(
    join(repo, "node_modules", ".bin", "oxlint"),
    ["--config", join(repo, ".oxlintrc.json"), "--format=json", ...targets],
    { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed: unknown = JSON.parse(result.stdout === "" ? "[]" : result.stdout);
  const list = Array.isArray(parsed) ? parsed : readDiagnostics(parsed);
  return { code: result.status, diagnostics: list };
}

function readDiagnostics(parsed: unknown): unknown[] {
  return isRecord(parsed) && Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ruleId(code: unknown): string {
  const text = typeof code === "string" ? code : "";
  return text.includes("(") ? text.slice(text.indexOf("(") + 1, -1) : text;
}

function countFor(diagnostics: unknown[], file: string): string[] {
  return diagnostics
    .filter((d) => isRecord(d) && typeof d.filename === "string" && d.filename.endsWith(file))
    .map((d) => (isRecord(d) ? ruleId(d.code) : ""));
}

nodeTest("committed diagnostic inputs produce exactly their recorded diagnostics", () => {
  if (skipPlatform()) {
    return;
  }
  const run = checker([
    join("tests", "probes", "helper.ts"),
    ...Object.keys(COMMITTED).map((f) => join("tests", "probes", f)),
  ]);
  for (const [file, expected] of Object.entries(COMMITTED)) {
    const found = countFor(run.diagnostics, file);
    assert.equal(found.length, expected, `${file}: ${JSON.stringify(found)}`);
    if (expected > 0) {
      assert.ok(
        found.every((r) => r === FLOATING),
        `${file} must report the floating-promise rule`,
      );
    }
  }
  assert.equal(run.code, 1, "intended violations must fail the checker");
});

nodeTest(
  "generated qualification controls exercise each protection with its valid counterpart",
  () => {
    if (skipPlatform()) {
      return;
    }
    mkdirSync(generated, { recursive: true });
    try {
      for (const control of CONTROLS) {
        writeFileSync(join(generated, control.file), control.source);
      }
      const run = checker([join("tests", "probes", "generated")]);
      for (const control of CONTROLS) {
        const found = countFor(run.diagnostics, control.file);
        if (control.expect === 0) {
          assert.deepEqual(
            found,
            [],
            `${control.file} is the valid counterpart and must report nothing`,
          );
        } else {
          assert.ok(
            found.includes(control.rule),
            `${control.file} must report ${control.rule}, saw ${JSON.stringify(found)}`,
          );
        }
      }
      assert.equal(run.code, 1, "controls with intended violations must fail the checker");
    } finally {
      rmSync(generated, { recursive: true, force: true });
    }
  },
);

function skipPlatform(): boolean {
  const skip = process.platform.startsWith("android");
  if (skip) {
    console.log("SKIPPED: the type-aware checker binary is not available for this platform");
  }
  return skip;
}
