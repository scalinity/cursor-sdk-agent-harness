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

/** Back — browser history previous. */
export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

/** Forward — browser history next. */
export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** Reload — re-fetch the current page. */
export function ReloadIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Stop — abort the in-flight load. */
export function StopIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

/** Home — the default workspace (the user's home directory). */
export function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

/** Check — marks the active item in a menu. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Monitor — the "Local" run target indicator. */
export function MonitorIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

/** Sun — light theme preference. */
export function SunIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

/** Moon — dark theme preference. */
export function MoonIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M20.3 14.9A8 8 0 0 1 9.1 3.7 7 7 0 1 0 20.3 14.9Z" />
    </svg>
  );
}

/** Arrow-up — the composer's circular send affordance. */
export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

/** Microphone — voice dictation toggle in the composer. */
export function MicIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

/** File — single document reference. */
export function FileIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

/** Search — magnifying glass. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Code — curly braces (symbol reference). */
export function CodeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="m18 16 4-4-4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m14.5 4-5 16" />
    </svg>
  );
}

/** Book — rules/documentation reference. */
export function BookIcon({ className }: IconProps) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
    </svg>
  );
}
