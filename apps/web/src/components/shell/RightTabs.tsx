import type { ComponentType } from "react";
import { cn } from "../../lib/cn.js";
import { useUiStore, type RightPanelTab } from "../../state/ui-store.js";
import {
  DiffIcon,
  FilesIcon,
  TerminalIcon,
  GlobeIcon,
  SearchIcon,
  type IconProps,
} from "./ToolbarIcons.js";

const SURFACES: ReadonlyArray<{
  tab: RightPanelTab;
  label: string;
  Icon: ComponentType<IconProps>;
}> = [
  { tab: "diff", label: "Diff", Icon: DiffIcon },
  { tab: "files", label: "Files", Icon: FilesIcon },
  { tab: "terminal", label: "Terminal", Icon: TerminalIcon },
  { tab: "browser", label: "Browser", Icon: GlobeIcon },
  { tab: "search", label: "Search", Icon: SearchIcon },
];

/**
 * RightPaneTabs — the right pane's surface selector. Mirrors the titlebar's
 * Diff/Files/Terminal/Browser toggles; clicking switches `rightPanelTab`.
 * Only Diff is backed by a real surface today.
 */
export function RightPaneTabs() {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  return (
    <div className="tabs">
      {SURFACES.map(({ tab, label, Icon }) => (
        <button
          key={tab}
          type="button"
          onClick={() => setRightPanelTab(tab)}
          aria-pressed={rightPanelTab === tab}
          className={cn("tab", rightPanelTab === tab && "tab--active")}
        >
          <Icon className="size-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
