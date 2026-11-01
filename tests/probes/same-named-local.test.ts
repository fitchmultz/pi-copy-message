function it(_name: string, fn: () => void): Promise<void> {
  fn();
  return Promise.resolve();
}

it("same-named local function is reported", () => {
  // Bare-name entries are prohibited.
});
