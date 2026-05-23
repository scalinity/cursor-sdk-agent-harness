import { Routes, Route } from "react-router-dom";
import { TokensQA } from "../pages/TokensQA.js";
import { AppShell } from "./AppShell.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
      <Route path="/chat" element={<AppShell />} />
      <Route path="/chat/:agentId" element={<AppShell />} />
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
