/**
 * Bans hardcoded visual values in component/page source.
 *
 * Catches:
 *   - Arbitrary Tailwind color values:  bg-[#fff], text-[oklch(...)], from-[rgb(...)]
 *   - Arbitrary Tailwind size values:   p-[13px], text-[14px], gap-[2rem]
 *   - Inline JSX `style={{...}}` with color/spacing/font properties.
 *
 * Does NOT flag:
 *   - Variant selectors like `data-[selected=true]:bg-accent-bg` or
 *     `aria-[busy=true]:cursor-progress` — these are CSS variant brackets,
 *     not arbitrary VALUE brackets. The content has no CSS unit or colour.
 *   - Documentation strings such as `"oklch(0.945 0.006 80)"` — they have
 *     no bracket and are not Tailwind utility candidates.
 *
 * Scope (intentional limit):
 *   Raw colour literals OUTSIDE Tailwind utility brackets or inline style
 *   props are not flagged. `pages/TokensQA.tsx` carries OKLCH coordinate
 *   strings as on-screen documentation, and those are not a styling vector.
 *   Real-world styling uses Tailwind brackets or `style={{...}}`, both of
 *   which this rule covers. If a future leak appears via tagged template
 *   literals (styled-components / emotion), expand the rule then.
 *
 * Intentional scope: this rule fires file-wide over every string and
 * template element, not just className attributes. A `sizes` lookup
 * object that ultimately flows into className must also stay token-clean.
 */

const COLOR_HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const COLOR_FN = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color)\s*\(/;
const CSS_UNIT = /\b\d+(?:\.\d+)?\s*(?:px|em|rem|vh|vw|ch|ex|pt|%)\b/;
const BRACKET_GROUP = /\[([^\]]+)\]/g;

const BANNED_STYLE_PROPS = new Set([
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingBlock",
  "paddingInline",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginBlock",
  "marginInline",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "font",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "borderRadius",
  "boxShadow",
  "gap",
  "rowGap",
  "columnGap",
]);

function inspectBracketsInString(str, node, context) {
  // Report every bracket violation in the string rather than stopping after
  // the first match — otherwise a single line like `bg-[#fff] p-[13px]`
  // would only show one error per lint pass.
  for (const m of str.matchAll(BRACKET_GROUP)) {
    const inner = m[1].trim();
    if (COLOR_HEX.test(inner) || COLOR_FN.test(inner)) {
      context.report({
        node,
        messageId: "arbitraryColor",
        data: { value: m[0] },
      });
      continue;
    }
    if (CSS_UNIT.test(inner)) {
      context.report({
        node,
        messageId: "arbitrarySize",
        data: { value: m[0] },
      });
    }
  }
}

function inspectInlineStyle(jsxAttribute, context) {
  if (!jsxAttribute.value || jsxAttribute.value.type !== "JSXExpressionContainer") return;
  const expr = jsxAttribute.value.expression;
  if (!expr || expr.type !== "ObjectExpression") return;
  for (const prop of expr.properties) {
    if (prop.type !== "Property") continue;
    let keyName = "";
    if (prop.key.type === "Identifier") keyName = prop.key.name;
    else if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
      keyName = prop.key.value;
    }
    if (BANNED_STYLE_PROPS.has(keyName)) {
      context.report({
        node: prop,
        messageId: "inlineStyle",
        data: { key: keyName },
      });
    }
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hardcoded visual values (hex/RGB/HSL/OKLCH colours, raw px/em/rem sizes, inline style props) in component/page code. Tokens only.",
    },
    schema: [],
    messages: {
      arbitraryColor:
        "Arbitrary colour value {{value}} is forbidden in component code. Use a token-backed Tailwind utility (e.g. bg-accent-primary) and define new tokens in apps/web/src/styles/tokens.css if needed.",
      arbitrarySize:
        "Arbitrary visual size {{value}} is forbidden in component code. Use a token-backed Tailwind utility (h-control-md, p-3, text-base) or extend tokens.css.",
      inlineStyle:
        "Inline style prop `{{key}}` is forbidden in component code — it bypasses the token system. Use a Tailwind utility class wired to a CSS variable from tokens.css instead.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        inspectBracketsInString(node.value, node, context);
      },
      TemplateElement(node) {
        const raw = node.value.cooked ?? node.value.raw ?? "";
        if (typeof raw !== "string" || raw.length === 0) return;
        inspectBracketsInString(raw, node, context);
      },
      JSXAttribute(node) {
        if (!node.name || node.name.type !== "JSXIdentifier") return;
        if (node.name.name !== "style") return;
        inspectInlineStyle(node, context);
      },
    };
  },
};

export default rule;
