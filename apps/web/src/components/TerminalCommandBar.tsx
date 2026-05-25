import { useCallback, useRef, useState } from "react";
import { useTerminalAI } from "../hooks/useTerminalAI.js";

export interface TerminalCommandBarProps {
  onRun: (command: string) => void;
  onDismiss: () => void;
  cwd: string;
}

export function TerminalCommandBar({ onRun, onDismiss, cwd }: TerminalCommandBarProps) {
  const [prompt, setPrompt] = useState("");
  const { command, explanation, dangerous, isGenerating, generate, clear } =
    useTerminalAI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingCommand, setEditingCommand] = useState(false);
  const [editedCommand, setEditedCommand] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!prompt.trim()) return;
      void generate(prompt.trim(), cwd);
    },
    [prompt, cwd, generate],
  );

  const handleRun = useCallback(() => {
    const cmd = editingCommand ? editedCommand : command;
    if (cmd) {
      onRun(cmd);
      clear();
      onDismiss();
    }
  }, [command, editedCommand, editingCommand, onRun, onDismiss, clear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      } else if (e.key === "Enter" && command && !editingCommand) {
        if (dangerous && !e.metaKey) return;
        e.preventDefault();
        handleRun();
      } else if (e.key === "Tab" && command && !editingCommand) {
        e.preventDefault();
        setEditingCommand(true);
        setEditedCommand(command);
      }
    },
    [command, dangerous, editingCommand, handleRun, onDismiss],
  );

  return (
    <div className="terminal-command-bar" onKeyDown={handleKeyDown}>
      <form onSubmit={handleSubmit} className="terminal-command-bar__form">
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a command…"
          className="terminal-command-bar__input"
          autoFocus
        />
        {isGenerating && (
          <span className="terminal-command-bar__spinner">Generating…</span>
        )}
      </form>

      {command && (
        <div className="terminal-command-bar__result">
          {editingCommand ? (
            <input
              type="text"
              value={editedCommand}
              onChange={(e) => setEditedCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleRun();
                }
              }}
              className="terminal-command-bar__command terminal-command-bar__command--editing"
              autoFocus
            />
          ) : (
            <code className="terminal-command-bar__command">{command}</code>
          )}
          {explanation && (
            <span className="terminal-command-bar__explanation">{explanation}</span>
          )}
          {dangerous && (
            <span className="terminal-command-bar__warning">
              ⚠ This command may be destructive
            </span>
          )}
          <div className="terminal-command-bar__hints">
            <kbd>Enter</kbd> Run
            <kbd>Tab</kbd> Edit
            <kbd>Esc</kbd> Dismiss
          </div>
        </div>
      )}
    </div>
  );
}
