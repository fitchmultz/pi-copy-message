import {
	describe as nodeDescribe,
	it as nodeIt,
	suite as nodeSuite,
	test as nodeTest,
} from "node:test";

nodeTest("plain top-level registration is allowed", () => {
	// Probe: mapped registration; no assertions required.
});

	// Probe: mapped shorthand registration.
});


	// Probe: mapped shorthand registration.
});

nodeSuite("suite body registration is allowed", () => {
	nodeIt("it registration is allowed", () => {
		// Probe: mapped registration.
	});
	nodeDescribe("describe registration is allowed", () => {
		// Probe: mapped registration.
	});
});
