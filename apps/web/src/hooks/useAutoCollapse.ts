import { useEffect, useState } from "react";

export function useAutoCollapse(input: { status: "running" | "completed" | "error"; pinned: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Stay expanded while running, on error, or when the user pinned it open.
    if (input.status === "running" || input.status === "error" || input.pinned) {
      setCollapsed(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setCollapsed(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [input.pinned, input.status]);

  return { collapsed, setCollapsed };
}
