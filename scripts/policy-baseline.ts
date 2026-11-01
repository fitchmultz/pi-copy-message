/**
 * Recorded policy baseline for `npm run policy:check`. Values come from the Strict Oxlint and Oxfmt
 * Engineering Policy v4.5 the repository adopted; changing them is a policy decision, not a local
 * convenience, so the verifier fails when the effective configuration drifts from this record.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");

export const policyBaselineMeta = {
	release: "strict-quality-4.5",
	version: "4.5",
} as const;

export const toolFloors: Record<string, string> = {
	oxlint: "1.90.0",
	oxfmt: "0.75.0",
	"oxlint-tsgolint": "7.0.2005",
	"oxc-parser": "0.156.0",
};

/** Source globs the toolchain maintains, matching the repository's own scope. */
export const sourceGlobs: string[] = [
	"src/**/*.ts",
	"extensions/**/*.ts",
	"tests/**/*.ts",
	"tests/**/*.cjs",
	"scripts/**/*.ts",
];

const packageJsonParsed: unknown = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));

export const packageJson: Record<string, unknown> = isRecord(packageJsonParsed)
	? packageJsonParsed
	: {};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** SHA-256 of the canonical (re-stringified) effective configuration at adoption. */
export const policyBaselineDigest =
	"b50b92b47b233641e11da8ef5650620a7e8b169dc99a2e85f1eff279d54a3c34";

export type PackageJson = typeof packageJson;
