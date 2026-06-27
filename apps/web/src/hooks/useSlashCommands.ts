import { useCallback, useState } from "react";
import type { SlashCommand, ExpandCommandResponse } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { useMountEffect } from "./useMountEffect.js";

function byName(a: SlashCommand, b: SlashCommand): number {
  return a.name.localeCompare(b.name);
}

export interface UseSlashCommandsResult {
  commands: SlashCommand[];
  loading: boolean;
  createCommand: (
    name: string,
    description: string,
    template: string,
  ) => Promise<SlashCommand>;
  updateCommand: (
    id: string,
    fields: { name?: string; description?: string; template?: string },
  ) => Promise<void>;
  deleteCommand: (id: string) => Promise<void>;
  expandCommand: (
    id: string,
    variables: Record<string, string>,
  ) => Promise<string>;
  parseVariables: (template: string) => string[];
  matchingCommands: (input: string) => SlashCommand[];
  reload: () => void;
}

export function useSlashCommands(): UseSlashCommandsResult {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const mutate = useMutatingRequest();

  const load = useCallback(async () => {
    try {
      const data = await httpRequest("/api/commands");
      setCommands(data as unknown as SlashCommand[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useMountEffect(() => {
    void load();
  });

  const createCommand = useCallback(
    async (
      name: string,
      description: string,
      template: string,
    ): Promise<SlashCommand> => {
      const data = await mutate("/api/commands", {
        method: "POST",
        body: { name, description, template },
      });
      const cmd = data as unknown as SlashCommand;
      setCommands((prev) => [...prev, cmd].sort(byName));
      return cmd;
    },
    [mutate],
  );

  const updateCommand = useCallback(
    async (
      id: string,
      fields: { name?: string; description?: string; template?: string },
    ): Promise<void> => {
      const data = await mutate(`/api/commands/${id}`, {
        method: "PUT",
        body: fields,
      });
      const updated = data as unknown as SlashCommand;
      setCommands((prev) =>
        prev.map((c) => (c.id === id ? updated : c)).sort(byName),
      );
    },
    [mutate],
  );

  const deleteCommand = useCallback(
    async (id: string): Promise<void> => {
      await mutate(`/api/commands/${id}`, { method: "DELETE" });
      setCommands((prev) => prev.filter((c) => c.id !== id));
    },
    [mutate],
  );

  const expandCommand = useCallback(
    async (id: string, variables: Record<string, string>): Promise<string> => {
      const data = await mutate(`/api/commands/${id}/expand`, {
        method: "POST",
        body: { variables },
      });
      return (data as unknown as ExpandCommandResponse).expandedText;
    },
    [mutate],
  );

  const parseVariables = useCallback((template: string): string[] => {
    const varPattern = /\{\{(\w+)\}\}/g;
    const vars: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = varPattern.exec(template)) !== null) {
      const name = match[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        vars.push(name);
      }
    }
    return vars;
  }, []);

  const matchingCommands = useCallback(
    (input: string): SlashCommand[] => {
      const trimmed = input.trim();
      if (!trimmed.startsWith("/")) return [];
      const query = trimmed.slice(1).toLowerCase();
      return commands.filter((c) => c.name.toLowerCase().startsWith(query));
    },
    [commands],
  );

  return {
    commands,
    loading,
    createCommand,
    updateCommand,
    deleteCommand,
    expandCommand,
    parseVariables,
    matchingCommands,
    reload: load,
  };
}
