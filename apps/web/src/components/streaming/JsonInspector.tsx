import { useState } from "react";
import { useLazyPayload, type LargePayloadRef } from "../../hooks/useLazyPayload.js";

export interface JsonInspectorProps {
  label: string;
  value?: unknown;
  payloadRef?: LargePayloadRef | undefined;
}

const INITIAL_ENTRY_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLargePayloadRef(value: unknown): LargePayloadRef | null {
  if (!isRecord(value)) return null;
  const nested = value.large_payload_ref;
  if (!isRecord(nested)) return null;
  if (typeof nested.url === "string") {
    return {
      url: nested.url,
      ...(typeof nested.byte_count === "number" ? { byteCount: nested.byte_count } : {}),
    };
  }
  if (typeof nested.event_id !== "string") return null;
  return {
    url: `/api/events/${encodeURIComponent(nested.event_id)}/payload`,
    ...(typeof nested.byte_count === "number" ? { byteCount: nested.byte_count } : {}),
  };
}

function previewString(value: string, expanded: boolean): string {
  if (expanded || value.length <= 256) return JSON.stringify(value);
  return `${JSON.stringify(value.slice(0, 256))}...`;
}

function JsonString({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = value.length > 256;
  return (
    <span className="json-string">
      {previewString(value, expanded)}
      {truncated ? (
        <button type="button" className="json-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "less" : "more"}
        </button>
      ) : null}
    </span>
  );
}

function JsonScalar({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "string") return <JsonString value={value} />;
  if (typeof value === "number") return <span className="json-number">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="json-boolean">{String(value)}</span>;
  return <span className="json-null">undefined</span>;
}

function JsonArrayNode({ value, depth }: { value: unknown[]; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const [limit, setLimit] = useState(INITIAL_ENTRY_LIMIT);
  const visible = value.slice(0, limit);
  return (
    <details className="json-node" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>[{value.length}]</summary>
      {open ? (
        <div className="json-children">
          {visible.map((item, index) => (
            <div key={index.toString()} className="json-row">
              <span className="json-key">{index}</span>
              <JsonTree value={item} depth={depth + 1} />
            </div>
          ))}
          {limit < value.length ? (
            <button type="button" className="json-toggle" onClick={() => setLimit((next) => next + INITIAL_ENTRY_LIMIT)}>
              show more
            </button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function JsonObjectNode({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const [limit, setLimit] = useState(INITIAL_ENTRY_LIMIT);
  const entries = Object.entries(value);
  const visible = entries.slice(0, limit);
  return (
    <details className="json-node" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{`{${entries.length}}`}</summary>
      {open ? (
        <div className="json-children">
          {visible.map(([key, item]) => (
            <div key={key} className="json-row">
              <span className="json-key">{key}</span>
              <JsonTree value={item} depth={depth + 1} />
            </div>
          ))}
          {limit < entries.length ? (
            <button type="button" className="json-toggle" onClick={() => setLimit((next) => next + INITIAL_ENTRY_LIMIT)}>
              show more
            </button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function JsonTree({ value, depth }: { value: unknown; depth: number }) {
  if (Array.isArray(value)) return <JsonArrayNode value={value} depth={depth} />;
  if (isRecord(value)) return <JsonObjectNode value={value} depth={depth} />;
  return <JsonScalar value={value} />;
}

function LargePayloadPlaceholder({ payloadRef }: { payloadRef: LargePayloadRef }) {
  const { value, loaded, loading, error, load } = useLazyPayload(payloadRef);
  if (loaded) return <JsonTree value={value} depth={0} />;
  const bytes = payloadRef.byteCount === undefined ? null : new Intl.NumberFormat("en-US").format(payloadRef.byteCount);
  return (
    <div className="json-large-ref">
      <button type="button" onClick={() => void load()}>
        Payload {bytes ? `${bytes} bytes` : "reference"} - click to load
      </button>
      {loading ? <span>loading...</span> : null}
      {error ? <span className="text-danger">{error}</span> : null}
    </div>
  );
}

export function JsonInspector({ label, value, payloadRef }: JsonInspectorProps) {
  const resolvedPayloadRef = payloadRef ?? parseLargePayloadRef(value);
  return (
    <details className="json-inspector">
      <summary>{label}</summary>
      <div className="json-inspector__body mono">
        {resolvedPayloadRef ? <LargePayloadPlaceholder payloadRef={resolvedPayloadRef} /> : <JsonTree value={value} depth={0} />}
      </div>
    </details>
  );
}
