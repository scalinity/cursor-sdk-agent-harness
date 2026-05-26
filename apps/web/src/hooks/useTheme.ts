import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThemeSetting } from "@harness/shared";
import {
  nextThemeSetting,
  resolveThemeSetting,
  type ResolvedTheme,
} from "../lib/theme-options.js";
import { useSettingsStore } from "../state/settings-store.js";
import { useSettingsActions } from "./useSettings.js";

export type { ResolvedTheme } from "../lib/theme-options.js";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

function themeErrorMessage(value: unknown): string {
  return value instanceof Error ? `theme: ${value.message}` : "theme: update failed";
}

export interface UseThemeResult {
  theme: ThemeSetting;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeSetting) => Promise<void>;
  cycleTheme: () => Promise<void>;
}

export type UseThemeValueResult = Pick<UseThemeResult, "theme" | "resolvedTheme">;

export function useThemeValue(): UseThemeValueResult {
  const theme = useSettingsStore((s) => s.uiTheme);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  return { theme, resolvedTheme };
}

export function useTheme(): UseThemeResult {
  const { theme, resolvedTheme } = useThemeValue();
  const setLastError = useSettingsStore((s) => s.setLastError);
  const { updateSettings } = useSettingsActions();

  const setTheme = useCallback(
    async (next: ThemeSetting) => {
      try {
        await updateSettings({ ui: { theme: next } });
      } catch (e) {
        setLastError(themeErrorMessage(e));
      }
    },
    [setLastError, updateSettings],
  );

  const cycleTheme = useCallback(async () => {
    await setTheme(nextThemeSetting(theme));
  }, [setTheme, theme]);

  return { theme, resolvedTheme, setTheme, cycleTheme };
}

export function useThemeController(): void {
  const theme = useSettingsStore((s) => s.uiTheme);
  const setResolvedTheme = useSettingsStore((s) => s.setResolvedTheme);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(media.matches);

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveThemeSetting(theme, prefersDark),
    [theme, prefersDark],
  );

  useEffect(() => {
    setResolvedTheme(resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, setResolvedTheme]);
}
