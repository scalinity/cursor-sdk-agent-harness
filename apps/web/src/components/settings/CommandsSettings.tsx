import { useCallback, useState } from "react";
import { useSlashCommands } from "../../hooks/useSlashCommands.js";

export function CommandsSettings() {
  const {
    commands,
    createCommand,
    updateCommand,
    deleteCommand,
    parseVariables,
  } = useSlashCommands();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setTemplate("");
    setEditId(null);
    setShowForm(false);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !template.trim()) return;
      setSubmitting(true);
      try {
        if (editId) {
          await updateCommand(editId, {
            name: name.trim(),
            description: description.trim(),
            template: template.trim(),
          });
        } else {
          await createCommand(name.trim(), description.trim(), template.trim());
        }
        resetForm();
      } catch {
        // error handled in hook
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, template, editId, createCommand, updateCommand, resetForm],
  );

  const handleEdit = useCallback((cmd: { id: string; name: string; description: string; template: string }) => {
    setEditId(cmd.id);
    setName(cmd.name);
    setDescription(cmd.description);
    setTemplate(cmd.template);
    setShowForm(true);
  }, []);

  const handleDelete = useCallback(
    (cmd: { id: string; name: string }) => {
      if (confirm(`Delete command "/${cmd.name}"?`)) {
        void deleteCommand(cmd.id);
      }
    },
    [deleteCommand],
  );

  const variables = parseVariables(template);

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Slash Commands</h2>
      <p className="settings-section__desc">
        Define reusable prompt templates invoked with /commandName in the Composer.
      </p>

      {commands.length > 0 && (
        <div className="command-list">
          {commands.map((cmd) => (
            <div key={cmd.id} className="command-item">
              <div className="command-item__info">
                <span className="command-item__name">/{cmd.name}</span>
                <span className="command-item__desc">{cmd.description}</span>
              </div>
              <div className="command-item__actions">
                <button
                  type="button"
                  onClick={() => handleEdit(cmd)}
                  className="settings-link"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(cmd)}
                  className="settings-link settings-link--danger"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleSubmit} className="command-form">
          <label className="command-form__label">
            Name (lowercase, no spaces)
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-command"
              pattern="^[a-z][a-z0-9_-]*$"
              className="command-form__input"
              required
            />
          </label>
          <label className="command-form__label">
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this command does"
              className="command-form__input"
            />
          </label>
          <label className="command-form__label">
            Template (use {"{{variable}}"} for inputs)
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={"Review this code for {{focus_area}}:\n\n{{code_or_file}}"}
              className="command-form__textarea"
              rows={6}
              required
            />
          </label>
          {variables.length > 0 && (
            <div className="command-form__vars">
              Variables: {variables.map((v) => `{{${v}}}`).join(", ")}
            </div>
          )}
          <div className="command-form__actions">
            <button type="submit" className="settings-link" disabled={submitting}>
              {submitting ? "Saving…" : editId ? "Update Command" : "Create Command"}
            </button>
            <button type="button" onClick={resetForm} className="settings-link">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="settings-link"
        >
          + New Command
        </button>
      )}
    </section>
  );
}
