import { probeHelper } from "./helper.ts";
import { test as nodeTest } from "node:test";
probeHelper();

nodeTest("floating promise inside a test body is reported", async () => {
	// Nothing to run; the harness reads diagnostics only.
});
