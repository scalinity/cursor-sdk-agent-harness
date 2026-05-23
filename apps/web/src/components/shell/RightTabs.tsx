import { cn } from "../../lib/cn.js";

export interface RightTab {
  id: string;
  label: string;
  agentEditing?: boolean;
  active?: boolean;
}

export interface RightTabsProps {
  tabs: RightTab[];
}

export function RightTabs({ tabs }: RightTabsProps) {
  const hasTabs = tabs.length > 0;
  return (
    <div className="tabs">
      {hasTabs ? (
        tabs.map((t) => (
          <div key={t.id} className={cn("tab", t.active && "tab--active")}>
            <span>{t.label}</span>
            {t.agentEditing ? (
              <span className="tab__agent-mark" title="Agent editing" aria-hidden="true" />
            ) : null}
          </div>
        ))
      ) : (
        <div className="flex items-center px-2.5 text-xs text-text-tertiary">
          <span className="mono">No open files</span>
        </div>
      )}
    </div>
  );
}
