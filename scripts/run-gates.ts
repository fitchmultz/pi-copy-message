/**
 * Acceptance aggregator. Runs each required gate independently so one failure cannot hide another,
 * then aggregates the exit statuses. `npm run check` and `npm run check:compat` route through this;
 * acceptance never depends on a shell short-circuit.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");

/**
 * Gates have no build dependency on each other: every one runs, and every failure counts. Arguments
 * select exactly those gates; with none, the default set runs. Selecting a subset is what lets a
 * control prove independence without pulling the test suite back into itself.
 */
const defaultGates = ["policy:check", "format:check", "lint", "typecheck", "test", "pack:check"];
const requested = process.argv.slice(2);
const gates = requested.length > 0 ? requested : defaultGates;

if (gates.length === 0) {
  console.error("no gates to run");
  process.exit(1);
}

const results: Array<{ gate: string; status: number | null }> = [];
for (const gate of gates) {
  const result = spawnSync("npm", ["run", "--silent", gate], { cwd: repo, encoding: "utf8" });
  const status = result.status;
  results.push({ gate, status });
  const out = `${result.stdout}${result.stderr}`.trim();
  if (out !== "") {
    console.log(`--- ${gate} ---\n${out}`);
  }
}

console.log("acceptance aggregate:");
let failed = 0;
for (const { gate, status } of results) {
  if (status !== 0) {
    failed += 1;
  }
  console.log(`  ${status === 0 ? "pass" : `fail (${status ?? "signal"})`}: ${gate}`);
}
process.exit(failed === 0 ? 0 : 1);
