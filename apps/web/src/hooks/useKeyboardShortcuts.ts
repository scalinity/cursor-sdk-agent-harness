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
  /**
   * If true, the binding fires even when the user is typing inside an editable
   * element (input, textarea, contentEditable). Default false — without this
   * flag a global ⌘. would cancel runs mid-prompt while the user typed a
   * period, and ⌘J would swallow keystrokes inside form fields.
   *
   * Set true for shortcuts that explicitly target editable surfaces (e.g. ⌘K
   * to focus a search input — the user expects it to work regardless of focus).
   */
  allowInEditing?: boolean;
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

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const editing = isEditingTarget(event.target);
      for (const binding of bindingsRef.current) {
        if (!matches(event, binding)) continue;
        // Skip shortcuts while the user is typing into a field unless the
        // binding explicitly opts in. Prevents ⌘. from cancelling live runs
        // when a user holds Cmd and types a period inside the Composer.
        if (editing && !binding.allowInEditing) continue;
        if (binding.preventDefault !== false) event.preventDefault();
        binding.handler(event);
        break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
