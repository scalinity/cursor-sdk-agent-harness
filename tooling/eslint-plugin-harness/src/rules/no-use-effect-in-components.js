/**
 * Bans direct `useEffect` calls. Configured via flat config to apply only to
 * components/pages; hooks are exempt. See CLAUDE.md "React Architecture &
 * Side-Effects Policy" for the rationale and the five replacement patterns.
 */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct useEffect calls outside of dedicated hooks; prefer derive/query/handler/key/useMountEffect patterns.",
    },
    schema: [],
    messages: {
      noUseEffect:
        "Direct `useEffect` is banned here. Prefer deriving state, data-fetching libs, event handlers, key-based remount, or a named useMountEffect wrapper. See CLAUDE.md.",
    },
  },
  create(context) {
    function reportIfUseEffect(node, name) {
      if (name === "useEffect") {
        context.report({ node, messageId: "noUseEffect" });
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier") {
          reportIfUseEffect(node, callee.name);
          return;
        }
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier"
        ) {
          reportIfUseEffect(node, callee.property.name);
        }
      },
    };
  },
};

export default rule;
