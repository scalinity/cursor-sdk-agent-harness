import { useCallback, useState } from "react";
import {
  fileWriteResponseSchema,
  listWorkspaceFilesResponseSchema,
  readWorkspaceFileResponseSchema,
  type ListWorkspaceFilesResponse,
} from "@harness/shared";
import { httpRequest, HttpError } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { useMountEffect } from "./useMountEffect.js";

export interface FilePreview {
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface UseWorkspaceFilesResult {
  /** Current directory, relative to the workspace root ("" = root). */
  relPath: string;
  listing: ListWorkspaceFilesResponse | null;
  listLoading: boolean;
  listError: string | null;
  openDir: (relPath: string) => void;
  goUp: () => void;
  reload: () => void;
  /** Path of the file being previewed, or null when browsing the directory. */
  previewPath: string | null;
  preview: FilePreview | null;
  previewLoading: boolean;
  previewError: string | null;
  openFile: (relPath: string) => void;
  closePreview: () => void;
  // --- editing ---
  /** The working copy of the open file's text (controlled editor value). */
  draft: string;
  setDraft: (next: string) => void;
  /** True when the open file may be edited (loaded, not binary, not truncated). */
  editable: boolean;
  /** True when the draft differs from the last-saved content. */
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  /** Persist the draft via POST /api/files/write. No-op unless editable + dirty. */
  save: () => void;
}

/**
 * Drives the workspace Files surface: directory listing, read-only preview,
 * and in-pane editing with save. The owning component is keyed by the active
 * workspace id, so a workspace switch remounts and resets this hook to the new
 * root (CLAUDE.md "reset with key" pattern). The active workspace id is read
 * once and forwarded to the API so listing/read/write always target the
 * selected workspace.
 *
 * Editing is disabled for binary files and for files whose preview was
 * truncated — saving a truncated prefix would silently destroy the rest of
 * the file, so those stay read-only.
 */
export function useWorkspaceFiles(): UseWorkspaceFilesResult {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const mutate = useMutatingRequest();
  const [relPath, setRelPath] = useState("");
  const [listing, setListing] = useState<ListWorkspaceFilesResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draft, setDraftState] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editable =
    previewPath !== null && preview !== null && !preview.binary && !preview.truncated;
  const isDirty = editable && draft !== savedContent;

  const clearPreview = useCallback(() => {
    setPreviewPath(null);
    setPreview(null);
    setPreviewError(null);
    setDraftState("");
    setSavedContent("");
    setSaveError(null);
  }, []);

  const load = useCallback(
    async (target: string) => {
      setListLoading(true);
      setListError(null);
      try {
        const data = await httpRequest("/api/files/list", {
          query: { path: target, workspaceId: workspaceId ?? undefined },
          responseSchema: listWorkspaceFilesResponseSchema,
        });
        setListing(data);
        setRelPath(data.relPath);
      } catch (e) {
        setListError(e instanceof HttpError ? e.message : "Failed to list files");
      } finally {
        setListLoading(false);
      }
    },
    [workspaceId],
  );

  const openDir = useCallback(
    (target: string) => {
      clearPreview();
      void load(target);
    },
    [clearPreview, load],
  );

  const goUp = useCallback(() => {
    const parent = listing?.parent;
    if (parent !== null && parent !== undefined) openDir(parent);
  }, [listing, openDir]);

  const reload = useCallback(() => {
    void load(relPath);
  }, [load, relPath]);

  const openFile = useCallback(
    async (target: string) => {
      setPreviewPath(target);
      setPreview(null);
      setPreviewError(null);
      setSaveError(null);
      setDraftState("");
      setSavedContent("");
      setPreviewLoading(true);
      try {
        const data = await httpRequest("/api/files/read", {
          query: { path: target, workspaceId: workspaceId ?? undefined },
          responseSchema: readWorkspaceFileResponseSchema,
        });
        setPreview({ content: data.content, truncated: data.truncated, binary: data.binary });
        setDraftState(data.content);
        setSavedContent(data.content);
      } catch (e) {
        setPreviewError(e instanceof HttpError ? e.message : "Failed to read file");
      } finally {
        setPreviewLoading(false);
      }
    },
    [workspaceId],
  );

  const setDraft = useCallback((next: string) => {
    setDraftState(next);
  }, []);

  const save = useCallback(() => {
    if (previewPath === null || preview === null) return;
    if (preview.binary || preview.truncated) return;
    if (draft === savedContent || saving) return;
    const target = previewPath;
    const content = draft;
    setSaving(true);
    setSaveError(null);
    void mutate("/api/files/write", {
      method: "POST",
      body: { path: target, content, workspaceId: workspaceId ?? undefined },
      responseSchema: fileWriteResponseSchema,
    })
      .then(() => {
        setSavedContent(content);
      })
      .catch((e) => {
        setSaveError(e instanceof HttpError ? e.message : "Failed to save file");
      })
      .finally(() => {
        setSaving(false);
      });
  }, [draft, preview, previewPath, savedContent, saving, workspaceId, mutate]);

  useMountEffect(() => {
    void load("");
  });

  return {
    relPath,
    listing,
    listLoading,
    listError,
    openDir,
    goUp,
    reload,
    previewPath,
    preview,
    previewLoading,
    previewError,
    openFile,
    closePreview: clearPreview,
    draft,
    setDraft,
    editable,
    isDirty,
    saving,
    saveError,
    save,
  };
}
