/*
 * Button primitive — token-driven, mockup-aligned.
 *
 * Every visual property resolves to a CSS custom property declared in
 * `apps/web/src/styles/tokens.css` and exposed through Tailwind in
 * `apps/web/src/styles/tailwind.css`. Component code contains NO raw
 * color literals, NO arbitrary Tailwind values, NO inline style props
 * for color/spacing/font. The `harness/no-hardcoded-visuals` lint rule
 * fails the build if that contract drifts.
 *
 * Variants
 *   primary   — mockup `.send-btn`: filled accent, dark inverse text.
 *   secondary — mockup `.tb-btn`:   surface-1 plate, hairline border.
 *   ghost     — flat, surfaces on hover only.
 *   danger    — filled danger fill, dark inverse text.
 *
 * Sizes (height tokens, not the 4px spacing scale)
 *   sm — 22px control (matches `.send-btn`).
 *   md — 26px control (matches `.model-picker`).
 *   lg — 32px control.
 *
 * States — every variant covers: default, hover, active (pressed),
 * focus-visible (accent-soft ring), disabled (opacity + cursor),
 * loading (spinner + aria-busy), selected (`data-selected`).
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders the spinner, applies `aria-busy`, and disables interaction. */
  loading?: boolean;
  /** Applies the selected/active tonal style without modifying focus state. */
  selected?: boolean;
  /** Leading icon or glyph slot. */
  leading?: ReactNode;
  /** Trailing icon or glyph slot. */
  trailing?: ReactNode;
  /** Keyboard-shortcut hint (rendered with mono variant, mutated colour). */
  kbd?: ReactNode;
}

function cx(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter(Boolean).join(" ");
}

const base = cx(
  "inline-flex items-center justify-center",
  "select-none whitespace-nowrap",
  "rounded-md border",
  "font-medium",
  "transition-colors duration-fast ease-standard",
  "outline-none",
  "focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-0",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-busy:cursor-progress",
);

const sizes: Record<ButtonSize, string> = {
  sm: cx("h-control-sm px-2 gap-1 text-sm"),
  md: cx("h-control-md px-3 gap-1.5 text-md"),
  lg: cx("h-control-lg px-4 gap-2 text-base"),
};

const variants: Record<ButtonVariant, string> = {
  primary: cx(
    "bg-accent-primary text-text-inverse border-transparent font-semibold",
    "hover:bg-accent-primary-hover",
    "active:bg-accent-primary-pressed",
    "data-[selected=true]:bg-accent-primary-pressed",
  ),
  secondary: cx(
    "bg-surface-1 text-text-secondary border-border-subtle",
    "hover:bg-surface-2 hover:text-text-primary hover:border-border-strong",
    "active:bg-surface-3",
    "data-[selected=true]:bg-accent-bg data-[selected=true]:text-accent-primary data-[selected=true]:border-accent-soft",
  ),
  ghost: cx(
    "bg-transparent text-text-secondary border-transparent",
    "hover:bg-surface-1 hover:text-text-primary",
    "active:bg-surface-2",
    "data-[selected=true]:bg-accent-bg data-[selected=true]:text-accent-primary",
  ),
  danger: cx(
    "bg-danger text-text-inverse border-transparent font-semibold",
    "hover:opacity-90",
    "active:opacity-80",
    "data-[selected=true]:bg-danger-bg data-[selected=true]:text-danger",
  ),
};

const kbdSlot = cx(
  "mono text-2xs text-text-quaternary",
  "ml-1",
);

function Spinner() {
  return (
    <span
      className={cx(
        "inline-block size-3 shrink-0",
        "rounded-full border-2 border-current border-r-transparent",
        "animate-spin",
      )}
      aria-hidden="true"
    />
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    selected = false,
    leading,
    trailing,
    kbd,
    disabled,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  const isInteractionBlocked = disabled || loading;

  return (
    <button
      ref={ref}
      // Default to type="button" so a stray Button inside a <form> does not
      // submit. Caller can override via `type="submit"` when intentional.
      type={type ?? "button"}
      // Toggle-button ARIA default: `selected` maps to aria-pressed="true".
      // For tab/segment/current contexts where aria-pressed is wrong, the
      // caller passes `aria-current`, `aria-selected`, etc. via ...rest and
      // overrides this default (rest spreads AFTER, so caller wins).
      aria-pressed={selected ? true : undefined}
      disabled={isInteractionBlocked}
      aria-busy={loading || undefined}
      data-selected={selected || undefined}
      className={cx(base, sizes[size], variants[variant], className)}
      {...rest}
    >
      {loading ? <Spinner /> : leading}
      {children !== undefined && children !== null ? (
        <span className="inline-flex items-center min-w-0">{children}</span>
      ) : null}
      {trailing}
      {kbd !== undefined && kbd !== null ? <span className={kbdSlot}>{kbd}</span> : null}
    </button>
  );
});
