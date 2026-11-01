import { test as nodeTest } from "node:test";

nodeTest("unawaited subtest registration must be flagged", async (t) => {
	t.test("nested unawaited registration", () => {
		// Probe: subtest promises must not be exempted.
	});
});
