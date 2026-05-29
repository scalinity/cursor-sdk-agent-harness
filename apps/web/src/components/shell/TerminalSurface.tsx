import "@xterm/xterm/css/xterm.css";
import { useTerminalSession } from "../../hooks/useTerminalSession.js";

/**
 * Right-pane embedded terminal. A thin host for xterm — all imperative wiring
 * lives in `useTerminalSession` (no effects in this component). The shell runs
 * on the server (PTY over `/ws/terminal`) in the active workspace directory.
 */
export function TerminalSurface() {
  const { hostRef, status } = useTerminalSession();

  return (
    <div className="terminal-surface" data-testid="terminal-surface" tabIndex={-1}>
      <div ref={hostRef} className="terminal-surface__host" />
      {status === "disconnected" ? (
        <div className="terminal-surface__status">reconnecting…</div>
      ) : null}
    </div>
  );
}
