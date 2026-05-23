/**
 * useKeyboardShortcuts — binds keyboard shortcuts at the document level.
 * Pass an array of `ShortcutBinding`s; the latest array wins on re-render.
 */
import { useEffect, useRef } from "react";

export interface ShortcutBinding {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (event: KeyboardEvent) => void;
  /** If true, calls preventDefault when the binding matches. Defaults to true. */
  preventDefault?: boolean;
}

function matches(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const keyLower = event.key.toLowerCase();
  if (keyLower !== binding.key.toLowerCase()) return false;
  if (binding.meta !== undefined && event.metaKey !== binding.meta) return false;
  if (binding.ctrl !== undefined && event.ctrlKey !== binding.ctrl) return false;
  if (binding.shift !== undefined && event.shiftKey !== binding.shift) return false;
  if (binding.alt !== undefined && event.altKey !== binding.alt) return false;
  return true;
}

export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      for (const binding of bindingsRef.current) {
        if (!matches(event, binding)) continue;
        // ⌘/Ctrl combos on Mac and Windows: treat meta or ctrl interchangeably
        // when `meta` is true but only meta-key was specified.
        if (binding.preventDefault !== false) event.preventDefault();
        binding.handler(event);
        break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
