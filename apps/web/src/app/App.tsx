import { Routes, Route } from "react-router-dom";

function BootstrapPlaceholder() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="rounded-lg border border-white/10 px-6 py-4">
        <h1 className="text-lg font-semibold">Harness — bootstrap OK</h1>
        <p className="mt-1 text-sm text-white/60">
          Phase 02 monorepo skeleton is running. UI lands in Phase 03+.
        </p>
      </div>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BootstrapPlaceholder />} />
    </Routes>
  );
}
