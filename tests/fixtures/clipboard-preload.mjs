import { registerHooks } from "node:module";

// Intercept every host copy of the platform addon before Pi loads it.
// This fixture must never access the operator's native clipboard.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/[/\\]native[/\\].*-platform(?:-x11)?\.node$/.test(specifier)) {
      return { url: new URL("./clipboard-helper.cjs", import.meta.url).href, format: "commonjs", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
