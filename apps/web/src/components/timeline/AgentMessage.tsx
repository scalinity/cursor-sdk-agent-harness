export interface AgentMessageProps {
  text: string;
}

/**
 * Plain-text assistant render — Phase 09 wires StreamingMarkdown here.
 * For now the accumulated text shows as escaped plain text in a <pre>.
 */
export function AgentMessage({ text }: AgentMessageProps) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-sm bg-accent-bg font-mono text-xs font-bold text-accent-primary">
          A
        </span>
        <span className="font-semibold text-accent-primary">Orrery</span>
      </div>
      <pre className="whitespace-pre-wrap text-base leading-relaxed text-text-secondary">
        {text || "(streaming…)"}
      </pre>
    </div>
  );
}
