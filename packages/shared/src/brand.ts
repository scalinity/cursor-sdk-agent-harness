/** User-visible product identity for Orrery (pragmatic rebrand — internal slugs stay `@harness/*`). */

export const PRODUCT_NAME = "Orrery" as const;

export const PRODUCT_TAGLINE =
  "A local observatory for AI coding agents — built on the Cursor SDK." as const;

export const CURSOR_SDK_CREDIT = "Built on the Cursor SDK (@cursor/sdk)" as const;

export const CURSOR_SDK_DOCS_URL = "https://cursor.com/docs/sdk/typescript" as const;

export const CLI_NAME = "orrery" as const;

/** Back-compat shell command; same binary as {@link CLI_NAME}. */
export const CLI_NAME_ALIAS = "harness" as const;

export const CLI_DISPLAY_NAME = "Orrery" as const;

export const CLI_DISPLAY_NAME_NARROW = "ORRERY" as const;

export const ORRERY_VERSION = "0.0.0" as const;

/** @deprecated Use {@link ORRERY_VERSION}. Kept for internal references during migration. */
export const HARNESS_VERSION = ORRERY_VERSION;
