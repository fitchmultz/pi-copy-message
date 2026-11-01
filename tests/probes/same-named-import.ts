import { test as importedTest } from "./helper.ts";

importedTest("same-named import from another module is reported", () => {
	// Only node:test declarations qualify.
});
