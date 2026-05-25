import { useCallback, useState } from "react";
import type { GenerateCommandResponse } from "@harness/shared";
import { useMutatingRequest } from "./useMutatingRequest.js";

export interface UseTerminalAIResult {
  command: string | null;
  explanation: string | null;
  dangerous: boolean;
  isGenerating: boolean;
  error: string | null;
  generate: (prompt: string, cwd: string, recentOutput?: string) => Promise<void>;
  clear: () => void;
}

export function useTerminalAI(): UseTerminalAIResult {
  const [command, setCommand] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [dangerous, setDangerous] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = useMutatingRequest();

  const generate = useCallback(
    async (prompt: string, cwd: string, recentOutput?: string) => {
      setIsGenerating(true);
      setError(null);
      try {
        const data = await mutate("/api/terminal/generate-command", {
          method: "POST",
          body: { prompt, cwd, shell: "zsh", recentOutput },
        });
        const resp = data as unknown as GenerateCommandResponse;
        setCommand(resp.command);
        setExplanation(resp.explanation);
        setDangerous(resp.dangerous);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate command");
        setCommand(null);
        setExplanation(null);
        setDangerous(false);
      } finally {
        setIsGenerating(false);
      }
    },
    [mutate],
  );

  const clear = useCallback(() => {
    setCommand(null);
    setExplanation(null);
    setDangerous(false);
    setError(null);
  }, []);

  return { command, explanation, dangerous, isGenerating, error, generate, clear };
}
