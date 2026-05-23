/*
 * /__tokens — Design Token QA fixture.
 *
 * Renders every token category and the Button primitive in every
 * variant × size × state so a human reviewer can compare against
 * `docs/mockup-design-dna.html` before later phases consume tokens.
 *
 * Mounted only when `import.meta.env.DEV` is true. Production builds
 * never include this route (see App.tsx route guard).
 *
 * Visual labels and OKLCH coordinate strings on this page are LITERAL
 * documentation — they intentionally mirror the values declared in
 * `apps/web/src/styles/tokens.css`. They are not "hardcoded colors":
 * the swatch fill itself comes from the corresponding CSS variable
 * via Tailwind utilities. Keep this file scoped under `pages/`.
 */
import { Button } from "../components/primitives/Button.js";

type Swatch = {
  /** Display name. */
  label: string;
  /** Tailwind class that paints the swatch (must be token-backed). */
  className: string;
  /** Human-readable OKLCH value (documentation, not styling). */
  value: string;
};

const surfaceSwatches: Swatch[] = [
  { label: "background", className: "bg-background", value: "oklch(0.165 0.006 70)" },
  { label: "surface-1", className: "bg-surface-1", value: "oklch(0.188 0.007 70)" },
  { label: "surface-2", className: "bg-surface-2", value: "oklch(0.212 0.008 70)" },
  { label: "surface-3", className: "bg-surface-3", value: "oklch(0.245 0.009 70)" },
];

const borderSwatches: Swatch[] = [
  { label: "border-subtle", className: "bg-border-subtle", value: "oklch(0.282 0.008 70)" },
  { label: "border-strong", className: "bg-border-strong", value: "oklch(0.34 0.009 70)" },
];

const textSwatches: Swatch[] = [
  { label: "text-primary", className: "bg-text-primary", value: "oklch(0.945 0.006 80)" },
  { label: "text-secondary", className: "bg-text-secondary", value: "oklch(0.82 0.007 80)" },
  { label: "text-tertiary", className: "bg-text-tertiary", value: "oklch(0.64 0.008 80)" },
  { label: "text-quaternary", className: "bg-text-quaternary", value: "oklch(0.48 0.009 80)" },
];

const accentSwatches: Swatch[] = [
  { label: "accent-primary", className: "bg-accent-primary", value: "oklch(0.80 0.135 72)" },
  { label: "accent-primary-hover", className: "bg-accent-primary-hover", value: "oklch(0.82 0.14 72)" },
  { label: "accent-primary-pressed", className: "bg-accent-primary-pressed", value: "oklch(0.76 0.13 72)" },
  { label: "accent-soft", className: "bg-accent-soft", value: "oklch(0.46 0.09 72)" },
  { label: "accent-bg", className: "bg-accent-bg", value: "oklch(0.26 0.05 72)" },
];

const semanticSwatches: Swatch[] = [
  { label: "success", className: "bg-success", value: "oklch(0.78 0.13 150)" },
  { label: "success-bg", className: "bg-success-bg", value: "oklch(0.30 0.06 150)" },
  { label: "danger", className: "bg-danger", value: "oklch(0.72 0.16 25)" },
  { label: "danger-bg", className: "bg-danger-bg", value: "oklch(0.30 0.08 25)" },
  { label: "info", className: "bg-info", value: "oklch(0.78 0.10 240)" },
  { label: "violet", className: "bg-violet", value: "oklch(0.76 0.11 295)" },
  { label: "warning", className: "bg-warning", value: "oklch(0.85 0.13 95)" },
  { label: "warning-bg", className: "bg-warning-bg", value: "oklch(0.30 0.06 95)" },
];

const typeScale: Array<{ label: string; className: string; px: string }> = [
  { label: "text-2xs", className: "text-2xs", px: "10.5px" },
  { label: "text-xs", className: "text-xs", px: "11px" },
  { label: "text-sm", className: "text-sm", px: "11.5px" },
  { label: "text-md", className: "text-md", px: "12px" },
  { label: "text-base", className: "text-base", px: "13px" },
  { label: "text-lg", className: "text-lg", px: "14px" },
  { label: "text-xl", className: "text-xl", px: "16px" },
  { label: "text-2xl", className: "text-2xl", px: "20px" },
  { label: "text-3xl", className: "text-3xl", px: "24px" },
];

const radiusScale: Array<{ label: string; className: string; px: string }> = [
  { label: "rounded-none", className: "rounded-none", px: "0px" },
  { label: "rounded-sm", className: "rounded-sm", px: "4px" },
  { label: "rounded-md", className: "rounded-md", px: "5px" },
  { label: "rounded-lg", className: "rounded-lg", px: "7px" },
  { label: "rounded-xl", className: "rounded-xl", px: "12px" },
  { label: "rounded-full", className: "rounded-full", px: "9999px" },
];

function SwatchRow({ swatches }: { swatches: Swatch[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {swatches.map((sw) => (
        <div
          key={sw.label}
          className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-1 p-3"
        >
          <div
            className={`h-12 w-full rounded-sm border border-border-subtle ${sw.className}`}
            aria-label={`${sw.label} swatch`}
          />
          <div className="text-sm font-medium text-text-primary">{sw.label}</div>
          <div className="mono text-2xs text-text-tertiary">{sw.value}</div>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-uppercase text-text-tertiary">
        {title}
      </h2>
      {children}
    </section>
  );
}

const variants = ["primary", "secondary", "ghost", "danger"] as const;
const sizes = ["sm", "md", "lg"] as const;

export function TokensQA() {
  return (
    <main className="min-h-screen bg-background text-text-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-8">
        <header className="flex flex-col gap-1 border-b border-border-subtle pb-4">
          <h1 className="text-2xl font-semibold text-text-primary">Design tokens — QA</h1>
          <p className="text-md text-text-tertiary">
            Source of truth: <span className="mono">apps/web/src/styles/tokens.css</span>. Every
            swatch and control on this page renders from a token, never from a hardcoded value.
          </p>
        </header>

        <Section title="Surface">
          <SwatchRow swatches={surfaceSwatches} />
        </Section>

        <Section title="Border">
          <SwatchRow swatches={borderSwatches} />
        </Section>

        <Section title="Text (rendered as fill swatches for contrast inspection)">
          <SwatchRow swatches={textSwatches} />
        </Section>

        <Section title="Accent">
          <SwatchRow swatches={accentSwatches} />
        </Section>

        <Section title="Semantic">
          <SwatchRow swatches={semanticSwatches} />
        </Section>

        <Section title="Typography (Inter)">
          <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-1 p-4">
            {typeScale.map((t) => (
              <div key={t.label} className="flex items-baseline gap-4">
                <span className="mono w-24 shrink-0 text-2xs text-text-tertiary">{t.label}</span>
                <span className="mono w-16 shrink-0 text-2xs text-text-quaternary">{t.px}</span>
                <span className={`${t.className} text-text-primary`}>
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography (JetBrains Mono)">
          <div className="mono flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-1 p-4">
            {typeScale.map((t) => (
              <div key={t.label} className="flex items-baseline gap-4">
                <span className="w-24 shrink-0 text-2xs text-text-tertiary">{t.label}</span>
                <span className="w-16 shrink-0 text-2xs text-text-quaternary">{t.px}</span>
                <span className={`${t.className} text-text-primary`}>
                  const stream = run.events()
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radii">
          <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
            {radiusScale.map((r) => (
              <div key={r.label} className="flex flex-col items-center gap-2">
                <div
                  className={`h-16 w-16 border border-border-strong bg-surface-2 ${r.className}`}
                />
                <span className="text-2xs text-text-tertiary">{r.label}</span>
                <span className="mono text-2xs text-text-quaternary">{r.px}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Button — variant × size × state matrix">
          <div className="flex flex-col gap-6 rounded-md border border-border-subtle bg-surface-1 p-4">
            {variants.map((variant) => (
              <div key={variant} className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-uppercase text-text-tertiary">
                  {variant}
                </h3>
                {sizes.map((size) => (
                  <div key={size} className="flex flex-wrap items-center gap-3">
                    <span className="mono w-12 shrink-0 text-2xs text-text-quaternary">
                      {size}
                    </span>
                    <Button variant={variant} size={size}>
                      Default
                    </Button>
                    <Button
                      variant={variant}
                      size={size}
                      // `data-hover` doesn't actually flip Tailwind's hover state —
                      // this label exists to invite a hover test from the reviewer.
                    >
                      Hover me
                    </Button>
                    <Button variant={variant} size={size} selected>
                      Selected
                    </Button>
                    <Button variant={variant} size={size} disabled>
                      Disabled
                    </Button>
                    <Button variant={variant} size={size} loading>
                      Loading
                    </Button>
                    <Button
                      variant={variant}
                      size={size}
                      kbd="⌘K"
                      leading={<span aria-hidden>▸</span>}
                    >
                      With kbd
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Focus state (Tab into a button to see the accent-soft ring)">
          <div className="flex flex-wrap gap-3 rounded-md border border-border-subtle bg-surface-1 p-4">
            <Button variant="primary">Primary focus</Button>
            <Button variant="secondary">Secondary focus</Button>
            <Button variant="ghost">Ghost focus</Button>
            <Button variant="danger">Danger focus</Button>
          </div>
        </Section>
      </div>
    </main>
  );
}
