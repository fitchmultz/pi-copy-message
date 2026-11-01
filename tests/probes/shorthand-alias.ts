import { test as nodeTest } from "node:test";
nodeTest.skip("skip shorthand on an aliased import is still reported", () => {
	// Documented gap; expected to report.
});

nodeTest.todo("todo shorthand on an aliased import is still reported");

nodeTest.only("only shorthand on an aliased import is still reported", () => {
	// Documented gap; expected to report.
});
