import { useUiStore, type RightPanelTab } from "../../state/ui-store.js";
import type { ComponentType } from "react";
import { desktopBridge } from "../../lib/desktop-bridge.js";
import { cn } from "../../lib/cn.js";
import { useTheme } from "../../hooks/useTheme.js";
import { THEME_LABELS } from "../../lib/theme-options.js";
import {
  PanelLeftIcon,
  PanelRightIcon,
  DiffIcon,
  FilesIcon,
  TerminalIcon,
  GlobeIcon,
  PlusIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  type IconProps,
} from "./ToolbarIcons.js";

export interface TitlebarProps {
  onNewSession?: () => void;
  /**
   * Phase 13 — when set, the titlebar shows a "Cancel run" button that
   * forwards the user's intent to `useAgentStream.cancelRun`. Hidden
   * when null/undefined (no active run).
   */
  onCancelRun?: () => void;
}

const PANEL_TABS: ReadonlyArray<{
  tab: RightPanelTab;
  label: string;
  hint: string;
  Icon: ComponentType<IconProps>;
}> = [
  { tab: "diff", label: "Diff", hint: "Diff — agent code edits", Icon: DiffIcon },
  { tab: "files", label: "Files", hint: "Files (not yet available)", Icon: FilesIcon },
  { tab: "terminal", label: "Terminal", hint: "Terminal (not yet available)", Icon: TerminalIcon },
  { tab: "browser", label: "Browser", hint: "Browser (not yet available)", Icon: GlobeIcon },
];

const THEME_ICONS = {
  dark: MoonIcon,
  light: SunIcon,
  system: MonitorIcon,
} as const;

const THEME_LABEL_PREFIX = "Switch theme";

export function Titlebar({ onNewSession, onCancelRun }: TitlebarProps = {}) {
  const codeHidden = useUiStore((s) => s.codeHidden);
  const setCodeHidden = useUiStore((s) => s.setCodeHidden);
  const toggleCodeHidden = useUiStore((s) => s.toggleCodeHidden);
  const railHidden = useUiStore((s) => s.railHidden);
  const toggleRailHidden = useUiStore((s) => s.toggleRailHidden);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const openRightPanel = useUiStore((s) => s.openRightPanel);
  const { theme, cycleTheme } = useTheme();
  const ThemeIcon = THEME_ICONS[theme];

  // The Electron window uses `titleBarStyle: "hiddenInset"` on macOS, so the
  // native traffic-light buttons live in the top-left of our titlebar strip.
  // Tag the root so CSS can reserve their footprint. In the browser /
  // non-darwin Electron the attribute is absent and the rule no-ops.
  const platform = desktopBridge?.platform ?? null;

  // Clicking a panel toggle: if the pane is already open on that tab, collapse
  // it (Cursor's "click the active icon to close" behaviour); otherwise open
  // the pane on that tab.
  const onPanelToggle = (tab: RightPanelTab) => {
    if (!codeHidden && rightPanelTab === tab) {
      setCodeHidden(true);
    } else {
      openRightPanel(tab);
    }
  };

  return (
    <div className="titlebar" {...(platform ? { "data-platform": platform } : {})}>
      {/* Left — collapse / expand the sessions rail. */}
      <button
        type="button"
        onClick={toggleRailHidden}
        aria-label={railHidden ? "Show sidebar" : "Hide sidebar"}
        aria-pressed={!railHidden}
        title={railHidden ? "Show sidebar" : "Hide sidebar"}
        className="tb-icon-btn"
      >
        <PanelLeftIcon className="size-4" />
      </button>

      {/* Flexible drag region — repositions the window in Electron. */}
      <div className="flex-1" />

      {/* Center-right — right-pane surface toggles. */}
      <div className="flex items-center gap-0.5">
        {PANEL_TABS.map(({ tab, hint, Icon }) => {
          const active = !codeHidden && rightPanelTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onPanelToggle(tab)}
              aria-label={active ? `Hide ${hint}` : `Show ${hint}`}
              aria-pressed={active}
              title={hint}
              className={cn("tb-icon-btn", active && "tb-icon-btn--active")}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>

      <span className="tb-sep" aria-hidden="true" />

      <button
        type="button"
        onClick={() => void cycleTheme()}
        aria-label={`${THEME_LABEL_PREFIX}, current ${THEME_LABELS[theme]}`}
        title={`Theme: ${THEME_LABELS[theme]}`}
        className="tb-icon-btn"
      >
        <ThemeIcon className="size-4" />
      </button>

      {onCancelRun ? (
        <button
          type="button"
          onClick={onCancelRun}
          title="Cancel run (⌘.)"
          className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-danger bg-surface-1 px-2 text-md font-medium text-danger hover:bg-surface-2"
        >
          <span>Cancel run</span>
          <span className="mono text-2xs text-text-tertiary">⌘.</span>
        </button>
      ) : null}

      {onNewSession ? (
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New chat"
          title="New chat"
          className="tb-icon-btn"
        >
          <PlusIcon className="size-4" />
        </button>
      ) : null}

      {/* Right — collapse / expand the right pane. */}
      <button
        type="button"
        onClick={toggleCodeHidden}
        aria-label={codeHidden ? "Show panel" : "Hide panel"}
        aria-pressed={!codeHidden}
        title={codeHidden ? "Show panel (⌘J)" : "Hide panel (⌘J)"}
        className={cn("tb-icon-btn", !codeHidden && "tb-icon-btn--active")}
      >
        <PanelRightIcon className="size-4" />
      </button>
    </div>
  );
}
