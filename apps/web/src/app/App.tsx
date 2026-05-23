import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { TokensQA } from "../pages/TokensQA.js";
import { AppShell } from "./AppShell.js";

const RunHistory = lazy(async () => {
  const module = await import("../pages/RunHistory.js");
  return { default: module.RunHistory };
});

const RunReplay = lazy(async () => {
  const module = await import("../pages/RunReplay.js");
  return { default: module.RunReplay };
});

const Usage = lazy(async () => {
  const module = await import("../pages/Usage.js");
  return { default: module.Usage };
});

const StreamingQA = lazy(async () => {
  const module = await import("../pages/StreamingQA.js");
  return { default: module.StreamingQA };
});

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
      <Route path="/chat" element={<AppShell />} />
      <Route path="/chat/:agentId" element={<AppShell />} />
      <Route
        path="/runs"
        element={
          <Suspense fallback={null}>
            <RunHistory />
          </Suspense>
        }
      />
      <Route
        path="/runs/:runId/replay"
        element={
          <Suspense fallback={null}>
            <RunReplay />
          </Suspense>
        }
      />
      <Route
        path="/usage"
        element={
          <Suspense fallback={null}>
            <Usage />
          </Suspense>
        }
      />
      {/*
       * Dev-only route. import.meta.env.DEV is a compile-time constant in Vite;
       * production bundles drop this branch entirely (and the TokensQA chunk
       * is tree-shaken because nothing else references it in prod).
       */}
      {import.meta.env.DEV ? (
        <>
          <Route path="/__tokens" element={<TokensQA />} />
          <Route
            path="/__streaming"
            element={
              <Suspense fallback={null}>
                <StreamingQA />
              </Suspense>
            }
          />
        </>
      ) : null}
    </Routes>
  );
}
