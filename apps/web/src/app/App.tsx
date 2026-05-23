import { Routes, Route } from "react-router-dom";
import { TokensQA } from "../pages/TokensQA.js";

function BootstrapPlaceholder() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-text-primary">
      <div className="rounded-md border border-border-subtle bg-surface-1 px-6 py-4">
        <h1 className="text-lg font-semibold">Harness — bootstrap OK</h1>
        <p className="mt-1 text-md text-text-tertiary">
          Phase 03 design tokens are live. Full UI lands in Phase 08+.
        </p>
        {import.meta.env.DEV ? (
          <p className="mono mt-2 text-xs text-text-quaternary">
            Dev: visit <a className="text-accent-primary hover:underline" href="/__tokens">/__tokens</a> for the token QA fixture.
          </p>
        ) : null}
      </div>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BootstrapPlaceholder />} />
      {/*
       * Dev-only route. import.meta.env.DEV is a compile-time constant in Vite;
       * production bundles drop this branch entirely (and the TokensQA chunk
       * is tree-shaken because nothing else references it in prod).
       */}
      {import.meta.env.DEV ? (
        <Route path="/__tokens" element={<TokensQA />} />
      ) : null}
    </Routes>
  );
}
