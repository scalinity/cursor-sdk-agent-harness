import { useRef, type FormEvent } from "react";
import type { BrowserState } from "@harness/shared";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ReloadIcon,
  StopIcon,
} from "../shell/ToolbarIcons.js";

export interface BrowserUrlBarProps {
  state: BrowserState;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
}

/**
 * Back / forward / reload-stop + an editable address field. The input is
 * uncontrolled and keyed on `state.url` (CLAUDE.md "reset with key" pattern):
 * it remounts with the new address after a navigation (or a link click that
 * changes the URL), but typing — which doesn't change `state.url` — never
 * disturbs the field.
 */
export function BrowserUrlBar({
  state,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
}: BrowserUrlBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (value) onNavigate(value);
  };

  return (
    <div className="browser-urlbar">
      <button
        type="button"
        className="browser-urlbar__btn"
        onClick={onBack}
        disabled={!state.canGoBack}
        aria-label="Back"
        title="Back"
      >
        <ArrowLeftIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="browser-urlbar__btn"
        onClick={onForward}
        disabled={!state.canGoForward}
        aria-label="Forward"
        title="Forward"
      >
        <ArrowRightIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="browser-urlbar__btn"
        onClick={state.loading ? onStop : onReload}
        aria-label={state.loading ? "Stop" : "Reload"}
        title={state.loading ? "Stop" : "Reload"}
      >
        {state.loading ? <StopIcon className="size-3.5" /> : <ReloadIcon className="size-3.5" />}
      </button>
      <form className="browser-urlbar__form" onSubmit={submit}>
        <input
          key={state.url}
          ref={inputRef}
          className="browser-urlbar__input"
          defaultValue={state.url}
          placeholder="Enter a URL and press Enter"
          spellCheck={false}
          autoComplete="off"
          aria-label="Address"
        />
      </form>
    </div>
  );
}
