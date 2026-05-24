/**
 * ToolbarIcons — a small, dependency-free set of stroke-based line icons for
 * the titlebar and right-pane tabs. 24×24 viewBox (so the path data matches
 * the common line-icon convention); sized via the `className` (e.g. `size-4`
 * = 16px). Color comes from `currentColor`, so callers control it with text
 * utilities wired to design tokens — never a hardcoded fill/stroke here.
 */
export interface IconProps {
  className?: string;
}

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Collapse / expand the left sessions rail. */
export function PanelLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

/** Collapse / expand the right pane. */
export function PanelRightIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

/** Diff — side-by-side split (maps to the real code-edit preview). */
export function DiffIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3" />
      <path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3" />
      <path d="M12 4v16" />
    </svg>
  );
}

/** Files browser. */
export function FilesIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M20 7h-3a2 2 0 0 1-2-2V2" />
      <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" />
      <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" />
    </svg>
  );
}

/** Terminal. */
export function TerminalIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}

/** Browser / web preview. */
export function GlobeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

/** Plus — new agent / add attachment. */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** Chevron-down — disclosure affordance for selectors and groups. */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Folder — workspace group marker. */
export function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

/** Sparkle — "new agent" / compose marker. */
export function SparkIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
    </svg>
  );
}

/** X — remove an attachment chip. */
export function XIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
