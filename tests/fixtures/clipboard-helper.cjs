const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");

/**
 * The isolated clipboard fixture file's shape. Reads validate it field by field so nothing here
 * relies on JSDoc casts.
 *
 * @typedef {{ read?: string | undefined, text?: string | undefined, write?: string | undefined }} ClipboardState
 */

/** @returns {string} */
function clipboardPath() {
	const path = process.env.COPY_TEST_CLIPBOARD;
	if (path === undefined) {
		throw new Error("Isolated clipboard fixture is required");
	}
	return path;
}

/**
 * @param {unknown} value
 * @returns {ClipboardState}
 */
function clipboardState(value) {
	/** @type {ClipboardState} */
	const fields = {};
	if (value === null || typeof value !== "object") {
		return fields;
	}
	/** @type {unknown} */
	const read = Reflect.get(value, "read");
	/** @type {unknown} */
	const text = Reflect.get(value, "text");
	/** @type {unknown} */
	const write = Reflect.get(value, "write");
	if (typeof read === "string") {
		fields.read = read;
	}
	if (typeof text === "string") {
		fields.text = text;
	}
	if (typeof write === "string") {
		fields.write = write;
	}
	return fields;
}

/** @returns {ClipboardState} */
function state() {
	/** @type {unknown} */
	const parsed = JSON.parse(readFileSync(clipboardPath(), "utf8"));
	return clipboardState(parsed);
}

exports.getImage = () => null;
exports.getText = () => {
	const s = state();
	if (s.read === "throw") {
		throw new Error("Fixture read failed");
	}
	if (s.read === "unavailable") {
		return;
	}
	if (s.read === "empty") {
		return null;
	}
	return s.text ?? null;
};
/** @param {string} text */
exports.setText = (text) => {
	const s = state();
	appendFileSync(clipboardPath() + ".writes", JSON.stringify(text) + "\n");
	if (s.write === "throw") {
		throw new Error("Fixture write failed");
	}
	if (s.write === "false") {
		return false;
	}
	writeFileSync(clipboardPath(), JSON.stringify({ ...s, text }));
	if (s.write === "delay") {
		return new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}
	return;
};
