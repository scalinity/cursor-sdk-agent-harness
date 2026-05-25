import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotepads } from "../hooks/useNotepads.js";

export function Notepads() {
  const navigate = useNavigate();
  const {
    notepads,
    selectedNotepad,
    selectNotepad,
    createNotepad,
    updateContent,
    deleteNotepad,
  } = useNotepads();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the still-pending debounced save (with its own notepad id + content
  // captured) so we can flush it before switching notepads. Without this, a
  // single shared timer would be cleared by the next notepad's first
  // keystroke, silently dropping the previous notepad's unsaved edits.
  const pendingSaveRef = useRef<(() => void) | null>(null);

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingSaveRef.current) {
      const save = pendingSaveRef.current;
      pendingSaveRef.current = null;
      save();
    }
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      flushPendingSave();
      void selectNotepad(id);
    },
    [flushPendingSave, selectNotepad],
  );

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim()) return;
      try {
        flushPendingSave();
        const notepad = await createNotepad(newName.trim());
        setNewName("");
        setCreating(false);
        void selectNotepad(notepad.id);
      } catch {
        // error handled in hook
      }
    },
    [newName, createNotepad, selectNotepad, flushPendingSave],
  );

  const handleContentChange = useCallback(
    (content: string) => {
      if (!selectedNotepad) return;
      const id = selectedNotepad.id;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = () => {
        void updateContent(id, content);
      };
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        pendingSaveRef.current = null;
        void updateContent(id, content);
      }, 2000);
    },
    [selectedNotepad, updateContent],
  );

  const handleDelete = useCallback(
    (id: string, name: string) => {
      if (confirm(`Delete notepad "${name}"?`)) {
        void deleteNotepad(id);
      }
    },
    [deleteNotepad],
  );

  const charCount = selectedNotepad?.content.length ?? 0;
  const tokenEstimate = Math.ceil(charCount / 4);

  return (
    <div className="notepads-page">
      <div className="notepads-page__header">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="settings-page__back"
        >
          ← Back
        </button>
        <h1 className="settings-page__title">Notepads</h1>
      </div>

      <div className="notepads-page__layout">
        <aside className="notepads-sidebar">
          <div className="notepads-sidebar__header">
            {creating ? (
              <form onSubmit={handleCreate} className="notepads-sidebar__form">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Notepad name"
                  className="notepads-sidebar__input"
                  autoFocus
                />
                <button type="submit" className="settings-link">Create</button>
                <button type="button" onClick={() => setCreating(false)} className="settings-link">
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="settings-link"
              >
                + New Notepad
              </button>
            )}
          </div>

          <div className="notepads-sidebar__list">
            {notepads.map((np) => (
              <button
                key={np.id}
                type="button"
                className={`notepads-sidebar__item ${
                  selectedNotepad?.id === np.id ? "notepads-sidebar__item--active" : ""
                }`}
                onClick={() => handleSelect(np.id)}
              >
                <span className="notepads-sidebar__item-name">{np.name}</span>
                <span className="notepads-sidebar__item-meta">
                  {np.contentLength} chars
                </span>
                <button
                  type="button"
                  className="notepads-sidebar__item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(np.id, np.name);
                  }}
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        </aside>

        <main className="notepads-editor">
          {selectedNotepad ? (
            <>
              <textarea
                className="notepads-editor__textarea"
                defaultValue={selectedNotepad.content}
                key={selectedNotepad.id}
                onChange={(e) => handleContentChange(e.target.value)}
                onBlur={(e) => {
                  if (saveTimerRef.current) {
                    clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                  }
                  pendingSaveRef.current = null;
                  void updateContent(selectedNotepad.id, e.target.value);
                }}
                placeholder="Start typing…"
              />
              <div className="notepads-editor__footer">
                <span>{charCount} chars</span>
                <span>~{tokenEstimate} tokens</span>
              </div>
            </>
          ) : (
            <div className="notepads-editor__empty">
              Select a notepad or create a new one
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
