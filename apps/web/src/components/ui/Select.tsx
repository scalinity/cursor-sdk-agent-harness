import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn.js";
import { useDismiss } from "../../hooks/useDismiss.js";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Open the menu upward (for triggers near the viewport bottom). */
  placement?: "top" | "bottom";
  /**
   * Classes for the trigger button. Supply the surface look here
   * (background / text / height / padding / radius) so each call site can
   * match its surroundings — the base only owns layout, focus, and the
   * disabled treatment.
   */
  className?: string;
  /** Node rendered before the label, e.g. a status dot. */
  leading?: ReactNode;
  /**
   * Trigger text override. Defaults to the selected option's label, falling
   * back to the raw `value` when no option matches (e.g. an unknown
   * persisted id). The menu still highlights by `value`.
   */
  triggerLabel?: string;
  ariaLabel?: string;
  title?: string;
  id?: string;
}

/**
 * Themed, fully-custom dropdown — a replacement for the native `<select>`,
 * which renders an unstyleable OS-native popup (and on macOS ignores the
 * app's dark token palette entirely).
 *
 * Accessibility: a `button` with `aria-haspopup="listbox"` controls a
 * `role="listbox"`. Focus stays on the button; the active option is tracked
 * via `aria-activedescendant`, so arrow-key navigation needs no focus moves
 * (and therefore no mount effect — this component holds no `useEffect`, per
 * `harness/no-use-effect-in-components`). Outside-click / Escape dismissal
 * lives in `useDismiss`.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  placement = "bottom",
  className,
  leading,
  triggerLabel,
  ariaLabel,
  title,
  id,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const reactId = useId();
  const listId = id ?? `select-${reactId}`;
  const optionId = (index: number) => `${listId}-opt-${index}`;

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex]!.label : value;

  const close = useCallback(() => setOpen(false), []);
  useDismiss({ open, onDismiss: close, containerRef });

  const firstEnabled = (): number => {
    for (let i = 0; i < options.length; i++) if (!options[i]?.disabled) return i;
    return -1;
  };
  const stepEnabled = (from: number, dir: 1 | -1): number => {
    let i = from + dir;
    while (i >= 0 && i < options.length) {
      if (!options[i]?.disabled) return i;
      i += dir;
    }
    return from;
  };

  const openMenu = () => {
    if (disabled) return;
    const start = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabled();
    setActiveIndex(start);
    setOpen(true);
  };

  const commit = (index: number) => {
    const opt = index >= 0 ? options[index] : undefined;
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => stepEnabled(i, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => stepEnabled(i, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabled());
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(stepEnabled(options.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Tab":
        commit(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        title={title}
        className={cn(
          "inline-flex select-none items-center justify-between gap-1.5",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {leading}
        <span className="truncate">{triggerLabel ?? selectedLabel}</span>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={cn("size-3 shrink-0 opacity-70 transition-transform", open && "rotate-180")}
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute left-0 z-50 max-h-60 w-max min-w-full overflow-auto rounded-md border border-border-subtle bg-surface-3 py-1 shadow-2",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.map((opt, index) => {
            const isActive = index === activeIndex;
            const isSelected = opt.value === value;
            return (
              <li
                key={opt.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled}
                onMouseEnter={() => !opt.disabled && setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1 text-sm",
                  isActive ? "bg-accent-bg text-accent-primary" : "text-text-secondary",
                  isSelected && !isActive && "text-text-primary",
                  opt.disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected ? (
                  <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0">
                    <path d="M2.5 6.5 5 9l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
