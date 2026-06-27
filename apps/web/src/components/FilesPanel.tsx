import { useRef, type KeyboardEvent, type UIEvent } from "react";
import type { KnownLanguage } from "@harness/shared";
import { detectLanguageFromPath } from "../lib/code-edit-events.js";
import { formatBytes } from "../lib/format.js";
import { useWorkspaceFiles, type FilePreview } from "../hooks/useWorkspaceFiles.js";
import {
  ArrowLeftIcon,
  FileIcon,
  FolderIcon,
  ReloadIcon,
  XIcon,
} from "./shell/ToolbarIcons.js";
import { SyntaxHighlighter } from "./streaming/SyntaxHighlighter.js";

export function FilesPanel() {
  const {
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
    closePreview,
    draft,
    setDraft,
    editable,
    isDirty,
    saving,
    saveError,
    save,
  } = useWorkspaceFiles();

  const segments = relPath === "" ? [] : relPath.split("/");

  // The back arrow closes the file preview when one is open, otherwise
  // navigates to the parent directory. Disabled only at the workspace root
  // with no preview open (there's nowhere to go back to).
  const canGoBack = previewPath !== null || (listing?.parent != null);
  const onBack = () => {
    if (previewPath !== null) closePreview();
    else goUp();
  };

  return (
    <div className="files-panel">
      <div className="files-panel__header">
        <button
          type="button"
          className="files-panel__nav"
          onClick={onBack}
          disabled={!canGoBack}
          title={previewPath !== null ? "Back to listing" : "Up one folder"}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <div className="files-panel__crumbs">
          <button type="button" className="files-panel__crumb" onClick={() => openDir("")}>
            workspace
          </button>
          {segments.map((seg, i) => {
            const target = segments.slice(0, i + 1).join("/");
            return (
              <span key={target} className="files-panel__crumb-wrap">
                <span className="files-panel__crumb-sep">/</span>
                <button type="button" className="files-panel__crumb" onClick={() => openDir(target)}>
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
        <button type="button" className="files-panel__nav" onClick={reload} title="Refresh">
          <ReloadIcon className="size-3.5" />
        </button>
      </div>

      {previewPath !== null ? (
        <FilePreviewView
          path={previewPath}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          onClose={closePreview}
          editable={editable}
          isDirty={isDirty}
          draft={draft}
          onDraftChange={setDraft}
          onSave={save}
          saving={saving}
          saveError={saveError}
        />
      ) : listLoading && listing === null ? (
        <div className="files-panel__empty">Loading…</div>
      ) : listError !== null ? (
        <div className="files-panel__empty">{listError}</div>
      ) : listing !== null && listing.entries.length === 0 ? (
        <div className="files-panel__empty">This folder is empty</div>
      ) : listing !== null ? (
        <div className="files-panel__list">
          {listing.entries.map((entry) => {
            const isDir = entry.type === "directory";
            const isFile = entry.type === "file";
            const childPath = relPath === "" ? entry.name : `${relPath}/${entry.name}`;
            return (
              <button
                key={entry.name}
                type="button"
                className="files-panel__row"
                disabled={!isDir && !isFile}
                onClick={() => {
                  if (isDir) openDir(childPath);
                  else if (isFile) openFile(childPath);
                }}
              >
                {isDir ? (
                  <FolderIcon className="size-4 files-panel__icon files-panel__icon--dir" />
                ) : (
                  <FileIcon className="size-4 files-panel__icon" />
                )}
                <span className="files-panel__name">{entry.name}</span>
                {isFile && entry.size > 0 ? (
                  <span className="files-panel__size mono">{formatBytes(entry.size)}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File preview/editor sub-views
// ---------------------------------------------------------------------------

interface FilePreviewViewProps {
  path: string;
  preview: FilePreview | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  editable: boolean;
  isDirty: boolean;
  draft: string;
  onDraftChange: (next: string) => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
}

function FilePreviewView({
  path,
  preview,
  loading,
  error,
  onClose,
  editable,
  isDirty,
  draft,
  onDraftChange,
  onSave,
  saving,
  saveError,
}: FilePreviewViewProps) {
  const language = detectLanguageFromPath(path);
  const name = path.split("/").pop() ?? path;

  return (
    <div className="files-panel__preview">
      <div className="files-panel__preview-head">
        <FileIcon className="size-3.5 files-panel__icon" />
        <span className="files-panel__preview-path mono" title={path}>
          {name}
        </span>
        {isDirty ? <span className="files-panel__dirty" title="Unsaved changes" /> : null}
        {saving ? <span className="files-panel__saving">saving…</span> : null}
        <button
          type="button"
          className="files-panel__nav files-panel__preview-close"
          onClick={onClose}
          title="Close preview"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="files-panel__preview-body">
        {loading ? (
          <div className="files-panel__empty">Loading file…</div>
        ) : error !== null ? (
          <div className="files-panel__empty">{error}</div>
        ) : preview === null ? null : preview.binary ? (
          <div className="files-panel__empty">Binary file — preview unavailable</div>
        ) : preview.truncated ? (
          <>
            <div className="files-panel__meta">Large file — read-only preview (truncated).</div>
            <pre className="files-panel__code">
              <SyntaxHighlighter language={language} text={preview.content} />
            </pre>
          </>
        ) : editable ? (
          <>
            {saveError !== null ? (
              <div className="files-panel__meta files-panel__meta--error">{saveError}</div>
            ) : null}
            <FileEditor
              value={draft}
              language={language}
              onChange={onDraftChange}
              onSave={onSave}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable code editor (transparent textarea over Lezer-highlighted pre)
// ---------------------------------------------------------------------------

interface FileEditorProps {
  value: string;
  language: KnownLanguage;
  onChange: (next: string) => void;
  onSave: () => void;
}

function FileEditor({ value, language, onChange, onSave }: FileEditorProps) {
  const highlightRef = useRef<HTMLPreElement>(null);

  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const el = highlightRef.current;
    if (!el) return;
    el.scrollTop = e.currentTarget.scrollTop;
    el.scrollLeft = e.currentTarget.scrollLeft;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+S / Ctrl+S → save
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    // Tab → insert two spaces (don't move focus)
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      // Restore caret after React commits the new value. The controlled
      // textarea sets value on the next render; we restore after paint.
      requestAnimationFrame(() => {
        ta.selectionStart = start + 2;
        ta.selectionEnd = start + 2;
      });
    }
  };

  // Append a trailing space so the highlight layer's last-line height
  // matches the textarea when the content ends with a newline.
  const highlightText = value.endsWith("\n") ? value + " " : value;

  return (
    <div className="files-editor">
      <pre
        ref={highlightRef}
        className="files-editor__highlight"
        aria-hidden="true"
      >
        <SyntaxHighlighter language={language} text={highlightText} />
      </pre>
      <textarea
        className="files-editor__input mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        data-gramm="false"
        wrap="off"
      />
    </div>
  );
}
