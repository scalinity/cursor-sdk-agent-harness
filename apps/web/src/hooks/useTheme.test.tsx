import { act, render } from "@testing-library/react";
import type { SettingsSnapshot, ThemeSetting } from "@harness/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../state/settings-store.js";
import { useTheme, useThemeController } from "./useTheme.js";

const updateSettings = vi.fn<(patch: { ui: { theme: ThemeSetting } }) => Promise<void>>();

vi.mock("./useSettings.js", () => ({
  useSettingsActions: () => ({
    reload: vi.fn(),
    updateSettings,
    updatePricing: vi.fn(),
    setApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  }),
}));

type ThemeProbeState = ReturnType<typeof useTheme>;

let latest: ThemeProbeState | null = null;
let systemPrefersDark = false;
let mediaListeners = new Set<(event: MediaQueryListEvent) => void>();

function settingsSnapshot(theme: ThemeSetting): SettingsSnapshot {
  return {
    defaultModelId: "composer-2-5-fast",
    defaultExecutionMode: "agent",
    defaultSettingSources: ["project", "user"],
    sandboxEnabledByDefault: true,
    defaultReplaySpeed: "instant",
    rawEventRetentionDays: 180,
    ui: { theme },
    pricing: {
      composer25Fast: {
        inputPerMillionUsdMicros: 0,
        outputPerMillionUsdMicros: 0,
        cachedInputPerMillionUsdMicros: 0,
      },
      composer25: {
        inputPerMillionUsdMicros: 0,
        outputPerMillionUsdMicros: 0,
        cachedInputPerMillionUsdMicros: 0,
      },
      promoMultiplier: 1,
      lastVerifiedAt: null,
    },
  };
}

function ThemeProbe() {
  useThemeController();
  latest = useTheme();
  return null;
}

function emitSystemTheme(prefersDark: boolean) {
  systemPrefersDark = prefersDark;
  const event = { matches: prefersDark, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
  for (const listener of mediaListeners) listener(event);
}

beforeEach(() => {
  updateSettings.mockReset();
  latest = null;
  systemPrefersDark = false;
  mediaListeners = new Set();
  document.documentElement.removeAttribute("data-theme");
  useSettingsStore.setState({
    snapshot: null,
    apiKeyPresent: false,
    apiKeyLastValidatedAt: null,
    defaultModelId: null,
    uiTheme: "dark",
    resolvedTheme: "dark",
    loading: false,
    lastError: null,
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: systemPrefersDark,
      media: query,
      onchange: null,
      addEventListener: (_type: "change", listener: EventListener) => {
        mediaListeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeEventListener: (_type: "change", listener: EventListener) => {
        mediaListeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      addListener: (listener) => {
        mediaListeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        mediaListeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: () => true,
    })),
  });
});

describe("useTheme", () => {
  it("applies manual light and dark themes to the document", () => {
    useSettingsStore.getState().setSnapshot(settingsSnapshot("light"));
    render(<ThemeProbe />);

    expect(latest?.theme).toBe("light");
    expect(latest?.resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => useSettingsStore.getState().setSnapshot(settingsSnapshot("dark")));

    expect(latest?.theme).toBe("dark");
    expect(latest?.resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("resolves system theme changes while the preference is system", () => {
    useSettingsStore.getState().setSnapshot(settingsSnapshot("system"));
    render(<ThemeProbe />);

    expect(latest?.resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => emitSystemTheme(true));

    expect(latest?.resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists theme changes under settings.ui.theme", async () => {
    useSettingsStore.getState().setSnapshot(settingsSnapshot("dark"));
    render(<ThemeProbe />);

    await act(async () => {
      await latest?.setTheme("light");
    });

    expect(updateSettings).toHaveBeenCalledWith({ ui: { theme: "light" } });
  });

  it("stores a settings error when theme persistence rejects", async () => {
    updateSettings.mockRejectedValueOnce(new Error("offline"));
    useSettingsStore.getState().setSnapshot(settingsSnapshot("dark"));
    render(<ThemeProbe />);

    await act(async () => {
      await latest?.setTheme("light");
    });

    expect(useSettingsStore.getState().lastError).toBe("theme: offline");
  });
});
