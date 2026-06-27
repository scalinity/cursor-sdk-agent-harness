import { lazy, Suspense, type ComponentType } from "react";
import { Routes, Route } from "react-router-dom";
import { TokensQA } from "../pages/TokensQA.js";
import { AppShell } from "./AppShell.js";
import { useSettingsBootstrap } from "../hooks/useSettings.js";
import { useThemeController } from "../hooks/useTheme.js";

/**
 * `React.lazy` over a named (non-default) export. Adapts the module's named
 * component to the `{ default }` shape `lazy` expects.
 */
function lazyNamed<TName extends string>(
  load: () => Promise<Record<TName, ComponentType>>,
  name: TName,
) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const RunHistory = lazyNamed(() => import("../pages/RunHistory.js"), "RunHistory");
const RunReplay = lazyNamed(() => import("../pages/RunReplay.js"), "RunReplay");
const Usage = lazyNamed(() => import("../pages/Usage.js"), "Usage");
const StreamingQA = lazyNamed(() => import("../pages/StreamingQA.js"), "StreamingQA");
const McpServers = lazyNamed(() => import("../pages/McpServers.js"), "McpServers");
const Subagents = lazyNamed(() => import("../pages/Subagents.js"), "Subagents");
const Settings = lazyNamed(() => import("../pages/Settings.js"), "Settings");
const NotepadsPage = lazyNamed(() => import("../pages/Notepads.js"), "Notepads");

export function App() {
  useSettingsBootstrap();
  useThemeController();

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
      <Route
        path="/notepads"
        element={
          <Suspense fallback={null}>
            <NotepadsPage />
          </Suspense>
        }
      />
      <Route
        path="/settings"
        element={
          <Suspense fallback={null}>
            <Settings />
          </Suspense>
        }
      />
      <Route
        path="/settings/mcp-servers"
        element={
          <Suspense fallback={null}>
            <McpServers />
          </Suspense>
        }
      />
      <Route
        path="/settings/subagents"
        element={
          <Suspense fallback={null}>
            <Subagents />
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
