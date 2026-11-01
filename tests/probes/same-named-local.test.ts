function it(_name: string, fn: () => void): Promise<void> {
	fn();
	return Promise.resolve();
}

it("same-named local function must be flagged", () => {
	// Probe: bare-name entries are prohibited.
});
