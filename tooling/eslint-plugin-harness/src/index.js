import noUseEffectInComponents from "./rules/no-use-effect-in-components.js";

const plugin = {
  meta: {
    name: "eslint-plugin-harness",
    version: "0.0.0",
  },
  rules: {
    "no-use-effect-in-components": noUseEffectInComponents,
  },
};

export default plugin;
