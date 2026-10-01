const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
function state() {
  if (!process.env.COPY_TEST_CLIPBOARD) throw new Error("Isolated clipboard fixture is required");
  return JSON.parse(readFileSync(process.env.COPY_TEST_CLIPBOARD, "utf8"));
}
exports.getImage = () => null;
exports.getText = () => {
  const s = state();
  if (s.read === "throw") throw new Error("Fixture read failed");
  if (s.read === "unavailable") return undefined;
  if (s.read === "empty") return null;
  return s.text ?? null;
};
exports.setText = (text) => {
  const s = state();
  appendFileSync(process.env.COPY_TEST_CLIPBOARD + ".writes", JSON.stringify(text) + "\n");
  if (s.write === "throw") throw new Error("Fixture write failed");
  if (s.write === "false") return false;
  writeFileSync(process.env.COPY_TEST_CLIPBOARD, JSON.stringify({ ...s, text }));
  if (s.write === "delay") return new Promise(resolve => setTimeout(resolve, 100));
};
