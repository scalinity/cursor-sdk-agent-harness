import type { ThemeSetting } from "@harness/shared";

export type ResolvedTheme = "dark" | "light";

export const THEME_ORDER: readonly ThemeSetting[] = ["dark", "light", "system"];

export const THEME_LABELS: Record<ThemeSetting, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeSetting; label: string }> =
  THEME_ORDER.map((value) => ({ value, label: THEME_LABELS[value] }));

export function resolveThemeSetting(
  theme: ThemeSetting,
  prefersDark: boolean,
): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function nextThemeSetting(theme: ThemeSetting): ThemeSetting {
  const index = THEME_ORDER.indexOf(theme);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? "dark";
}
