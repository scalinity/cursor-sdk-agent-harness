import { useCallback, useRef, useState } from "react";
import type { Notepad, NotepadSummary } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { useMountEffect } from "./useMountEffect.js";

export interface UseNotepadsResult {
  notepads: NotepadSummary[];
  loading: boolean;
  selectedNotepad: Notepad | null;
  selectNotepad: (id: string) => Promise<void>;
  createNotepad: (name: string) => Promise<Notepad>;
  updateContent: (id: string, content: string) => Promise<void>;
  renameNotepad: (id: string, name: string) => Promise<void>;
  deleteNotepad: (id: string) => Promise<void>;
  reload: () => void;
}

export function useNotepads(): UseNotepadsResult {
  const [notepads, setNotepads] = useState<NotepadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotepad, setSelectedNotepad] = useState<Notepad | null>(null);
  const mutate = useMutatingRequest();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await httpRequest("/api/notepads");
      setNotepads(data as unknown as NotepadSummary[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useMountEffect(() => {
    void load();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  });

  const selectNotepad = useCallback(async (id: string) => {
    try {
      const data = await httpRequest(`/api/notepads/${id}`);
      setSelectedNotepad(data as unknown as Notepad);
    } catch {
      setSelectedNotepad(null);
    }
  }, []);

  const createNotepad = useCallback(
    async (name: string): Promise<Notepad> => {
      const data = await mutate("/api/notepads", {
        method: "POST",
        body: { name, content: "" },
      });
      const notepad = data as unknown as Notepad;
      void load();
      return notepad;
    },
    [mutate, load],
  );

  const updateContent = useCallback(
    async (id: string, content: string): Promise<void> => {
      const data = await mutate(`/api/notepads/${id}`, {
        method: "PUT",
        body: { content },
      });
      setSelectedNotepad(data as unknown as Notepad);
      void load();
    },
    [mutate, load],
  );

  const renameNotepad = useCallback(
    async (id: string, name: string): Promise<void> => {
      await mutate(`/api/notepads/${id}`, {
        method: "PATCH",
        body: { name },
      });
      void load();
    },
    [mutate, load],
  );

  const deleteNotepad = useCallback(
    async (id: string): Promise<void> => {
      await mutate(`/api/notepads/${id}`, { method: "DELETE" });
      setNotepads((prev) => prev.filter((n) => n.id !== id));
      if (selectedNotepad?.id === id) setSelectedNotepad(null);
    },
    [mutate, selectedNotepad?.id],
  );

  return {
    notepads,
    loading,
    selectedNotepad,
    selectNotepad,
    createNotepad,
    updateContent,
    renameNotepad,
    deleteNotepad,
    reload: load,
  };
}
