import { useCallback, useState } from "react";
import { httpRequest } from "../lib/http-client.js";
import { useMountEffect } from "./useMountEffect.js";

export function useRulesCount(): number {
  const [count, setCount] = useState(0);

  const fetchRules = useCallback(async () => {
    try {
      const data = await httpRequest("/api/rules");
      if (Array.isArray(data)) {
        setCount(data.length);
      }
    } catch {
      // silently ignore — rules are optional
    }
  }, []);

  useMountEffect(() => {
    void fetchRules();
  });

  return count;
}
