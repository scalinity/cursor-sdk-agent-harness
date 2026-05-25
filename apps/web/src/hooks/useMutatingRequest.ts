import { useCallback } from "react";
import type { ZodTypeAny, z } from "zod";
import { mutatingRequest, type MutatingRequestOptions } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";

export type MutateOptions<TResp extends ZodTypeAny | undefined = undefined> = Omit<
  MutatingRequestOptions<TResp>,
  "getCsrfToken" | "refreshCsrfToken"
>;

/**
 * Returns a `mutate(path, options)` function that wires the CSRF
 * read/refresh callbacks into `mutatingRequest` for you, so feature hooks
 * don't each repeat the `getCsrfToken`/`refreshCsrfToken` boilerplate.
 * Calling this hook also subscribes to CSRF bootstrap (via useCsrfToken).
 */
export function useMutatingRequest(): <TResp extends ZodTypeAny | undefined = undefined>(
  path: string,
  options: MutateOptions<TResp>,
) => Promise<TResp extends ZodTypeAny ? z.infer<TResp> : unknown> {
  const csrf = useCsrfToken();
  return useCallback(
    <TResp extends ZodTypeAny | undefined = undefined>(
      path: string,
      options: MutateOptions<TResp>,
    ) =>
      mutatingRequest<TResp>(path, {
        ...options,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken: () => csrf.refresh(),
      }),
    [csrf],
  );
}
