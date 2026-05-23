export interface ThinkingTraceProps {
  text: string;
}

/**
 * Minimal thinking trace render. Phase 09 will animate appearance and
 * add collapse controls.
 */
export function ThinkingTrace({ text }: ThinkingTraceProps) {
  if (!text) return null;
  return (
    <div className="my-2 border-l-2 border-border-strong px-3 py-0.5 text-sm leading-relaxed text-text-secondary">
      <div className="mb-1 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-uppercase text-text-tertiary">
        reasoning
      </div>
      <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>
    </div>
  );
}
