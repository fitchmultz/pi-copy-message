import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { CopyFormat } from "./session-content.ts";

const COPY_METADATA_FLAGS = ["--with-meta", "--with-metadata", "--with-role"];
const COPY_LATEST_SELECTORS = ["latest", "last", "newest"];
export type ParsedCopyMessageArgs = {
	format: CopyFormat;
	selector?: "latest" | { number: number };
};
export function parseCopyArgs(args: string | undefined): ParsedCopyMessageArgs {
	const result: ParsedCopyMessageArgs = { format: "raw" };
	for (const token of (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
		if (COPY_METADATA_FLAGS.includes(token)) {
			result.format = "metadata";
			continue;
		}
		if (COPY_LATEST_SELECTORS.includes(token)) {
			result.selector = "latest";
			continue;
		}
		if (/^\d+$/.test(token)) {
			result.selector = { number: Number.parseInt(token, 10) };
		}
	}
	return result;
}
export function copyArgumentCompletions(
	prefix: string,
	includeSelectors: boolean,
): AutocompleteItem[] | null {
	if (/^\d+$/.test(prefix)) {
		return null;
	}
	const candidates = includeSelectors
		? [...COPY_LATEST_SELECTORS, ...COPY_METADATA_FLAGS]
		: COPY_METADATA_FLAGS;
	const normalized = prefix.toLowerCase();
	const items = candidates
		.filter((candidate) => candidate.startsWith(normalized))
		.map((candidate) => ({ value: candidate, label: candidate }));
	return items.length > 0 ? items : null;
}
