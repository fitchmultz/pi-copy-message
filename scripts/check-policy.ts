/**
 * Policy conformance verifier (Strict Oxlint and Oxfmt Engineering Policy v4.5,
 * release strict-quality-4.5). Deterministic and dependency-light: it pins the effective lint
 * configuration, the tool floors, project coverage, and the suppression budget, then prints a
 * report and exits nonzero on any drift.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSync } from "oxc-parser";

import {
	packageJson,
	policyBaselineDigest,
	policyBaselineMeta,
	sourceGlobs,
	toolFloors,
} from "./policy-baseline.ts";

const repo = resolve(import.meta.dirname, "..");
const problems: string[] = [];
const report: string[] = [];

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function readJson(path: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(join(repo, path), "utf8"));
	return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const configDigest = sha256(JSON.stringify(readJson(".oxlintrc.json")));
report.push(
	`config digest ${configDigest.slice(0, 16)} against baseline ${policyBaselineDigest.slice(0, 16)}`,
);
if (configDigest !== policyBaselineDigest) {
	problems.push("the effective lint configuration differs from the recorded policy baseline");
}

const dev = isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {};
for (const [name, floor] of Object.entries(toolFloors)) {
	const declared = typeof dev[name] === "string" ? dev[name] : undefined;
	if (declared === undefined) {
		problems.push(`${name} is not a dev dependency`);
		continue;
	}
	const version = declared.replace(/^[^0-9]*/, "");
	if (compareVersions(version, floor) < 0) {
		problems.push(`${name} ${declared} is below the policy floor ${floor}`);
	}
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

const maintained = listFiles(sourceGlobs);
report.push(`maintained sources: ${maintained.length}`);

const tsconfig = readJson("tsconfig.json");
const include: string[] = Array.isArray(tsconfig.include) ? tsconfig.include.map(String) : [];
const uncovered = maintained.filter((file) => !include.some((glob) => matches(glob, file)));
report.push(`files linted but outside the compiler project: ${uncovered.length}`);
for (const file of uncovered) {
	report.push(`  outside compiler project: ${file}`);
}

let directives = 0;
for (const file of maintained) {
	if (!/\.[cm]?[jt]sx?$/.test(file)) {
		continue;
	}
	const parsed = parseSync(file, readFileSync(join(repo, file), "utf8"), {
		sourceType: "module",
	});
	for (const comment of parsed.comments) {
		const text = readFileSync(join(repo, file), "utf8").slice(comment.start, comment.end);
		if (/(?:eslint|oxlint)-disable/.test(text)) {
			directives += 1;
			problems.push(`${file}: unauthorized suppression directive`);
		}
		if (/@(ts-ignore|ts-expect-error|ts-nocheck|ts-check)/.test(text)) {
			problems.push(`${file}: TypeScript suppression comment`);
		}
	}
}
report.push(`suppression directives: ${directives} (budget: 0)`);

function listFiles(globs: string[]): string[] {
	const found: string[] = [];
	for (const dir of new Set(globs.map((glob) => glob.split("/")[0] ?? "."))) {
		walk(join(repo, dir), (file) => {
			if (globs.some((glob) => matches(glob, file))) {
				found.push(file);
			}
		});
	}
	return found.sort();
}

function walk(dir: string, visit: (file: string) => void): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			if (name !== "node_modules") {
				walk(full, visit);
			}
		} else {
			visit(relative(repo, full));
		}
	}
}

function relative(dir: string, file: string): string {
	return file.slice(dir.length + 1);
}

function matches(glob: string, file: string): boolean {
	const pattern = glob
		.split("**/")
		.map((segment) =>
			segment
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, "."),
		)
		.join("(?:[^/]+/)*");
	return new RegExp(`^${pattern}$`).test(file);
}

console.log(`policy conformance (${policyBaselineMeta.release})`);
for (const line of report) {
	console.log(`  ${line}`);
}
if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`  FAIL ${problem}`);
	}
	process.exit(1);
}
console.log("  OK: configuration, tool floors, coverage, and suppression budget conform.");
