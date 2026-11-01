import { test as nodeTest } from "node:test";

import { probeHelper } from "./helper.ts";

nodeTest("floating promise inside a test body must be flagged", async () => {
	probeHelper();
});
