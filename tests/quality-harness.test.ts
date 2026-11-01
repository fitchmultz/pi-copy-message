/**
 * Section 16 conformance harness. `tests/probes/` holds the committed diagnostic inputs; each one
 * must produce exactly the diagnostics recorded here, and every other maintained source must stay
 * clean. The repository lint gate ignores `tests/probes` so intended violations can live there;
 * this harness is what enforces them. Requires the type-aware checker, so it skips on platforms
 * where that binary cannot run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const probes = "tests/probes";
const FLOATING = "no-floating-promises";

/** The checker reports rule ids as `plugin(rule)` in JSON output. */
function ruleId(code: string): string {
  return code.includes("(") ? code.slice(code.indexOf("(") + 1, -1) : code;
}

/** file -> expected diagnostic count, all other sources must be zero. */
const EXPECTED: Record<string, number> = {
  "registration.test.ts": 0,
  "default-import.test.ts": 0,
  "helper.ts": 0,
  "subtest.test.ts": 1,
  "same-named-local.test.ts": 1,
  "same-named-import.test.ts": 1,
  "body-promise.test.ts": 1,
  "unrelated-promise.test.ts": 1,
};

nodeTest("section 16 harness: diagnostic inputs produce exactly their expected diagnostics", () => {
  if (
    process.platform.startsWith("android") ||
    !existsSync(join(repo, "node_modules", "oxlint-tsgolint"))
  ) {
    console.log("SKIPPED: the type-aware checker binary is not available for this platform");
    return;
  }
  const run = spawnSync(
    join(repo, "node_modules", ".bin", "oxlint"),
    ["--config", join(repo, ".oxlintrc.json"), "--format=json", probes],
    { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(run.stdout) as unknown;
  const diagnostics = Array.isArray(parsed) ? parsed : readDiagnostics(parsed);
  const counts = new Map<string, number>();
  let total = 0;
  for (const item of diagnostics) {
    const record = isRecord(item) ? item : {};
    const file = typeof record.filename === "string" ? record.filename : "";
    const rule = typeof record.code === "string" ? record.code : "";
    const name = file.slice(probes.length + 1);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    total += 1;
    if (ruleId(rule) !== FLOATING) {
      assert.fail(`${name}: unexpected rule ${rule}; diagnostic inputs must only trip the mapping`);
    }
  }
  for (const [name, expected] of Object.entries(EXPECTED)) {
    assert.equal(counts.get(name) ?? 0, expected, `${probes}/${name}`);
  }
  assert.equal(counts.size, 5, "only the intended violating inputs may report diagnostics");
  assert.equal(total, 5, "the recorded per-file counts must add up");
  assert.equal(run.status, 1, "intended violations must fail the checker");
});

function readDiagnostics(parsed: unknown): unknown[] {
  return isRecord(parsed) && Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
