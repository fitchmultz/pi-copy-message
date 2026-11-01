const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function splitGraphemes(text: string): string[] {
	return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}
function truncateGraphemes(text: string, max: number): string {
	if (max <= 0) {
		return "";
	}
	let count = 0;
	let prefixEnd = 0;
	for (const { index } of graphemeSegmenter.segment(text)) {
		if (count === max) {
			return `${text.slice(0, prefixEnd)}…`;
		}
		if (count === max - 1) {
			prefixEnd = index;
		}
		count++;
	}
	return text;
}
export function safeDisplayText(text: string): string {
	return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}
export function compactPreview(text: string, max = 96): string {
	const preview = safeDisplayText(text).replace(/\s+/gu, " ").trim();
	return truncateGraphemes(preview, max);
}
export function roleLabel(role: string): string {
	switch (role) {
		case "assistant":
			return "assistant";
		case "user":
			return "user";
		case "toolResult":
			return "tool";
		case "bashExecution":
			return "bash";
		case "custom":
			return "custom";
		case "branchSummary":
			return "branch-summary";
		case "compactionSummary":
			return "compaction";
		default:
			const label = safeDisplayText(role).replace(/\s+/gu, " ").trim();
			return label === "" ? "message" : label;
	}
}
export function formatTime(timestamp: unknown): string {
	if (typeof timestamp !== "string") {
		return "";
	}
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
export function isPrintableSearchInput(data: string): boolean {
	return (
		data.length > 0 &&
		Array.from(data).every((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127 && !(code >= 0x80 && code <= 0x9f);
		})
	);
}
