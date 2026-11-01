import { test as importedTest } from "./helper.ts";

importedTest("same-named import from another module must be flagged", () => {
	// Probe: only node:test declarations qualify.
});
