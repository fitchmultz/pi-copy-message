import { test as nodeTest } from "node:test";
nodeTest("unawaited subtest registration is reported", async (t) => {
	t.test("nested unawaited registration", () => {
		// Nothing to run; the harness reads diagnostics only.
	});
});
