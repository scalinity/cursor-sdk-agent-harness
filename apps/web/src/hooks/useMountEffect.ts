/**
 * useMountEffect — explicit, intent-revealing wrapper around the
 * mount-only useEffect pattern. CLAUDE.md calls for this name as the
 * convention for "true mount-only external sync"; bare
 * `useEffect(..., [])` works but a grep for it is noisier and a future
 * reader can't easily tell the dependency-empty list is deliberate
 * (versus accidentally missing a dep).
 *
 * The custom ESLint rule `harness/no-use-effect-in-components` is
 * disabled inside `apps/web/src/hooks/**`, so this wrapper is the
 * sanctioned vehicle for any mount-only side effect that components
 * need to trigger via a hook.
 */
import { useEffect } from "react";

export function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
