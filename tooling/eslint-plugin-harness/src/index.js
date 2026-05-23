import noUseEffectInComponents from "./rules/no-use-effect-in-components.js";
import noHardcodedVisuals from "./rules/no-hardcoded-visuals.js";

const plugin = {
  meta: {
    name: "eslint-plugin-harness",
    version: "0.0.0",
  },
  rules: {
    "no-use-effect-in-components": noUseEffectInComponents,
    "no-hardcoded-visuals": noHardcodedVisuals,
  },
};

export default plugin;
