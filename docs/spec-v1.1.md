# Cursor SDK Agent Harness — Full-Stack Technical Specification v1.1

## 1. Goals & Non-goals

### Goals

| Goal | Decision |
|---|---|
| Own the Cursor Agent UX end-to-end | Build a local chat-style harness around `@cursor/sdk` with a custom backend, custom streaming protocol, persistent event log, usage accounting, design-token-driven UI, and custom React surfaces. This keeps interaction design, observability, security posture, and future extension points under the developer’s control. |
| Preserve every meaningful runtime event | Persist normalized SDK events before broadcasting them to clients. This makes live rendering, replay, debugging, crash diagnosis, token/cost attribution, and future analytics consume the same durable event source. |
| Make agent execution visually inspectable | Render assistant markdown, thinking traces, tool-call lifecycle, request events, task/status updates, approval prompts, code-edit previews, cancellation states, token usage, and cost badges as first-class UI surfaces instead of burying them in logs. |
| Preserve a fast, captivating live experience | Use hybrid streaming markdown, RAF-batched leaf text mutation, incremental Lezer syntax highlighting, virtualized long timelines, and WebSocket replay recovery so the UI stays fluid while showing high-fidelity execution detail. |
| Support durable long-lived agents | Treat Cursor durable `agentId` as a primary domain object. Users can resume past agents, inspect last activity, view cost and token totals by agent, and continue contextful conversations across app sessions. |
| Stay local-first and secure by default | Bind to `127.0.0.1`, store secrets only in macOS Keychain, enforce realpath workspace allowlists before agent creation, default local sandboxing on, and keep persistent state in a single local SQLite database. |

### Non-goals

| Non-goal | Decision |
|---|---|
| Multi-user collaboration | The harness is a single-user local app. No accounts, teams, roles, sharing, comments, multiplayer cursors, or collaborative review flows are included. |
| Cloud-first execution | Local execution is the primary mode. Cloud mode is exposed as a secondary, explicitly labeled path and remains conservative until exact `CloudOptions` behavior is verified. |
| Replacing Cursor itself | The harness drives Cursor’s SDK agent and visualizes its activity. It does not reimplement Composer, language intelligence, file indexing, Cursor’s internal tools, or Cursor’s model routing. |
| Generic agent framework abstraction | The backend is intentionally Cursor-specific. Abstractions exist only where the SDK surface is not fully specified, such as cancellation, approvals, usage metadata, and code-edit payload extraction. |
| Hosted deployment | The target is localhost on macOS. Remote hosting, public auth, TLS termination, reverse proxies, mobile clients, and team deployments are deferred. |
| Guaranteed tool-level filesystem confinement beyond SDK support | The app enforces allowlisted cwd roots and server-side preview reads. It does not claim to intercept every SDK-internal tool operation unless the SDK exposes a verified interception or policy hook. |

---

## 2. High-level Architecture

The app is a pnpm monorepo with three packages:

- `apps/server`: Fastify backend, WebSocket server, SQLite persistence, Cursor SDK runtime manager, Keychain integration, workspace policy, cancellation control, usage extraction, and cost calculation.
- `apps/web`: Vite + React 19 UI with Tailwind CSS v4, token-driven design system, streaming chat, run replay, usage dashboards, settings, MCP and subagent management.
- `packages/shared`: Zod schemas, TypeScript protocol types, domain constants, JSON helpers, pricing/usage types, and shared runtime validators.

The backend owns all interaction with `@cursor/sdk`. The frontend never sees API keys, never constructs SDK options directly, never reads local files directly, and never talks to Cursor APIs. The server receives user prompts, creates or resumes an `Agent`, starts a `Run`, consumes `run.stream()`, normalizes every `SDKMessage`, persists it to SQLite, then broadcasts validated WebSocket frames to subscribed clients.

Replay uses the same canonical event log that live streaming uses. A completed run is rendered by replaying stored events in sequence, not by reconstructing from final text. Token and cost accounting attach to the run metadata and final result event; unknown usage is stored as unavailable instead of estimated silently.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser / React UI                              │
│                                                                             │
│  ┌──────────────────────┐   validated WS frames   ┌──────────────────────┐  │
│  │ Chat / Replay Surface│◀────────────────────────│ useAgentStream hook  │  │
│  └──────────┬───────────┘                         └──────────┬───────────┘  │
│             │                                                │              │
│             │ Zustand selectors / append-only event store    │              │
│             ▼                                                ▼              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ StreamingMarkdown / ThinkingTrace / ToolCallCard / CodeEditPreview    │  │
│  │ CostBadge / ApprovalPrompt / JsonInspector / SyntaxHighlighter        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│             ▲                                                ▲              │
│             │ REST validated with Zod                         │              │
│             ▼                                                │              │
│  ┌──────────────────────┐                         ┌──────────────────────┐  │
│  │ Settings / MCP /     │                         │ Usage Dashboard      │  │
│  │ Subagents / Agents   │                         │ daily/weekly totals  │  │
│  └──────────────────────┘                         └──────────────────────┘  │
└───────────────────────────────▲─────────────────────────────────────────────┘
                                │
                                │ WebSocket + REST
                                │ Zod validated both directions
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Fastify Server                                  │
│                                                                             │
│  ┌──────────────┐   submit prompt    ┌───────────────────────────────────┐  │
│  │ REST Routes  │───────────────────▶│ Agent Runtime Manager             │  │
│  └──────┬───────┘                    │ - create/resume agents            │  │
│         │                            │ - own active runs                 │  │
│         │                            │ - AbortController per run         │  │
│         │                            │ - consume run.stream()            │  │
│         │                            └───────────────┬───────────────────┘  │
│         │                                            │ SDKMessage            │
│         ▼                                            ▼                       │
│  ┌──────────────┐                    ┌───────────────────────────────────┐  │
│  │ SQLite /     │◀───────────────────│ Event Normalization               │  │
│  │ Drizzle ORM  │   persist first    │ - validate discriminant           │  │
│  └──────┬───────┘                    │ - assign seq/event_id             │  │
│         │                            │ - delta-or-snapshot normalization │  │
│         │                            │ - derive code edit previews       │  │
│         │                            │ - extract final usage/cost        │  │
│         │                            └───────────────┬───────────────────┘  │
│         │                                            │ canonical event       │
│         ▼                                            ▼                       │
│  ┌──────────────┐                    ┌───────────────────────────────────┐  │
│  │ Run Replay   │◀──────────────────▶│ Run Event Bus                     │  │
│  │ Query Layer  │                    │ - subscribers by run_id           │  │
│  └──────┬───────┘                    │ - heartbeat/gap recovery          │  │
│         │                            └───────────────┬───────────────────┘  │
│         ▼                                            │                      │
│  ┌──────────────┐                                    │                      │
│  │ Usage Query  │                                    │                      │
│  │ Aggregates   │                                    │                      │
│  └──────────────┘                                    │                      │
└───────────────────────────────────────▲──────────────┴──────────────────────┘
                                        │
                                        │ @cursor/sdk
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Cursor Agent SDK                                │
│                                                                             │
│ Agent.create / Agent.get / Agent.list                                       │
│ agent.send(prompt[, { signal } if supported]) → Run                         │
│ run.stream() → SDKMessage async iterator                                    │
│ run.wait() → final result data, model/duration/git metadata, usage if exposed│
└─────────────────────────────────────────────────────────────────────────────┘
```

Process-boundary decisions:

- The SDK runs only in the server process because API keys, workspace paths, MCP configs, local execution controls, cancellation handles, and usage attribution must remain server-owned.
- The WebSocket protocol is normalized instead of forwarding raw SDK objects because the UI needs stable replay semantics, sequence numbers, schema versioning, gap recovery, and large-payload references.
- SQLite is the system of record for agents, runs, events, settings, MCP configs, subagents, workspace allowlists, and usage metadata.
- The UI renders from canonical events and derived projections. It never branches on raw SDK payloads except inside `JsonInspector`.
- The design system is token-first. All visual output after Phase 0.5 consumes CSS custom properties extracted from the reference image.

---

## 3. Repository Layout

```text
cursor-sdk-agent-harness/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   │   # Process entrypoint: load config, create dependencies, start Fastify HTTP/WS server.
│   │   │   ├── app.ts
│   │   │   │   # Fastify app factory used by production startup and integration tests.
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   │   # Validated environment variables and default local paths.
│   │   │   │   ├── runtime-config.ts
│   │   │   │   │   # Merges env, SQLite settings, and non-secret file config.
│   │   │   │   └── paths.ts
│   │   │   │       # macOS application-support paths and path normalization helpers.
│   │   │   ├── db/
│   │   │   │   ├── client.ts
│   │   │   │   │   # SQLite connection, Drizzle client, pragmas, transaction helpers.
│   │   │   │   ├── schema.ts
│   │   │   │   │   # Drizzle schema mirroring the DDL in this spec.
│   │   │   │   ├── migrations/
│   │   │   │   │   # SQL migration files generated and reviewed before commit.
│   │   │   │   └── repositories/
│   │   │   │       ├── agents.repo.ts
│   │   │   │       ├── runs.repo.ts
│   │   │   │       ├── events.repo.ts
│   │   │   │       ├── settings.repo.ts
│   │   │   │       ├── mcp-servers.repo.ts
│   │   │   │       ├── subagents.repo.ts
│   │   │   │       └── workspace-allowlist.repo.ts
│   │   │   ├── keychain/
│   │   │   │   ├── cursor-api-key.ts
│   │   │   │   │   # keytar-backed API-key read/write/delete/presence helpers.
│   │   │   │   └── local-session-secret.ts
│   │   │   │       # keytar-backed local CSRF/session secret for browser access.
│   │   │   ├── sdk/
│   │   │   │   ├── agent-runtime-manager.ts
│   │   │   │   │   # Owns active Agent handles, Run handles, AbortControllers, and run tasks.
│   │   │   │   ├── agent-options-builder.ts
│   │   │   │   │   # Converts persisted settings into Agent.create options.
│   │   │   │   ├── sdk-message-normalizer.ts
│   │   │   │   │   # Converts SDKMessage into canonical internal events.
│   │   │   │   ├── sdk-event-guards.ts
│   │   │   │   │   # Defensive discriminant/type guards for raw SDK stream events.
│   │   │   │   ├── code-edit-extractors.ts
│   │   │   │   │   # Best-effort parsers for patch/diff/edit-shaped tool payloads.
│   │   │   │   ├── usage-extractor.ts
│   │   │   │   │   # Extracts token usage from final result or stream metadata when available.
│   │   │   │   ├── cost-calculator.ts
│   │   │   │   │   # Computes micro-USD cost from usage and pricing settings.
│   │   │   │   ├── approval-responder.ts
│   │   │   │   │   # Narrow seam for verified SDK request approval/denial mechanism.
│   │   │   │   └── run-controller.ts
│   │   │   │       # Cancellation path: AbortController primary, run.cancel fallback, explicit seam otherwise.
│   │   │   ├── ws/
│   │   │   │   ├── websocket-plugin.ts
│   │   │   │   │   # Fastify websocket registration and connection lifecycle.
│   │   │   │   ├── connection-registry.ts
│   │   │   │   │   # Tracks sockets, subscriptions, heartbeats, command dedupe, and resume cursors.
│   │   │   │   ├── run-event-bus.ts
│   │   │   │   │   # In-memory pub/sub by run_id, fed only after DB persistence.
│   │   │   │   ├── ws-frame-validator.ts
│   │   │   │   │   # Shared Zod schemas applied at the server boundary.
│   │   │   │   └── replay-sender.ts
│   │   │   │       # Sends stored events from after_seq for reconnect/gap recovery.
│   │   │   ├── routes/
│   │   │   │   ├── agents.routes.ts
│   │   │   │   ├── runs.routes.ts
│   │   │   │   ├── events.routes.ts
│   │   │   │   ├── settings.routes.ts
│   │   │   │   ├── usage.routes.ts
│   │   │   │   ├── mcp-servers.routes.ts
│   │   │   │   ├── subagents.routes.ts
│   │   │   │   ├── workspace-allowlist.routes.ts
│   │   │   │   └── health.routes.ts
│   │   │   ├── security/
│   │   │   │   ├── origin-policy.ts
│   │   │   │   │   # CORS and WebSocket Origin validation.
│   │   │   │   ├── csrf.ts
│   │   │   │   │   # Local CSRF cookie/header validation.
│   │   │   │   └── workspace-policy.ts
│   │   │   │       # realpath-based allowlist enforcement.
│   │   │   ├── observability/
│   │   │   │   ├── logger.ts
│   │   │   │   │   # Structured pino logger with secret redaction.
│   │   │   │   └── metrics.ts
│   │   │   │       # Local in-memory counters and timing histograms.
│   │   │   └── tests/
│   │   │       ├── fixtures/
│   │   │       │   # Mock SDK streams, usage payload variants, code-edit payload variants.
│   │   │       ├── unit/
│   │   │       └── integration/
│   │   ├── drizzle.config.ts
│   │   │   # Drizzle migration configuration.
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   └── web/
│       ├── src/
│       │   ├── main.tsx
│       │   │   # React entrypoint.
│       │   ├── app/
│       │   │   ├── App.tsx
│       │   │   │   # Route tree and global providers only.
│       │   │   ├── routes.tsx
│       │   │   │   # Typed route definitions.
│       │   │   └── error-boundaries.tsx
│       │   │       # Shared route and streaming error boundaries.
│       │   ├── api/
│       │   │   ├── http-client.ts
│       │   │   │   # Fetch wrapper with Zod response validation and CSRF header.
│       │   │   └── endpoints.ts
│       │   │       # Typed REST endpoint functions.
│       │   ├── ws/
│       │   │   ├── websocket-client.ts
│       │   │   │   # Low-level WebSocket wrapper with validation and backoff.
│       │   │   └── frame-handlers.ts
│       │   │       # Converts server frames into store actions.
│       │   ├── stores/
│       │   │   ├── run-store.ts
│       │   │   │   # Zustand append-only event state, run projections, text/markdown buffers.
│       │   │   ├── usage-store.ts
│       │   │   │   # Usage aggregates, cost totals, pricing freshness indicators.
│       │   │   ├── settings-store.ts
│       │   │   ├── agent-store.ts
│       │   │   └── ui-store.ts
│       │   ├── hooks/
│       │   │   ├── useWebSocket.ts
│       │   │   ├── useAgentStream.ts
│       │   │   ├── useRunHistory.ts
│       │   │   ├── useUsage.ts
│       │   │   ├── useAgents.ts
│       │   │   ├── useSettings.ts
│       │   │   ├── useMcpServers.ts
│       │   │   ├── useSubagents.ts
│       │   │   ├── useWorkspaceAllowlist.ts
│       │   │   ├── useApprovalActions.ts
│       │   │   ├── useStreamingMarkdown.ts
│       │   │   ├── useStreamingTextNode.ts
│       │   │   ├── useCodeEditAnimation.ts
│       │   │   ├── useIncrementalSyntaxHighlighter.ts
│       │   │   ├── useVirtualizedEvents.ts
│       │   │   ├── useKeyboardShortcuts.ts
│       │   │   └── useErrorReporter.ts
│       │   ├── components/
│       │   │   ├── primitives/
│       │   │   │   ├── Button.tsx
│       │   │   │   ├── Dialog.tsx
│       │   │   │   ├── Panel.tsx
│       │   │   │   ├── Tabs.tsx
│       │   │   │   ├── Tooltip.tsx
│       │   │   │   └── Badge.tsx
│       │   │   ├── streaming/
│       │   │   │   ├── Message.tsx
│       │   │   │   ├── StreamingMarkdown.tsx
│       │   │   │   ├── StreamingText.tsx
│       │   │   │   ├── ThinkingTrace.tsx
│       │   │   │   ├── ToolCallCard.tsx
│       │   │   │   ├── ToolCallLane.tsx
│       │   │   │   ├── CodeEditPreview.tsx
│       │   │   │   ├── SyntaxHighlighter.tsx
│       │   │   │   ├── IterationBoundary.tsx
│       │   │   │   ├── SystemBanner.tsx
│       │   │   │   ├── ApprovalPrompt.tsx
│       │   │   │   ├── JsonInspector.tsx
│       │   │   │   ├── RunStatusPill.tsx
│       │   │   │   └── CostBadge.tsx
│       │   │   ├── usage/
│       │   │   │   ├── UsageSummaryCards.tsx
│       │   │   │   ├── UsageBreakdownTable.tsx
│       │   │   │   ├── UsageTrendChart.tsx
│       │   │   │   └── PricingFreshnessBanner.tsx
│       │   │   ├── layout/
│       │   │   │   ├── AppShell.tsx
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   └── Header.tsx
│       │   │   └── settings/
│       │   │       ├── ModelSelector.tsx
│       │   │       ├── SettingSourcesPicker.tsx
│       │   │       ├── SandboxToggle.tsx
│       │   │       ├── WorkspaceAllowlistEditor.tsx
│       │   │       ├── McpServerEditor.tsx
│       │   │       ├── SubagentEditor.tsx
│       │   │       ├── PricingSettingsPanel.tsx
│       │   │       └── CloudModePanel.tsx
│       │   ├── pages/
│       │   │   ├── ChatPage.tsx
│       │   │   ├── RunHistoryPage.tsx
│       │   │   ├── RunReplayPage.tsx
│       │   │   ├── UsagePage.tsx
│       │   │   ├── SettingsPage.tsx
│       │   │   ├── McpServersPage.tsx
│       │   │   ├── SubagentsPage.tsx
│       │   │   └── AgentPickerPage.tsx
│       │   ├── styles/
│       │   │   ├── tailwind.css
│       │   │   │   # Tailwind v4 entrypoint.
│       │   │   └── tokens.css
│       │   │       # CSS custom properties extracted from the design reference image.
│       │   └── tests/
│       │       ├── unit/
│       │       └── e2e/
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── vitest.config.ts
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── index.ts
│       │   │   # Public exports for schemas, types, constants, and helpers.
│       │   ├── json.ts
│       │   │   # JsonValue schema and safe stringify helpers.
│       │   ├── models.ts
│       │   │   # Supported model IDs and labels.
│       │   ├── pricing.ts
│       │   │   # Pricing settings keys, micro-USD helpers, and usage schemas.
│       │   ├── sdk-surface.ts
│       │   │   # SDK message types copied from ground-truth surface.
│       │   ├── domain.ts
│       │   │   # Agent, run, event, setting, MCP, subagent, usage domain schemas.
│       │   ├── ws-protocol.ts
│       │   │   # Client/server WebSocket frame schemas and inferred TS types.
│       │   ├── rest-contracts.ts
│       │   │   # REST request/response schemas.
│       │   └── constants.ts
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/
│   ├── dev.mjs
│   │   # Starts server and Vite dev server with local defaults.
│   ├── migrate.mjs
│   │   # Runs Drizzle migrations.
│   ├── extract-design-tokens.mjs
│   │   # Helper script used in Phase 0.5 to materialize design tokens from reference image notes.
│   └── reset-local-db.mjs
│       # Deletes local DB after explicit confirmation.
│
├── design-reference/
│   ├── reference.png
│   │   # Source-of-truth visual reference image supplied alongside this spec.
│   └── token-notes.md
│       # Manual extraction notes produced in Phase 0.5.
│
├── .env.example
│   # Non-secret environment variable examples; no API keys committed.
├── .gitignore
├── package.json
│   # Workspace root scripts and dependency policy.
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.js
└── README.md
```

---

## 3.5. Design System

### Source of Truth

The visual source of truth is a single reference image supplied alongside this specification at:

```text
design-reference/reference.png
```

Implementation uses the reference image to extract a concrete token set before any production UI work begins. Components must not invent colors, spacing, typography, shadows, or motion timings independently at later phases. Phase 0.5 materializes the design system as CSS custom properties in:

```text
apps/web/src/styles/tokens.css
```

Rationale: a long-lived agent harness will accumulate many streaming surfaces, inspectors, settings pages, and dashboards. A reference-image-driven token pass prevents phase-by-phase visual drift and keeps later implementation agents from creating conflicting local styles.

### Required Token Categories

#### Color Tokens

The token set must include these categories and exact semantic names. Concrete values are extracted from the reference image and written as CSS custom properties.

```css
:root {
  /* Surface */
  --color-background: #000000;
  --color-surface-1: #000000;
  --color-surface-2: #000000;
  --color-surface-3: #000000;

  /* Text */
  --color-text-primary: #ffffff;
  --color-text-secondary: #ffffff;
  --color-text-tertiary: #ffffff;
  --color-text-inverse: #000000;

  /* Border */
  --color-border-subtle: #ffffff;
  --color-border-default: #ffffff;
  --color-border-strong: #ffffff;

  /* Accent */
  --color-accent-primary: #ffffff;
  --color-accent-primary-hover: #ffffff;
  --color-accent-primary-pressed: #ffffff;

  /* Semantic */
  --color-success: #ffffff;
  --color-warning: #ffffff;
  --color-danger: #ffffff;
  --color-info: #ffffff;
}
```

The placeholder values above are replaced in Phase 0.5. A pull request may not merge with placeholder token values.

#### Typography Tokens

```css
:root {
  --font-family-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-family-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;

  --line-height-tight: 1.15;
  --line-height-snug: 1.3;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.7;

  --letter-spacing-tight: -0.02em;
  --letter-spacing-normal: 0em;
  --letter-spacing-wide: 0.04em;

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

The actual family choices are extracted from the reference image when identifiable. If the image does not imply a specific typeface, the listed defaults are used because they are native-friendly and legible for dense coding surfaces.

#### Spacing Tokens

Spacing uses a 4px-based scale from 0 through 64. Components may use only these tokens.

```css
:root {
  --space-0: 0px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 32px;
  --space-9: 36px;
  --space-10: 40px;
  --space-11: 44px;
  --space-12: 48px;
  --space-13: 52px;
  --space-14: 56px;
  --space-15: 60px;
  --space-16: 64px;
}
```

#### Radius Tokens

```css
:root {
  --radius-none: 0px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 20px;
  --radius-full: 9999px;
}
```

#### Motion Tokens

```css
:root {
  --duration-instant: 0ms;
  --duration-fast: 100ms;
  --duration-normal: 180ms;
  --duration-slow: 320ms;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-accelerate: cubic-bezier(0.3, 0, 1, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

Motion is used for panel expansion, tool-call status transitions, caret blinking, replay controls, and approval prompt state changes. Token-driven motion keeps the live UI energetic without inconsistent timing.

#### Elevation Tokens

```css
:root {
  --shadow-0: none;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.08);
  --shadow-2: 0 4px 12px rgb(0 0 0 / 0.12);
  --shadow-3: 0 12px 32px rgb(0 0 0 / 0.16);
  --shadow-4: 0 24px 64px rgb(0 0 0 / 0.24);
}
```

Concrete shadow opacity and blur values are adjusted to match the reference image.

### Tailwind v4 Theme Integration

Tailwind v4 reads tokens directly from CSS custom properties. `tailwind.css` imports `tokens.css` before theme definitions.

```css
@import "./tokens.css";
@import "tailwindcss";

@theme {
  --color-background: var(--color-background);
  --color-surface-1: var(--color-surface-1);
  --color-surface-2: var(--color-surface-2);
  --color-surface-3: var(--color-surface-3);

  --color-text-primary: var(--color-text-primary);
  --color-text-secondary: var(--color-text-secondary);
  --color-text-tertiary: var(--color-text-tertiary);
  --color-text-inverse: var(--color-text-inverse);

  --color-border-subtle: var(--color-border-subtle);
  --color-border-default: var(--color-border-default);
  --color-border-strong: var(--color-border-strong);

  --color-accent-primary: var(--color-accent-primary);
  --color-accent-primary-hover: var(--color-accent-primary-hover);
  --color-accent-primary-pressed: var(--color-accent-primary-pressed);

  --color-success: var(--color-success);
  --color-warning: var(--color-warning);
  --color-danger: var(--color-danger);
  --color-info: var(--color-info);

  --font-sans: var(--font-family-sans);
  --font-mono: var(--font-family-mono);
}
```

Spacing, radius, duration, easing, and shadow tokens are exposed through utility classes defined in `tailwind.css` and reused by components.

### Hard Rule for Component Styling

No component code may contain hardcoded:

- hex, RGB, HSL, or named colors;
- pixel/rem spacing values outside token-backed Tailwind utilities;
- font families or raw font sizes;
- ad-hoc border radii;
- ad-hoc box shadows;
- raw transition durations or easing curves.

Allowed component styles:

- Tailwind utility classes mapped to tokens;
- CSS variables defined in `tokens.css`;
- state variants using token-backed utilities;
- data attributes for stateful styling.

Forbidden example:

```tsx
<button className="rounded-[7px] bg-[#6d5efc] px-[13px] duration-[140ms]" />
```

Allowed example:

```tsx
<button className="rounded-md bg-accent-primary px-3 py-2 transition duration-fast ease-standard hover:bg-accent-primary-hover active:bg-accent-primary-pressed" />
```

### Design QA Checklist

Every visually significant phase must verify:

| Check | Required outcome |
|---|---|
| Token usage | No hardcoded visual values in component code. |
| Reference alignment | New surfaces match the reference image’s contrast, density, radius, and rhythm. |
| State coverage | Default, hover, active, focused, disabled, loading, error, and selected states use tokenized variants. |
| Dark/light assumption | The implementation follows the reference image. A second theme is not added unless the reference provides it. |
| Streaming readability | Text, markdown, code, and tool cards stay legible during high-frequency updates. |
| Accessibility | Focus rings are visible, color is not the only state indicator, and text contrast is checked against extracted palette. |

---

## 4. Backend Design

### Fastify App Structure

The Fastify server is created through a pure `buildApp()` function so tests can instantiate the full app without opening a port.

```ts
// apps/server/src/app.ts
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger,
    trustProxy: false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(securityPlugin, deps);
  await app.register(databasePlugin, deps);
  await app.register(settingsPlugin, deps);
  await app.register(websocketPlugin, deps);

  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(agentRoutes, { prefix: "/api/agents" });
  await app.register(runRoutes, { prefix: "/api/runs" });
  await app.register(eventRoutes, { prefix: "/api/events" });
  await app.register(settingsRoutes, { prefix: "/api/settings" });
  await app.register(usageRoutes, { prefix: "/api/usage" });
  await app.register(mcpServerRoutes, { prefix: "/api/mcp-servers" });
  await app.register(subagentRoutes, { prefix: "/api/subagents" });
  await app.register(workspaceAllowlistRoutes, { prefix: "/api/workspace-allowlist" });

  app.addHook("onReady", async () => {
    await deps.db.verifyMigrations();
    await deps.settings.ensureDefaultSettings();
    await deps.runtime.reconcileInterruptedRuns();
  });

  app.addHook("onClose", async () => {
    await deps.runtime.shutdown({ reason: "server_close" });
    await deps.db.close();
  });

  return app;
}
```

#### Plugins

| Plugin | Responsibility |
|---|---|
| `securityPlugin` | Enforces loopback bind assumptions, CORS posture, CSRF header checks, and WebSocket Origin validation. |
| `databasePlugin` | Opens SQLite, enables `PRAGMA foreign_keys = ON`, enables WAL, applies busy timeout, exposes repositories. |
| `settingsPlugin` | Loads persisted settings, validates defaults, imports one-shot `CURSOR_API_KEY` into Keychain when configured, ensures pricing keys exist. |
| `websocketPlugin` | Registers `@fastify/websocket`, validates every frame with shared Zod schemas, manages heartbeat/reconnect. |
| `observabilityPlugin` | Adds request IDs, structured logs, timing hooks, and redaction for API keys, secret-like MCP fields, and oversized payloads. |

#### Route Groups

| Route group | Prefix | Purpose |
|---|---:|---|
| Health | `/api/health` | Liveness, readiness, version, database status, Keychain status. |
| Agents | `/api/agents` | Create, list, resume, inspect, rename, and locally terminate durable agents. |
| Runs | `/api/runs` | List runs, fetch run metadata, transcript, replay event ranges, delete runs. |
| Events | `/api/events` | Fetch large event payloads and exact raw/canonical payloads for inspectors. |
| Settings | `/api/settings` | Manage user-configurable settings, pricing settings, and Keychain-backed API key presence. |
| Usage | `/api/usage` | Daily/weekly cost and token aggregates by model and agent. |
| MCP servers | `/api/mcp-servers` | CRUD, validate, enable/disable, status checks. |
| Subagents | `/api/subagents` | CRUD for SDK `agents` definitions. |
| Workspace allowlist | `/api/workspace-allowlist` | CRUD and path validation for allowed local workspaces. |

#### Lifecycle Hooks

| Hook | Decision |
|---|---|
| `onRequest` | Attach request ID and reject non-loopback remote access unless explicitly overridden for development. |
| `preValidation` | Apply CSRF validation to mutating REST methods and all WebSocket upgrade requests. |
| `preHandler` | Zod-validate request body/query/params inside route-specific validators. |
| `onResponse` | Emit local timing metrics and structured access logs. |
| `onError` | Convert known domain errors into stable error codes; redact secrets before logging. |
| `onReady` | Verify migrations, Keychain availability, settings sanity, pricing defaults, and mark orphaned active runs as interrupted. |
| `onClose` | Stop accepting prompts, abort active stream tasks with `server_close`, close sockets with a shutdown code, persist active-run interruption events, close SQLite. |

### Agent Lifecycle

#### Create Agent

The server generates the durable `agentId` before calling `Agent.create`. This makes the local database and SDK durable identity agree from the first persisted record.

```ts
type CreateAgentInput = {
  name: string;
  modelId: "composer-2-5-fast" | "composer-2-5";
  mode: "local" | "cloud";
  local?: {
    cwd: string[];
    settingSources: Array<"project" | "user" | "team" | "mdm" | "plugins" | "all">;
    sandboxOptions: { enabled: boolean };
  };
  cloud?: unknown;
  mcpServerIds: string[];
  subagentDefinitionIds: string[];
};
```

Creation sequence:

1. Validate input with shared Zod schemas.
2. Resolve each `cwd` with `realpath`.
3. Enforce every `cwd` against `workspace_allowlist`.
4. Load API key from macOS Keychain.
5. Resolve enabled MCP server configs from `mcp_servers`.
6. Resolve enabled subagent definitions from `subagent_definitions`.
7. Generate durable `agentId`.
8. Persist an `agents` row with `status = "creating"`.
9. Call `Agent.create(options)` with `apiKey`, `model`, `local` or `cloud`, `mcpServers`, `agents`, `agentId`, and `name`.
10. Persist `status = "active"` and `last_active_at`.
11. Return local metadata to the UI; never return the API key.

Rationale: persistence happens before SDK creation so failures are inspectable and recoverable. The generated durable ID avoids relying on unspecified properties on the returned `Agent`.

#### Resume Agent

Resume sequence:

1. Fetch local `agents` row.
2. Call `Agent.get(agentId)`.
3. Store the returned `Agent` handle in `AgentRuntimeManager`.
4. Update `last_active_at`.
5. Return agent metadata, latest run summaries, accumulated usage totals, and currently active run IDs.

The UI exposes resume through the Agent Picker, Chat header, and every historical run page.

#### List Agents

The server combines local metadata from SQLite with `Agent.list()` results. SQLite remains the display source because it contains local configuration, last-active timestamps, run counts, usage totals, and UI labels. SDK list results are used to detect SDK-visible durable agents missing from local SQLite.

#### Terminate Agent

The SDK surface provided does not include a destroy/delete operation. “Terminate” is therefore a local runtime action:

- stop accepting new prompts for that in-memory handle;
- abort active local run tasks with reason `agent_terminated`;
- unsubscribe active sockets from live events;
- mark `agents.status = "terminated"`;
- retain agent and run history;
- allow later reactivation by calling resume.

The UI labels this as “Stop local session,” not “Delete from Cursor.”

### Run Lifecycle

```ts
type StartRunInput = {
  agentId: string;
  prompt: string;
};
```

Run sequence:

1. Validate prompt.
2. Resolve or resume active `Agent` handle.
3. Create an `AbortController` for this run before invoking the SDK.
4. Attempt to call `agent.send(prompt, { signal: controller.signal })`.
5. If the SDK rejects the second argument at compile-time during implementation verification, call `agent.send(prompt)` and retain the controller only for server-side task coordination.
6. Store `{ runId, agentId, abortController, runHandle, startedAt }` in `AgentRuntimeManager`.
7. Create a `runs` row with `status = "CREATING"` and `usage_source = "unavailable"`.
8. Start an async stream task that iterates `run.stream()`, normalizes each message, persists the event and run status in one transaction, and broadcasts only after commit.
9. On client cancellation, call `abortController.abort("user_cancelled")`.
10. If AbortSignal is wired to the SDK, the stream iterator should throw or terminate; catch abort-specific failures and persist `run.interrupted` with reason `user_cancelled`.
11. Set run status to `CANCELLED` only when a verified cancellation mechanism completes or the SDK emits `CANCELLED`.
12. If AbortSignal is not supported by the SDK, `RunController` checks for a runtime `run.cancel()` method and invokes it if present.
13. If neither AbortSignal nor `run.cancel()` is available, return `CANCEL_UNAVAILABLE`, keep the run active, and do not fake a cancelled state.
14. After stream completion without cancellation, call `run.wait()`.
15. Extract final result fields, including text, model, duration, git metadata, and token usage if exposed.
16. Calculate cost in micro-USD when token usage and pricing settings are available.
17. Persist final result fields on `runs`.
18. Emit a final canonical result event if the stream did not already produce terminal metadata.
19. Update `agents.last_active_at`.

Subsequent prompts to the same agent reuse the same durable agent handle so SDK conversation context is retained.

#### Run Cancellation Data Model

```ts
type ActiveRunHandle = {
  agentId: string;
  runId: string;
  run: unknown;
  abortController: AbortController;
  startedAt: Date;
  cancelState:
    | { type: "available"; mechanism: "abort_signal" | "run_cancel" }
    | { type: "unverified" }
    | { type: "unavailable" };
};
```

Cancellation success is stateful and evidence-based. The server sets `CANCELLED` only when a verified cancellation mechanism completes or the SDK emits a `CANCELLED` status.

### Event Normalization Pipeline

The server never forwards raw SDK stream objects directly. It converts each `SDKMessage` into a canonical internal event with stable sequencing and replay semantics.

```ts
type CanonicalRunEvent = {
  event_id: string;
  schema_version: 1;
  seq: number;
  agent_id: string;
  run_id: string;
  sdk_type:
    | "system"
    | "user"
    | "assistant"
    | "thinking"
    | "tool_call"
    | "status"
    | "task"
    | "request";
  kind:
    | "system.init"
    | "user.message"
    | "assistant.delta"
    | "assistant.snapshot"
    | "thinking.delta"
    | "thinking.snapshot"
    | "tool_call.running"
    | "tool_call.completed"
    | "tool_call.error"
    | "status.changed"
    | "task.updated"
    | "request.created"
    | "code_edit.detected"
    | "run.final_result"
    | "run.interrupted";
  occurred_at: string;
  received_at: string;
  payload: unknown;
  raw?: unknown;
};
```

Normalization stages:

| Stage | Decision |
|---|---|
| Discriminant guard | Accept only objects with known `type`, `agent_id`, and `run_id`. Unknown event types are persisted as diagnostic records only in development logs and not broadcast to stable clients. |
| Sequence assignment | Allocate `seq` monotonically per `run_id` inside the same SQLite transaction that inserts the event. `(run_id, seq)` is unique and is the replay cursor. |
| Delta derivation | Treat assistant and thinking content as possible snapshots. The normalizer computes append deltas from the previous accumulated text to avoid duplicate token rendering. |
| Markdown boundary tagging | Assistant text deltas are passed to the client as text deltas. Block-boundary detection happens in the frontend streaming markdown parser because it is presentation-specific and must run incrementally with layout feedback. |
| Tool-call merge | Use `call_id` as the stable key. Running and completed/error events update the same UI card while both lifecycle events remain individually persisted. |
| Code-edit extraction | Run best-effort extractors over `tool_call.args` and `tool_call.result`. Extracted previews are auxiliary canonical events and never replace the raw tool JSON. |
| Usage extraction | Run `usage-extractor` on `run.wait()` final result and any stream event that exposes usage metadata. Unknown shapes are recorded as `usage_source = "unavailable"` with no fabricated numbers. |
| Cost calculation | Convert tokens to micro-USD with pricing settings and promo multiplier. Store integer micro-USD values only. |
| Persistence before broadcast | Commit canonical and raw payloads before emitting WebSocket frames. Reconnect recovery can therefore replay anything the client might have missed. |
| Large payload handling | Payloads over `256 KiB` are persisted fully and broadcast as references. The `JsonInspector` fetches the full payload on expansion. |

#### Assistant and Thinking Delta Policy

The SDK surface does not state whether `assistant.message.content` and `thinking.text` are deltas or snapshots. The harness normalizes both to append-only deltas for rendering:

```ts
type TextAccumulatorKey = `${string}:${string}:${"assistant" | "thinking"}`;

type TextDelta = {
  text: string;
  full_text_length: number;
  is_replacement: boolean;
};
```

If a new text payload starts with the previous accumulated text, emit only the suffix. If it does not, emit `is_replacement = true` and replace the client-side buffer. This protects the UI against both delta-style and snapshot-style SDK streams.

#### Usage and Cost Extraction Policy

`run.wait()` is the authoritative place to extract final usage when the SDK exposes token metadata. Stream events may update running estimates only if the SDK exposes incremental usage in a stable shape. The server never infers model tokenization locally for billing values because local estimates can diverge from provider-side billing.

```ts
type RunUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd_micros: number | null;
  usage_source: "sdk_final_result" | "derived" | "unavailable";
};
```

Cost formula:

```ts
const freshInputTokens = Math.max(inputTokens - cachedInputTokens, 0);

const baseMicros =
  (freshInputTokens * inputPerMillionUsdMicros) / 1_000_000 +
  (cachedInputTokens * cachedInputPerMillionUsdMicros) / 1_000_000 +
  (outputTokens * outputPerMillionUsdMicros) / 1_000_000;

const costUsdMicros = Math.round(baseMicros * promoMultiplier);
```

Reasoning tokens are stored separately and counted into output pricing only when the SDK’s usage metadata or pricing documentation confirms that they are billed as output. Until verified, reasoning tokens are displayed but not independently costed.

### WebSocket Protocol

The WebSocket endpoint is:

```text
GET /ws
```

Every inbound and outbound frame is JSON and validated with Zod from `packages/shared`.

All frames use an envelope:

```ts
type FrameBase = {
  id: string;
  type: string;
  sent_at: string;
};
```

The full concrete protocol appears in Section 7.

Backend rules:

- Reject frames that fail Zod validation.
- Send `error` frames for recoverable protocol errors.
- Close the socket with code `1008` for invalid origin, missing CSRF token, or repeated invalid frames.
- Persist user prompts through the same run pathway regardless of whether they arrive from REST or WS.
- Do not broadcast an event until the database commit succeeds.
- Deduplicate client commands by `id` for 10 minutes per connection.
- Include usage and cost fields in final result frames when available.
- Do not send API keys, raw Keychain values, or unredacted secret-like MCP fields.

### Heartbeat and Reconnection Contract

| Setting | Value | Rationale |
|---|---:|---|
| Server heartbeat interval | `15s` | Fast enough to detect broken local sockets without creating visible overhead. |
| Client heartbeat response timeout | `45s` | Allows two missed heartbeats before reconnecting. |
| Initial reconnect delay | `250ms` | Local restarts and tab sleeps should recover quickly. |
| Max reconnect delay | `10s` | Prevents hot loops when the server is down. |
| Jitter | ±30% | Avoids synchronized reconnect bursts across tabs. |
| Resume cursor | `after_seq` per subscribed `run_id` | Sequence-based replay is deterministic and independent of wall-clock time. |

Reconnect sequence:

1. Client detects closed socket or heartbeat timeout.
2. Client reconnects with exponential backoff.
3. Client sends `subscribe_run` with the last applied `seq`.
4. Server queries `events where run_id = ? and seq > ? order by seq`.
5. Server sends replay frames first.
6. Server emits `ack` with `replay_complete = true`.
7. Server attaches the socket to the live run bus.

If the server detects the client’s cursor is ahead of the database, it sends `error` with `code = "INVALID_RESUME_CURSOR"` and instructs the client to reload that run from `seq = 0`.

### REST Endpoints for Non-realtime Operations

#### Health

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/health/live` | Process liveness. |
| `GET` | `/api/health/ready` | Database, Keychain, migrations, and settings ready. |
| `GET` | `/api/health/version` | App version, protocol version, schema version. |

#### Agents

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/agents` | List local durable agents with run counts, usage totals, and last-active timestamps. |
| `POST` | `/api/agents` | Create a new durable agent. |
| `GET` | `/api/agents/:agentId` | Fetch local agent metadata, latest run summary, and aggregate usage. |
| `POST` | `/api/agents/:agentId/resume` | Resume a durable SDK agent and activate it in the runtime manager. |
| `POST` | `/api/agents/:agentId/terminate` | Stop the local active handle without deleting history. |
| `PATCH` | `/api/agents/:agentId` | Rename agent or update display metadata. |

#### Runs

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/runs` | List runs, filterable by agent, status, model, cost presence, usage source, and date range. |
| `POST` | `/api/runs` | Start a run through REST; WS remains preferred for chat UX. |
| `GET` | `/api/runs/:runId` | Fetch run metadata, token usage, and cost. |
| `GET` | `/api/runs/:runId/transcript` | Fetch reconstructed transcript and final result. |
| `GET` | `/api/runs/:runId/events` | Fetch canonical event range by `after_seq`, `limit`, and `direction`. |
| `DELETE` | `/api/runs/:runId` | Delete a run and cascade its events. |

#### Events

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/events/:eventId` | Fetch canonical event payload. |
| `GET` | `/api/events/:eventId/raw` | Fetch raw SDK event payload for debugging. |
| `GET` | `/api/events/:eventId/large-payload/:field` | Fetch large `args`, `result`, or raw payload referenced by WS frames. |

#### Settings

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/settings` | Fetch merged non-secret settings, including pricing settings. |
| `PATCH` | `/api/settings` | Update user-configurable settings. |
| `GET` | `/api/settings/api-key` | Return `{ present: boolean }`; never returns the key. |
| `PUT` | `/api/settings/api-key` | Save Cursor API key to Keychain. |
| `DELETE` | `/api/settings/api-key` | Delete Cursor API key from Keychain. |
| `PATCH` | `/api/settings/pricing` | Update per-model pricing, promo multiplier, and verification timestamp. |

#### Usage

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/usage/summary` | Return total runs, tokens, cost, and usage-source breakdown for a date range. |
| `GET` | `/api/usage/daily` | Return daily aggregates for charting. |
| `GET` | `/api/usage/weekly` | Return weekly aggregates for charting. |
| `GET` | `/api/usage/by-model` | Return token and cost aggregates grouped by model. |
| `GET` | `/api/usage/by-agent` | Return token and cost aggregates grouped by agent. |

#### MCP Servers

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/mcp-servers` | List saved MCP server configs and status. |
| `POST` | `/api/mcp-servers` | Create config after schema validation. |
| `GET` | `/api/mcp-servers/:serverId` | Fetch config metadata. |
| `PUT` | `/api/mcp-servers/:serverId` | Replace config after validation. |
| `PATCH` | `/api/mcp-servers/:serverId` | Enable/disable or rename. |
| `DELETE` | `/api/mcp-servers/:serverId` | Delete config if not used by active agents. |
| `POST` | `/api/mcp-servers/:serverId/validate` | Validate config shape and probe status. |

#### Subagent Definitions

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/subagents` | List subagent definitions. |
| `POST` | `/api/subagents` | Create definition. |
| `GET` | `/api/subagents/:subagentId` | Fetch definition. |
| `PUT` | `/api/subagents/:subagentId` | Replace definition. |
| `PATCH` | `/api/subagents/:subagentId` | Enable/disable or rename. |
| `DELETE` | `/api/subagents/:subagentId` | Delete definition if not used by active agents. |

#### Workspace Allowlist

| Method | Path | Purpose |
|---:|---|---|
| `GET` | `/api/workspace-allowlist` | List allowed paths. |
| `POST` | `/api/workspace-allowlist` | Add normalized realpath to allowlist. |
| `DELETE` | `/api/workspace-allowlist/:entryId` | Remove allowlist entry after warning if active agents use it. |
| `POST` | `/api/workspace-allowlist/validate` | Check candidate paths before saving. |

### Approval Flow for `request` Events

The SDK ground truth includes a `request` event with `request_id` but does not specify the payload shape or the SDK method used to answer the request. The harness still defines the internal approval flow now and isolates the SDK-specific response mechanism behind `ApprovalResponder`.

#### Flow

1. SDK emits:

```ts
{
  type: "request";
  agent_id: string;
  run_id: string;
  request_id: string;
}
```

2. Server persists canonical event:

```ts
type RequestCreatedPayload = {
  request_id: string;
  context_event_ids: string[];
  inferred_reason: string | null;
};
```

3. Server broadcasts `sdk.request` frame.
4. UI renders `ApprovalPrompt` inline in the run timeline.
5. UI shows request ID, current run status, nearest preceding `task`, nearest preceding `tool_call.running`, and approve/deny actions.
6. User clicks approve or deny.
7. Client sends:

```ts
type ApprovalResponseClientFrame = {
  id: string;
  type: "approval_response";
  sent_at: string;
  run_id: string;
  request_id: string;
  decision: "approve" | "deny";
  reason?: string;
  payload?: unknown;
};
```

8. Server validates that the request is pending for that run.
9. Server persists an approval response event.
10. Server calls:

```ts
interface ApprovalResponder {
  resolve(input: {
    agentId: string;
    runId: string;
    requestId: string;
    decision: "approve" | "deny";
    reason?: string;
    payload?: unknown;
  }): Promise<void>;
}
```

11. Server sends `ack` after `ApprovalResponder.resolve` succeeds.
12. If SDK resolution fails, server sends `error` and leaves the request visible with failed state.

The exact SDK method behind `ApprovalResponder.resolve` is an Open Question. No implementation may fake approval success.

---

## 5. SDK Feature Exposure

### Model Selection

| SDK capability | UI surface | Decision |
|---|---|---|
| `model: { id }` | `ModelSelector` in Chat header, New Agent dialog, Settings default model | Expose exactly two labels: “Composer 2.5 Fast” → `composer-2-5-fast`, and “Composer 2.5 Standard” → `composer-2-5`. Fast is the default because live interactive latency is a defining goal. |
| Per-agent model | Agent details panel | Persist model per durable agent. Existing agents keep their model; changing the default only affects new agents. |
| Per-subagent model override | Subagent editor | Allow `inherit` or one of the two supported model IDs. Persist `inherit` distinctly from `null`. |
| Cost display by model | Run history, Usage page, Settings → Pricing | Store cost and usage with the model ID used by the run so aggregate costs remain correct after defaults change. |

```ts
export const modelSelectionSchema = z.object({
  id: z.enum(["composer-2-5-fast", "composer-2-5"]),
});
```

### `settingSources` Toggle

| SDK capability | UI surface | Decision |
|---|---|---|
| `local.settingSources` | Settings → Local Execution → Setting Sources | Render checkboxes for `project`, `user`, `team`, `mdm`, `plugins`, and a mutually exclusive `all` choice. Default is `["project", "user"]` to respect local development context without silently importing broader organizational/plugin state. |
| Per-agent override | New Agent dialog advanced section | New agents inherit defaults but can override before creation. Existing agents display the sources used at creation. |

Validation rule:

- If `all` is selected, no other source may be selected.
- If no source is selected, omit `settingSources` from SDK options.

### `sandboxOptions` Toggle

| SDK capability | UI surface | Decision |
|---|---|---|
| `local.sandboxOptions.enabled` | Chat header status pill, New Agent dialog, Settings default | Default to enabled. Disabling requires a confirmation dialog because local Bash and file operations become less constrained. |
| Runtime visibility | System banner at run start | Every run shows a banner stating sandbox status and workspace paths. |

```ts
type SandboxSettings = {
  enabledByDefault: boolean; // default true
  requireDisableConfirmation: true;
};
```

### Multi-cwd Workspaces

| SDK capability | UI surface | Decision |
|---|---|---|
| `local.cwd?: string | string[]` | Workspace picker in New Agent dialog and Chat sidebar | Store and pass multi-root workspaces as `string[]`. A single path is still represented internally as a one-element array for simpler validation. |
| Allowlist enforcement | Workspace picker and server-side validation | Every selected cwd must be inside `workspace_allowlist`; client-side checks are advisory only. |
| Runtime display | System banner and Agent details | Show all cwd roots with allowlist labels and last-used timestamps. |

Creation rule:

```ts
const cwdForSdk = cwd.length === 1 ? cwd[0] : cwd;
```

The server performs this conversion at the final SDK boundary only.

### MCP Server CRUD

| SDK capability | UI surface | Decision |
|---|---|---|
| `mcpServers?: Record<string, McpServerConfig>` | `/mcp` page and New Agent dialog | Persist named MCP configs and let agents select enabled servers by ID. The SDK receives a record keyed by stable server name. |
| Config validation | MCP editor save button | Validate config as `unknown` but require JSON object shape, non-empty name, and serializability. Perform a runtime status probe before marking `validation_status = "valid"`. |
| Server status | MCP list and Agent details | Show `unknown`, `valid`, `invalid`, or `unreachable` with last check timestamp. |

Because `McpServerConfig` internals are not specified, the database stores config as JSON and the UI renders a schema-light JSON editor with validation gates.

```ts
type McpServerRecord = {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  validationStatus: "unknown" | "valid" | "invalid" | "unreachable";
  validationMessage?: string;
  lastCheckedAt?: string;
};
```

### Subagent CRUD

| SDK capability | UI surface | Decision |
|---|---|---|
| `agents?: Record<string, AgentDefinition>` | `/subagents` page and New Agent dialog | Persist reusable named subagent definitions. Agents select which subagents to include at creation. |
| `description` | Subagent list card and editor | Required. Displayed wherever the subagent is selectable. |
| `prompt` | Subagent editor | Required multiline system prompt. Versioning is deferred; edits apply to future agents only. |
| `model?: ModelSelection | "inherit"` | Subagent editor | Default `inherit`; otherwise one of the supported model IDs. |
| `mcpServers?: Array<string | Record<string, McpServerConfig>>` | Subagent editor | v1.1 uses selected saved MCP server IDs and resolves them into SDK-compatible values at agent creation. Inline ad-hoc configs are deferred. |

```ts
type SubagentDefinitionRecord = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: "inherit" | { id: "composer-2-5-fast" | "composer-2-5" };
  mcpServerIds: string[];
  enabled: boolean;
};
```

### Durable Agent IDs

| SDK capability | UI surface | Decision |
|---|---|---|
| `agentId?: string` | Agent Picker and run sidebar | Generate and persist durable IDs server-side. Every run links to exactly one durable agent. |
| `Agent.list()` | Agent Picker sync action | Show SDK-visible agents and mark local metadata gaps. |
| `Agent.get(agentId)` | Resume button | Resume any past agent by durable ID and continue conversation context via subsequent `.send()` calls. |
| `name?: string` | Agent Picker and Chat header | Agent names are editable local labels and passed to SDK at creation. |

Agent picker columns:

| Column | Source |
|---|---|
| Name | SQLite `agents.name` |
| SDK agent ID | SQLite `agents.id` |
| Model | SQLite `agents.model_id` |
| Mode | SQLite `agents.mode` |
| Last active | SQLite `agents.last_active_at` |
| Runs | SQLite count from `runs` |
| Total cost | Aggregate `runs.cost_usd_micros` |
| Total tokens | Aggregate token columns from `runs` |
| Status | SQLite plus runtime manager active handle state |

### Cloud Mode

| SDK capability | UI surface | Decision |
|---|---|---|
| `cloud?: CloudOptions` | Settings → Cloud Mode and New Agent dialog | Expose as a secondary execution mode with a clear “Cloud / sandboxed VM” label. Local remains default. |
| Cloud options | JSON editor | Store `CloudOptions` as JSON because the exact shape is not specified in the provided surface. |
| Safety label | System banner | Cloud runs show a distinct banner so local filesystem expectations are not confused with VM execution. |

Cloud mode is not hidden, but it is not the default. The UI requires explicit selection per agent.

### Token and Cost Tracking

| Capability | UI surface | Decision |
|---|---|---|
| Final usage extraction | `run.wait()` post-stream finalization | Extract token usage from the SDK final result when available. Persist unknown usage explicitly as `usage_source = "unavailable"` and do not estimate silently. |
| Running estimate | Chat header `CostBadge` | Show running token/cost estimate only if a stream event exposes incremental usage. Otherwise show “Usage pending” during active runs. |
| Final run cost | `RunStatusPill`, run detail header, Run History Cost column | Render final cost after `run.wait()` usage extraction and micro-USD calculation. |
| Pricing configuration | Settings → Pricing tab | Store per-model input/output/cached-input rates in micro-USD per million tokens plus a promo multiplier. |
| Promo multiplier | Settings → Pricing tab | Default `1.0`; user can set `0.1` during a 90% promo. Cost calculation applies multiplier after base cost. |
| Usage aggregates | `/usage` page | Show daily and weekly aggregates: total runs, total cost, total tokens, breakdown by model and by agent. |
| Data integrity | SQLite run columns | Store all usage and cost values on `runs` so future migrations do not need to backfill from lossy transcripts. |

Pricing settings keys:

```ts
type PricingSettings = {
  "pricing.composer-2-5-fast.input_per_million_usd_micros": number;
  "pricing.composer-2-5-fast.output_per_million_usd_micros": number;
  "pricing.composer-2-5-fast.cached_input_per_million_usd_micros": number;
  "pricing.composer-2-5.input_per_million_usd_micros": number;
  "pricing.composer-2-5.output_per_million_usd_micros": number;
  "pricing.composer-2-5.cached_input_per_million_usd_micros": number;
  "pricing.promo_multiplier": number;
  "pricing.last_verified_at": string | null;
};
```

`cost_usd_micros` stores millionths of one USD. This avoids float drift, keeps SQLite sorting exact, and supports very small per-run costs.

---

## 6. Frontend Design

### Route Structure

```text
/
├── /chat
│   # Opens the latest active agent or prompts for agent creation.
├── /chat/:agentId
│   # Primary live chat surface for a durable agent.
├── /agents
│   # Agent picker with resume, create, terminate, inspect, and aggregate usage actions.
├── /runs
│   # Run history list with filters and sortable Cost column.
├── /runs/:runId
│   # Completed or active run replay/detail page.
├── /usage
│   # Daily and weekly usage/cost aggregates by model and agent.
├── /settings
│   # General settings, model defaults, API key presence, local server status.
├── /settings/pricing
│   # Per-model pricing rates, promo multiplier, and pricing verification timestamp.
├── /settings/workspaces
│   # Workspace allowlist editor.
├── /settings/cloud
│   # Cloud mode configuration.
├── /mcp
│   # MCP server CRUD and status.
└── /subagents
    # Subagent CRUD.
```

Route ownership:

| Route | Primary data source | Empty state |
|---|---|---|
| `/chat` | agents + latest active run | “Create or resume an agent.” |
| `/chat/:agentId` | agent metadata + live run events | “No messages yet. Start a run.” |
| `/agents` | `/api/agents` | “No agents yet. Create one.” |
| `/runs` | `/api/runs` | “No runs recorded.” |
| `/runs/:runId` | `/api/runs/:id/events` | “Run has no persisted events.” |
| `/usage` | `/api/usage/*` | “No usage recorded yet.” |
| `/settings` | `/api/settings` | Blocking error if settings fail to load. |
| `/settings/pricing` | `/api/settings` | Show defaults with “verify pricing” banner if `pricing.last_verified_at` is null. |
| `/settings/workspaces` | `/api/workspace-allowlist` | “No workspaces allowlisted.” |
| `/mcp` | `/api/mcp-servers` | “No MCP servers configured.” |
| `/subagents` | `/api/subagents` | “No subagents configured.” |

### State Management Strategy

Use Zustand for app state because streaming event ingestion needs explicit imperative append/update operations, low overhead selectors, and minimal provider complexity.

Store split:

| Store | Responsibility |
|---|---|
| `run-store` | Append-only canonical events, run projections, tool-call indexes, text accumulators, markdown block models, code-edit projections. |
| `usage-store` | Usage aggregates, pricing freshness state, daily/weekly cost totals, model/agent breakdowns. |
| `agent-store` | Agent list, active agent ID, runtime status, aggregate run totals. |
| `settings-store` | Settings snapshots, dirty forms, pricing settings, API key presence. |
| `ui-store` | Panel state, replay speed, selected event IDs, inspector expansion state, streaming viewport lock. |

Server state is loaded through custom hooks into stores. Components consume selectors only and contain no direct effect logic.

### Custom Hook Inventory

| Hook | Signature | Responsibility | Dependencies |
|---|---|---|---|
| `useWebSocket` | `useWebSocket(config: UseWebSocketConfig): UseWebSocketResult` | Own socket lifecycle, validation, heartbeat, reconnect backoff, command send queue. | `websocket-client`, shared WS schemas, `useErrorReporter`. |
| `useAgentStream` | `useAgentStream(input: { agentId: string; runId?: string | null }): UseAgentStreamResult` | Subscribe/unsubscribe to active runs, submit prompts, cancel runs, recover gaps by `after_seq`. | `useWebSocket`, `run-store`, `agent-store`. |
| `useRunHistory` | `useRunHistory(filters: RunHistoryFilters): UseRunHistoryResult` | Fetch paginated run list, expose delete/replay actions, provide sortable Cost column data. | `http-client`, `run-store`, `usage-store`. |
| `useUsage` | `useUsage(input: UsageQuery): UseUsageResult` | Fetch daily/weekly aggregates, model breakdowns, agent breakdowns, and usage-source health. | `http-client`, `usage-store`. |
| `useAgents` | `useAgents(): UseAgentsResult` | Fetch/create/resume/terminate agents and keep active metadata fresh. | `http-client`, `agent-store`. |
| `useSettings` | `useSettings(): UseSettingsResult` | Fetch/update settings, pricing keys, promo multiplier, and API key presence. | `http-client`, `settings-store`. |
| `useMcpServers` | `useMcpServers(): UseMcpServersResult` | CRUD MCP configs and trigger validation probes. | `http-client`, `settings-store`. |
| `useSubagents` | `useSubagents(): UseSubagentsResult` | CRUD reusable subagent definitions. | `http-client`, `settings-store`. |
| `useWorkspaceAllowlist` | `useWorkspaceAllowlist(): UseWorkspaceAllowlistResult` | CRUD allowlisted paths and validate candidate workspaces. | `http-client`, `settings-store`. |
| `useApprovalActions` | `useApprovalActions(runId: string): UseApprovalActionsResult` | Send approve/deny decisions for pending request events. | `useWebSocket`, `run-store`. |
| `useStreamingMarkdown` | `useStreamingMarkdown(input: StreamingMarkdownInput): StreamingMarkdownState` | Maintain incremental markdown block model, trigger React re-render only at structural block boundaries, delegate prose runs to `StreamingText`. | `streaming-markdown` or equivalent parser, `run-store`, RAF scheduler. |
| `useStreamingTextNode` | `useStreamingTextNode(input: { text: string; isReplacement: boolean }): RefCallback<Text>` | Imperatively updates leaf text nodes inside prose markdown runs without re-rendering the whole markdown tree. | DOM text node refs, RAF scheduler. |
| `useCodeEditAnimation` | `useCodeEditAnimation(input: CodeEditAnimationInput): CodeEditAnimationState` | Animate parsed edit chunks character by character with caret position and batch boundaries. | `requestAnimationFrame`, `run-store`. |
| `useIncrementalSyntaxHighlighter` | `useIncrementalSyntaxHighlighter(input: IncrementalHighlightInput): HighlightDecorations` | Run Lezer-backed incremental parsing after insertion batches and return highlight decorations. | `@lezer/highlight`, language parsers, RAF scheduler. |
| `useVirtualizedEvents` | `useVirtualizedEvents(input: { runId: string; overscan: number }): VirtualizedEventsResult` | Virtualize long event timelines while preserving autoscroll behavior. | `@tanstack/react-virtual`, `run-store`. |
| `useKeyboardShortcuts` | `useKeyboardShortcuts(bindings: ShortcutBinding[]): void` | Register route-local shortcuts from hooks, never components. | DOM keyboard events. |
| `useErrorReporter` | `useErrorReporter(scope: string): ErrorReporter` | Normalize caught errors into UI toasts and debug logs. | `ui-store`. |

Representative signatures:

```ts
export type UseAgentStreamResult = {
  connectionState: "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";
  activeRunId: string | null;
  submitUserInput: (input: { prompt: string; agentId: string }) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  subscribeRun: (runId: string) => void;
  unsubscribeRun: (runId: string) => void;
};

export type StreamingMarkdownInput = {
  runId: string;
  source: "assistant" | "thinking";
  textVersion: number;
  text: string;
  isReplacement: boolean;
};

export type MarkdownBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { id: string; type: "list"; ordered: boolean; items: Array<{ id: string; text: string }> }
  | { id: string; type: "blockquote"; text: string }
  | { id: string; type: "code"; language: string | null; text: string; closed: boolean }
  | { id: string; type: "table"; rows: string[][]; closed: boolean }
  | { id: string; type: "thematic_break" };

export type CodeEditAnimationInput = {
  eventId: string;
  chunks: Array<{
    path: string;
    startOffset: number;
    deleteText?: string;
    insertText?: string;
  }>;
  enabled: boolean;
  charsPerSecond: number;
};

export type IncrementalHighlightInput = {
  language: "typescript" | "javascript" | "python" | "json" | "markdown" | "shell" | "plain-text";
  text: string;
  version: number;
  changedRange?: { from: number; to: number; insertedLength: number };
};
```

### Component Primitive Inventory

| Component | Responsibility |
|---|---|
| `Message` | Renders user and assistant message blocks with metadata, timestamp, model, event sequence, and usage/cost summary when available. |
| `StreamingMarkdown` | Owns the hybrid streaming markdown pipeline. It uses an incremental markdown parser at the block level, renders markdown structure with React, and delegates prose leaf text mutation to `StreamingText`. |
| `StreamingText` | Leaf primitive that imperatively mutates a text node inside prose blocks, list items, and blockquotes. It no longer owns markdown parsing or full assistant rendering. |
| `ThinkingTrace` | Renders thinking deltas with duration metadata and collapse controls. It uses `StreamingMarkdown` when thinking text contains markdown-like structure and plain `StreamingText` for simple prose. |
| `ToolCallCard` | Renders one `call_id` lifecycle with status, timing, args/result inspectors, truncation badges, and errors. |
| `ToolCallLane` | Renders concurrent tool calls side-by-side when the agent fans out. |
| `CodeEditPreview` | Renders parsed edit previews with character-by-character insertion, deletion markers, file path, visible caret, and incremental syntax highlighting. |
| `SyntaxHighlighter` | Lezer-backed highlighter wrapping code surfaces inside `CodeEditPreview`, markdown code blocks, and JSON inspectors where appropriate. It applies incremental decorations after RAF-batched text changes. |
| `IterationBoundary` | Groups events into agent turns bounded by user messages and terminal status events. |
| `SystemBanner` | Renders `system.init`, sandbox state, model, tools, cwd roots, cloud/local mode, and pricing freshness warnings. |
| `ApprovalPrompt` | Renders pending `request` events with approve/deny actions and nearby context. |
| `JsonInspector` | Renders arbitrary `unknown` args/results as collapsible JSON with lazy large-payload fetch. |
| `RunStatusPill` | Displays `CREATING`, `RUNNING`, `FINISHED`, `ERROR`, `CANCELLED`, or `EXPIRED`; includes `CostBadge` when final or running usage exists. |
| `CostBadge` | Renders cost state for active and completed runs: “Usage pending,” running estimate, final micro-USD-derived cost, or “Usage unavailable.” |
| `UsageSummaryCards` | Renders total runs, total tokens, total cost, and unavailable-usage count for the selected date range. |
| `UsageBreakdownTable` | Renders by-model and by-agent token/cost breakdowns. |
| `PricingFreshnessBanner` | Warns when pricing has never been verified or is older than 30 days. |
| `EventTimeline` | Owns virtualized ordering, grouping, autoscroll, and replay speed controls. |
| `ConnectionBanner` | Shows reconnecting, stale, replaying missed events, offline, and resume cursor states. |
| `ErrorBoundarySurface` | Wraps each streaming panel so one rendering error does not collapse the whole chat. |

Every streaming surface is wrapped in an error boundary:

```tsx
<StreamingSurfaceBoundary surface="chat-timeline">
  <EventTimeline runId={runId} />
</StreamingSurfaceBoundary>

<StreamingSurfaceBoundary surface="tool-calls">
  <ToolCallLane runId={runId} />
</StreamingSurfaceBoundary>

<StreamingSurfaceBoundary surface="code-edits">
  <CodeEditPreviewPanel runId={runId} />
</StreamingSurfaceBoundary>

<StreamingSurfaceBoundary surface="usage-badges">
  <CostBadge runId={runId} />
</StreamingSurfaceBoundary>
```

### Streaming Render Strategy

#### Assistant Markdown

The assistant renderer uses a hybrid streaming markdown pipeline. Plain imperative text-node mutation is insufficient because coding-agent output commonly contains code fences, lists, headings, tables, blockquotes, and inline code. Full React re-rendering on every token is also too expensive. The v1.1 renderer splits responsibility by semantic layer.

Pipeline:

1. WS `sdk.assistant` frame arrives.
2. Frame is Zod-validated.
3. `run-store.ingestServerFrame(frame)` appends the canonical event and updates the assistant text accumulator.
4. Accumulator updates are batched with `requestAnimationFrame`.
5. `useStreamingMarkdown` feeds the appended text into `streaming-markdown` or an equivalent purpose-built incremental markdown parser.
6. The parser emits block-level structure changes.
7. React re-renders only when a block boundary changes: code-block open, code-block close, heading start or completion, list item start, table row completion, blockquote boundary, thematic break, or paragraph split.
8. Within prose blocks, list items, and blockquotes, `StreamingText` imperatively mutates a text node ref with the latest text.
9. Code blocks are rendered as code surfaces; syntax highlighting runs after block boundaries or batched content updates.
10. Replay mode uses the same pipeline but controls feed timing with replay speed.

Decision: `StreamingMarkdown` owns markdown structure and React nodes; `StreamingText` is a leaf primitive only. This preserves markdown fidelity without forcing React commits per token.

```ts
type StreamingMarkdownState = {
  blocks: MarkdownBlock[];
  activeBlockId: string | null;
  structuralVersion: number;
  proseVersionsByBlockId: Record<string, number>;
};
```

Block-boundary re-render policy:

| Boundary | React work |
|---|---|
| New paragraph | Append one paragraph block. |
| Paragraph text append | No structural React re-render; update text node through `StreamingText`. |
| Heading detected | Render heading element; subsequent heading text uses `StreamingText`. |
| List item start | Append list item node; item text uses `StreamingText`. |
| Code fence open | Render code block shell. |
| Code fence content append | Batch code text and schedule highlighter. |
| Code fence close | Mark code block closed and run final highlight pass. |
| Table row completion | Append row and re-render table body. |
| Blockquote append | Update leaf text node. |

Fallback behavior:

- If the markdown parser throws, `StreamingMarkdown` logs the parser error through `useErrorReporter`, switches that message to escaped plain text, and keeps streaming.
- If a code block is never closed before terminal status, it renders as an open code block with an “unterminated” badge.
- If a table is malformed, rows already parsed render as a table and remaining text renders as preformatted markdown fallback.

#### Assistant Text Accumulators

The run store maintains canonical text buffers outside React render state:

```ts
type TextBufferState = {
  byRunId: Record<
    string,
    {
      assistantText: string;
      thinkingText: string;
      assistantVersion: number;
      thinkingVersion: number;
    }
  >;
};
```

`StreamingMarkdown` subscribes to `assistantVersion`. `StreamingText` subscribes to per-block prose versions. React re-renders structural boundaries, not every token.

#### Thinking Traces

Thinking events use the same accumulator strategy as assistant text. `ThinkingTrace` starts in collapsed mode for completed runs and expanded mode for active runs when no assistant text has arrived yet. `thinking_duration_ms` is displayed when present. If duration updates arrive repeatedly, the latest value wins while all deltas remain replayable.

#### Code Edit Preview

`CodeEditPreview` is driven by canonical `code_edit.detected` events produced by server extractors. The raw tool call remains visible regardless of preview extraction.

Animation behavior:

- Insertions reveal characters in RAF-bounded batches, usually 1–4 characters per frame.
- Deletions show a struck-through fading segment.
- A visible caret is positioned after the last inserted character.
- Multiple files render as stacked file panes.
- Animation speed defaults to `120 chars/sec`.
- Replay mode can use `1x`, `2x`, `4x`, or instant.
- If a parsed edit exceeds `20,000` characters, preview switches to chunked diff mode and offers “animate first 2,000 chars.”

Syntax highlighting strategy:

- Use `@lezer/highlight` with incremental parsing.
- Run the parser on the current buffer after each insertion batch, not after every character.
- Apply highlight decorations to the rendered DOM without rebuilding the entire code surface.
- Support TypeScript, JavaScript, Python, JSON, Markdown, shell, and plain-text fallback for unknown languages.
- Do not use Shiki or Prism inside the character animation loop because full re-highlighting on every character violates the frame budget.
- For static completed code blocks in replay, Lezer still runs, but it may process the full buffer once.

```ts
type CodeEditDetectedPayload = {
  source_call_id: string;
  confidence: "high" | "medium" | "low";
  edits: Array<{
    path: string;
    language: "typescript" | "javascript" | "python" | "json" | "markdown" | "shell" | "plain-text" | null;
    before?: string;
    after?: string;
    unifiedDiff?: string;
    operations: Array<{
      type: "insert" | "delete" | "replace";
      startOffset: number;
      endOffset: number;
      text: string;
    }>;
  }>;
};
```

`SyntaxHighlighter` accepts a string buffer and changed range. The hook caches parser state by `eventId + path + language`.

```ts
type SyntaxHighlightDecoration = {
  from: number;
  to: number;
  className: string;
};

type SyntaxHighlighterProps = {
  language: "typescript" | "javascript" | "python" | "json" | "markdown" | "shell" | "plain-text";
  text: string;
  changedRange?: {
    from: number;
    to: number;
    insertedLength: number;
  };
  caretOffset?: number;
};
```

#### Concurrent Tool Calls

Tool calls are indexed by `run_id + call_id`.

```ts
type ToolCallProjection = {
  callId: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  startedAtSeq: number;
  completedAtSeq?: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  truncated?: {
    args?: boolean;
    result?: boolean;
  };
};
```

Rendering rule:

- Tool calls with overlapping running windows render side-by-side in `ToolCallLane`.
- Completed cards collapse by default after 3 seconds unless pinned or errored.
- Errors remain expanded.
- Args and results are separate `JsonInspector` panels.
- Code-edit previews appear directly under the originating `ToolCallCard`.
- Cost and token metadata never appear inside tool cards unless the SDK emits tool-specific usage later.

### Run History Columns

Run History renders a sortable table with these columns:

| Column | Sortable | Source |
|---|---:|---|
| Started | Yes | `runs.started_at` |
| Agent | Yes | joined `agents.name` |
| Model | Yes | `runs.model_id` |
| Status | Yes | `runs.status` |
| Duration | Yes | `runs.duration_ms` |
| Events | Yes | count from `events` |
| Input tokens | Yes | `runs.input_tokens` |
| Output tokens | Yes | `runs.output_tokens` |
| Cached input | Yes | `runs.cached_input_tokens` |
| Cost | Yes | `runs.cost_usd_micros` |
| Usage source | Yes | `runs.usage_source` |

Cost formatting:

- `null` cost with `usage_source = "unavailable"` renders “Unavailable.”
- `0` cost renders `$0.000000`.
- Values below one cent render with six decimal places.
- Values at or above one cent render with four decimal places.
- Sorting uses integer micros, not formatted strings.

### Virtualization Strategy for Runs with 200+ Events

Use `@tanstack/react-virtual` through `useVirtualizedEvents`.

Rules:

- Enable virtualization at `> 200` canonical events.
- Overscan `12` items above and below viewport.
- Measure dynamic row heights after render through hook-managed refs.
- Keep the active streaming tail mounted while autoscroll is locked to bottom.
- Disable expensive syntax highlighting outside the viewport.
- Preserve event grouping by virtualizing `IterationBoundary` groups, not individual low-level token events when possible.
- Keep active `StreamingMarkdown` and active `CodeEditPreview` mounted even when the event count crosses the virtualization threshold.

Projection layer:

```ts
type TimelineItem =
  | { type: "system"; eventIds: string[] }
  | { type: "message"; role: "user" | "assistant"; eventIds: string[] }
  | { type: "thinking"; eventIds: string[] }
  | { type: "tool_call_group"; callIds: string[] }
  | { type: "code_edit"; eventIds: string[] }
  | { type: "approval"; eventIds: string[] }
  | { type: "status"; eventIds: string[] }
  | { type: "usage"; runId: string };
```

### Empty, Loading, and Error States

| View | Empty | Loading | Error |
|---|---|---|---|
| Chat | “Start a run with this agent.” | Skeleton timeline plus disabled composer. | Inline fatal panel with retry, export logs, and run history link. |
| Agent Picker | “Create your first agent.” | Table skeleton. | Error card with retry and health-check link. |
| Run History | “No runs recorded.” | Paginated list skeleton. | Retry card; filters preserved. |
| Run Replay | “Run has no events.” | Timeline skeleton and replay controls disabled. | Partial events render if available; corrupt events are shown as inspector errors. |
| Usage | “No usage recorded yet.” | Aggregate card skeletons and chart skeleton. | Error card with retry; pricing settings link remains available. |
| Settings | No empty state; defaults always exist. | Form skeleton. | Blocking panel because settings drive agent creation. |
| Pricing Settings | Defaults render with verification banner. | Form skeleton. | Field-level validation for invalid micros or multiplier; API errors in banner. |
| Workspace Allowlist | “No workspaces allowlisted.” | List skeleton. | Validation errors shown per path; server errors in banner. |
| MCP Servers | “No MCP servers configured.” | Card skeleton. | Invalid configs stay editable with validation message. |
| Subagents | “No subagents configured.” | Card skeleton. | Invalid definitions stay editable with field-level errors. |
| Approval Prompt | “Request details unavailable.” | Pending spinner while response is sent. | Prompt remains actionable after failed approval/denial. |

---

## 7. WebSocket Event Protocol

### Shared JSON Types

```ts
import { z } from "zod";

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const isoDateTimeSchema = z.string().datetime();
export const frameIdSchema = z.string().min(8).max(128);
export const agentIdSchema = z.string().min(1).max(256);
export const runIdSchema = z.string().min(1).max(256);
export const eventIdSchema = z.string().uuid();
export const requestIdSchema = z.string().min(1).max(256);
export const callIdSchema = z.string().min(1).max(256);

export const frameBaseSchema = z.object({
  id: frameIdSchema,
  type: z.string(),
  sent_at: isoDateTimeSchema,
});
```

### SDK Surface Types

```ts
export type ModelSelection = {
  id: "composer-2-5-fast" | "composer-2-5" | string;
};

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type SDKMessage =
  | {
      type: "system";
      subtype?: "init";
      agent_id: string;
      run_id: string;
      model?: ModelSelection;
      tools?: string[];
    }
  | {
      type: "user";
      agent_id: string;
      run_id: string;
      message: { role: "user"; content: TextBlock[] };
    }
  | {
      type: "assistant";
      agent_id: string;
      run_id: string;
      message: { role: "assistant"; content: Array<TextBlock | ToolUseBlock> };
    }
  | {
      type: "thinking";
      agent_id: string;
      run_id: string;
      text: string;
      thinking_duration_ms?: number;
    }
  | {
      type: "tool_call";
      agent_id: string;
      run_id: string;
      call_id: string;
      name: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      result?: unknown;
      truncated?: { args?: boolean; result?: boolean };
    }
  | {
      type: "status";
      agent_id: string;
      run_id: string;
      status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
      message?: string;
    }
  | {
      type: "task";
      agent_id: string;
      run_id: string;
      status?: string;
      text?: string;
    }
  | {
      type: "request";
      agent_id: string;
      run_id: string;
      request_id: string;
    };
```

### Domain Schemas

```ts
export const sdkRunStatusSchema = z.enum([
  "CREATING",
  "RUNNING",
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
]);

export const modelIdSchema = z.enum(["composer-2-5-fast", "composer-2-5"]);

export const settingSourceSchema = z.enum([
  "project",
  "user",
  "team",
  "mdm",
  "plugins",
  "all",
]);

export const usageSourceSchema = z.enum([
  "sdk_final_result",
  "derived",
  "unavailable",
]);

export const tokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  cached_input_tokens: z.number().int().nonnegative().nullable(),
  reasoning_tokens: z.number().int().nonnegative().nullable(),
  cost_usd_micros: z.number().int().nonnegative().nullable(),
  usage_source: usageSourceSchema,
});

export const canonicalEventBaseSchema = z.object({
  event_id: eventIdSchema,
  schema_version: z.literal(1),
  seq: z.number().int().nonnegative(),
  agent_id: agentIdSchema,
  run_id: runIdSchema,
  occurred_at: isoDateTimeSchema,
  received_at: isoDateTimeSchema,
});
```

### Client → Server Frames

```ts
export const subscribeRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("subscribe_run"),
  run_id: runIdSchema,
  after_seq: z.number().int().nonnegative().default(0),
  replay: z
    .object({
      enabled: z.boolean().default(true),
      speed: z.enum(["instant", "1x", "2x", "4x"]).default("instant"),
    })
    .default({ enabled: true, speed: "instant" }),
});

export const unsubscribeRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("unsubscribe_run"),
  run_id: runIdSchema,
});

export const submitUserInputFrameSchema = frameBaseSchema.extend({
  type: z.literal("submit_user_input"),
  agent_id: agentIdSchema,
  prompt: z.string().min(1).max(200_000),
  client_run_id: z.string().uuid().optional(),
});

export const cancelRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("cancel_run"),
  run_id: runIdSchema,
  reason: z.string().max(1_000).optional(),
});

export const deleteRunFrameSchema = frameBaseSchema.extend({
  type: z.literal("delete_run"),
  run_id: runIdSchema,
});

export const updateSettingsFrameSchema = frameBaseSchema.extend({
  type: z.literal("update_settings"),
  patch: z.object({
    defaultModelId: modelIdSchema.optional(),
    defaultSettingSources: z.array(settingSourceSchema).optional(),
    sandboxEnabledByDefault: z.boolean().optional(),
    defaultReplaySpeed: z.enum(["instant", "1x", "2x", "4x"]).optional(),
    rawEventRetentionDays: z.number().int().min(1).max(3650).optional(),

    pricingComposer25FastInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25FastOutputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25FastCachedInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25InputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25OutputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingComposer25CachedInputPerMillionUsdMicros: z.number().int().nonnegative().optional(),
    pricingPromoMultiplier: z.number().min(0).max(1).optional(),
    pricingLastVerifiedAt: isoDateTimeSchema.nullable().optional(),
  }),
});

export const approvalResponseFrameSchema = frameBaseSchema.extend({
  type: z.literal("approval_response"),
  run_id: runIdSchema,
  request_id: requestIdSchema,
  decision: z.enum(["approve", "deny"]),
  reason: z.string().max(2_000).optional(),
  payload: z.unknown().optional(),
});

export const clientHeartbeatFrameSchema = frameBaseSchema.extend({
  type: z.literal("heartbeat_ack"),
  server_heartbeat_id: frameIdSchema,
});

export const clientFrameSchema = z.discriminatedUnion("type", [
  subscribeRunFrameSchema,
  unsubscribeRunFrameSchema,
  submitUserInputFrameSchema,
  cancelRunFrameSchema,
  deleteRunFrameSchema,
  updateSettingsFrameSchema,
  approvalResponseFrameSchema,
  clientHeartbeatFrameSchema,
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;
```

### Server → Client Frames

#### Common Frames

```ts
export const ackFrameSchema = frameBaseSchema.extend({
  type: z.literal("ack"),
  ack_for: frameIdSchema,
  ok: z.literal(true),
  message: z.string().optional(),
  replay_complete: z.boolean().optional(),
});

export const errorFrameSchema = frameBaseSchema.extend({
  type: z.literal("error"),
  ack_for: frameIdSchema.optional(),
  code: z.enum([
    "VALIDATION_ERROR",
    "UNAUTHORIZED_ORIGIN",
    "CSRF_FAILED",
    "AGENT_NOT_FOUND",
    "RUN_NOT_FOUND",
    "SDK_ERROR",
    "KEYCHAIN_ERROR",
    "WORKSPACE_NOT_ALLOWED",
    "INVALID_RESUME_CURSOR",
    "APPROVAL_NOT_PENDING",
    "CANCEL_UNAVAILABLE",
    "USAGE_PARSE_FAILED",
    "PRICING_NOT_CONFIGURED",
    "INTERNAL_ERROR",
  ]),
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().default(false),
});

export const serverHeartbeatFrameSchema = frameBaseSchema.extend({
  type: z.literal("heartbeat"),
  heartbeat_id: frameIdSchema,
  server_time: isoDateTimeSchema,
});
```

#### SDK and Derived Event Frames

```ts
export const systemEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.system"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("system"),
    kind: z.literal("system.init"),
    payload: z.object({
      subtype: z.literal("init").optional(),
      model: z.object({ id: z.string() }).optional(),
      tools: z.array(z.string()).optional(),
      mode: z.enum(["local", "cloud"]),
      cwd: z.array(z.string()).optional(),
      sandbox_enabled: z.boolean().optional(),
    }),
  }),
});

export const userEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.user"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("user"),
    kind: z.literal("user.message"),
    payload: z.object({
      role: z.literal("user"),
      content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    }),
  }),
});

export const assistantEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.assistant"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("assistant"),
    kind: z.union([z.literal("assistant.delta"), z.literal("assistant.snapshot")]),
    payload: z.object({
      role: z.literal("assistant"),
      text_delta: z.string().optional(),
      full_text_length: z.number().int().nonnegative().optional(),
      is_replacement: z.boolean().default(false),
      tool_uses: z
        .array(z.object({ id: z.string(), name: z.string(), input: z.unknown() }))
        .default([]),
    }),
  }),
});

export const thinkingEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.thinking"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("thinking"),
    kind: z.union([z.literal("thinking.delta"), z.literal("thinking.snapshot")]),
    payload: z.object({
      text_delta: z.string(),
      full_text_length: z.number().int().nonnegative(),
      is_replacement: z.boolean().default(false),
      thinking_duration_ms: z.number().int().nonnegative().optional(),
    }),
  }),
});

export const toolCallEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.tool_call"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("tool_call"),
    kind: z.enum(["tool_call.running", "tool_call.completed", "tool_call.error"]),
    payload: z.object({
      call_id: callIdSchema,
      name: z.string(),
      status: z.enum(["running", "completed", "error"]),
      args: z.unknown().optional(),
      result: z.unknown().optional(),
      truncated: z.object({ args: z.boolean().optional(), result: z.boolean().optional() }).optional(),
      large_payload_refs: z
        .object({
          args_event_url: z.string().optional(),
          result_event_url: z.string().optional(),
          raw_event_url: z.string().optional(),
        })
        .optional(),
      timing: z
        .object({
          started_at: isoDateTimeSchema.optional(),
          completed_at: isoDateTimeSchema.optional(),
          duration_ms: z.number().int().nonnegative().optional(),
        })
        .optional(),
    }),
  }),
});

export const statusEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.status"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("status"),
    kind: z.literal("status.changed"),
    payload: z.object({ status: sdkRunStatusSchema, message: z.string().optional() }),
  }),
});

export const taskEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.task"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("task"),
    kind: z.literal("task.updated"),
    payload: z.object({ status: z.string().optional(), text: z.string().optional() }),
  }),
});

export const requestEventFrameSchema = frameBaseSchema.extend({
  type: z.literal("sdk.request"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("request"),
    kind: z.literal("request.created"),
    payload: z.object({
      request_id: requestIdSchema,
      context_event_ids: z.array(eventIdSchema).default([]),
      inferred_reason: z.string().nullable().default(null),
    }),
  }),
});

export const codeEditDetectedFrameSchema = frameBaseSchema.extend({
  type: z.literal("derived.code_edit"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("tool_call"),
    kind: z.literal("code_edit.detected"),
    payload: z.object({
      source_call_id: callIdSchema,
      confidence: z.enum(["high", "medium", "low"]),
      edits: z.array(
        z.object({
          path: z.string(),
          language: z
            .enum(["typescript", "javascript", "python", "json", "markdown", "shell", "plain-text"])
            .nullable(),
          before: z.string().optional(),
          after: z.string().optional(),
          unifiedDiff: z.string().optional(),
          operations: z.array(
            z.object({
              type: z.enum(["insert", "delete", "replace"]),
              startOffset: z.number().int().nonnegative(),
              endOffset: z.number().int().nonnegative(),
              text: z.string(),
            }),
          ),
        }),
      ),
    }),
  }),
});

export const runFinalResultFrameSchema = frameBaseSchema.extend({
  type: z.literal("run.final_result"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("status"),
    kind: z.literal("run.final_result"),
    payload: z.object({
      text: z.string().optional(),
      model: z.unknown().optional(),
      duration_ms: z.number().int().nonnegative().optional(),
      git_metadata: z.unknown().optional(),
      usage: tokenUsageSchema,
      usage_parse_error: z
        .object({ message: z.string(), raw_shape: z.unknown().optional() })
        .optional(),
    }),
  }),
});

export const runInterruptedFrameSchema = frameBaseSchema.extend({
  type: z.literal("run.interrupted"),
  event: canonicalEventBaseSchema.extend({
    sdk_type: z.literal("status"),
    kind: z.literal("run.interrupted"),
    payload: z.object({
      reason: z.enum(["user_cancelled", "server_restart", "server_close", "agent_terminated", "stream_error"]),
      message: z.string().optional(),
    }),
  }),
});
```

#### Union

```ts
export const serverFrameSchema = z.discriminatedUnion("type", [
  ackFrameSchema,
  errorFrameSchema,
  serverHeartbeatFrameSchema,
  systemEventFrameSchema,
  userEventFrameSchema,
  assistantEventFrameSchema,
  thinkingEventFrameSchema,
  toolCallEventFrameSchema,
  statusEventFrameSchema,
  taskEventFrameSchema,
  requestEventFrameSchema,
  codeEditDetectedFrameSchema,
  runFinalResultFrameSchema,
  runInterruptedFrameSchema,
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;
```

---

## 8. Persistence Schema

SQLite is the source of truth for local app state. Drizzle owns migrations, but the schema is defined by explicit reviewed SQL.

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('creating', 'active', 'terminated', 'error')),
  mode TEXT NOT NULL
    CHECK (mode IN ('local', 'cloud')),
  model_id TEXT NOT NULL,
  cwd_json TEXT
    CHECK (cwd_json IS NULL OR json_valid(cwd_json)),
  setting_sources_json TEXT
    CHECK (setting_sources_json IS NULL OR json_valid(setting_sources_json)),
  sandbox_enabled INTEGER
    CHECK (sandbox_enabled IS NULL OR sandbox_enabled IN (0, 1)),
  cloud_options_json TEXT
    CHECK (cloud_options_json IS NULL OR json_valid(cloud_options_json)),
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(mcp_server_ids_json)),
  subagent_definition_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(subagent_definition_ids_json)),
  sdk_list_seen_at TEXT,
  last_active_at TEXT,
  error_json TEXT
    CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  terminated_at TEXT
);

CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at DESC);
CREATE INDEX idx_agents_mode ON agents(mode);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('CREATING', 'RUNNING', 'FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED')),
  prompt_preview TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  mode TEXT
    CHECK (mode IS NULL OR mode IN ('local', 'cloud')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  duration_ms INTEGER
    CHECK (duration_ms IS NULL OR duration_ms >= 0),
  last_seq INTEGER NOT NULL DEFAULT 0
    CHECK (last_seq >= 0),
  final_text TEXT,
  final_result_json TEXT
    CHECK (final_result_json IS NULL OR json_valid(final_result_json)),
  git_metadata_json TEXT
    CHECK (git_metadata_json IS NULL OR json_valid(git_metadata_json)),

  input_tokens INTEGER
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens INTEGER
    CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  reasoning_tokens INTEGER
    CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  cost_usd_micros INTEGER
    CHECK (cost_usd_micros IS NULL OR cost_usd_micros >= 0),
  usage_source TEXT
    CHECK (usage_source IS NULL OR usage_source IN ('sdk_final_result', 'derived', 'unavailable')),

  error_json TEXT
    CHECK (error_json IS NULL OR json_valid(error_json)),
  interrupted_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_agent_id_started_at ON runs(agent_id, started_at DESC);
CREATE INDEX idx_runs_status_started_at ON runs(status, started_at DESC);
CREATE INDEX idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX idx_runs_model_id_started_at ON runs(model_id, started_at DESC);
CREATE INDEX idx_runs_cost_usd_micros ON runs(cost_usd_micros) WHERE cost_usd_micros IS NOT NULL;
CREATE INDEX idx_runs_usage_source ON runs(usage_source);
CREATE INDEX idx_runs_tokens ON runs(input_tokens, output_tokens);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  seq INTEGER NOT NULL
    CHECK (seq >= 0),
  schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (schema_version = 1),
  sdk_type TEXT NOT NULL
    CHECK (sdk_type IN ('system', 'user', 'assistant', 'thinking', 'tool_call', 'status', 'task', 'request')),
  kind TEXT NOT NULL,
  call_id TEXT,
  request_id TEXT,
  status TEXT,
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json)),
  raw_json TEXT
    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  payload_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (payload_bytes >= 0),
  raw_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (raw_bytes >= 0),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE (run_id, seq)
);

CREATE INDEX idx_events_run_id_seq ON events(run_id, seq);
CREATE INDEX idx_events_agent_id_received_at ON events(agent_id, received_at DESC);
CREATE INDEX idx_events_kind_received_at ON events(kind, received_at DESC);
CREATE INDEX idx_events_call_id ON events(call_id) WHERE call_id IS NOT NULL;
CREATE INDEX idx_events_request_id ON events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_events_status ON events(status) WHERE status IS NOT NULL;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
    CHECK (json_valid(value_json)),
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),
  config_json TEXT NOT NULL
    CHECK (json_valid(config_json)),
  validation_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (validation_status IN ('unknown', 'valid', 'invalid', 'unreachable')),
  validation_message TEXT,
  last_status TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mcp_servers_enabled ON mcp_servers(enabled);
CREATE INDEX idx_mcp_servers_validation_status ON mcp_servers(validation_status);

CREATE TABLE subagent_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model_json TEXT NOT NULL
    CHECK (json_valid(model_json)),
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(mcp_server_ids_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_subagent_definitions_enabled ON subagent_definitions(enabled);
CREATE INDEX idx_subagent_definitions_name ON subagent_definitions(name);

CREATE TABLE workspace_allowlist (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT,
  recursive INTEGER NOT NULL DEFAULT 1
    CHECK (recursive IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX idx_workspace_allowlist_path ON workspace_allowlist(path);
CREATE INDEX idx_workspace_allowlist_last_used_at ON workspace_allowlist(last_used_at DESC);
```

### Default Settings Seed

```sql
INSERT INTO settings (key, value_json, description)
VALUES
  ('defaultModelId', json_quote('composer-2-5-fast'), 'Default model for new agents'),
  ('defaultSettingSources', json_array('project', 'user'), 'Default Cursor setting sources for local agents'),
  ('sandboxEnabledByDefault', json('true'), 'Whether local sandboxing is enabled by default'),
  ('defaultReplaySpeed', json_quote('instant'), 'Default run replay speed'),
  ('rawEventRetentionDays', json('180'), 'Retention period for raw SDK event JSON'),

  ('pricing.composer-2-5-fast.input_per_million_usd_micros', json('0'), 'Fast model input price in micro-USD per million tokens'),
  ('pricing.composer-2-5-fast.output_per_million_usd_micros', json('0'), 'Fast model output price in micro-USD per million tokens'),
  ('pricing.composer-2-5-fast.cached_input_per_million_usd_micros', json('0'), 'Fast model cached input price in micro-USD per million tokens'),
  ('pricing.composer-2-5.input_per_million_usd_micros', json('0'), 'Standard model input price in micro-USD per million tokens'),
  ('pricing.composer-2-5.output_per_million_usd_micros', json('0'), 'Standard model output price in micro-USD per million tokens'),
  ('pricing.composer-2-5.cached_input_per_million_usd_micros', json('0'), 'Standard model cached input price in micro-USD per million tokens'),
  ('pricing.promo_multiplier', json('1.0'), 'Multiplier applied to computed cost, e.g. 0.1 for a 90% promo'),
  ('pricing.last_verified_at', json('null'), 'Timestamp when pricing settings were last verified');
```

Pricing defaults are `0` until the user verifies and enters rates. This avoids shipping stale hardcoded prices. The UI shows a pricing freshness banner until `pricing.last_verified_at` is set.

### Retention Policy

| Data | Default retention | Policy |
|---|---:|---|
| Agents | Indefinite | Deleted only by explicit user action. |
| Runs | Indefinite | Deleted only by explicit user action; deleting an agent cascades its runs. |
| Canonical events | Indefinite | Required for exact replay. |
| Raw SDK event JSON | 180 days | Set `raw_json = NULL` after retention for terminal runs while preserving canonical payload. |
| Token and cost fields | Indefinite while run exists | Stored directly on `runs` for historical cost analysis. |
| Large payloads | Indefinite while run exists | Stored in `events.payload_json` or `raw_json`; fetched lazily by inspector. |
| Settings | Indefinite | Overwritten by key. |
| MCP/subagent configs | Indefinite | Deleted only by explicit user action. |

Cleanup job:

- runs at server startup and once per 24 hours;
- prunes raw JSON only for runs in terminal states;
- never deletes canonical replay events automatically;
- never deletes usage/cost fields independently;
- logs reclaim statistics locally.

---

## 9. Settings & Configuration

### In-app Configurable

| Setting | Default | Storage |
|---|---|---|
| Cursor API key presence | none | macOS Keychain via `keytar`; presence flag only in UI. |
| Default model | `composer-2-5-fast` | SQLite `settings.defaultModelId`. |
| Default setting sources | `["project", "user"]` | SQLite `settings.defaultSettingSources`. |
| Sandbox enabled by default | `true` | SQLite `settings.sandboxEnabledByDefault`. |
| Default replay speed | `instant` | SQLite `settings.defaultReplaySpeed`. |
| Raw event retention days | `180` | SQLite `settings.rawEventRetentionDays`. |
| Pricing rates | `0` until user verifies | SQLite `settings.pricing.*`. |
| Pricing promo multiplier | `1.0` | SQLite `settings.pricing.promo_multiplier`. |
| Pricing last verified timestamp | `null` | SQLite `settings.pricing.last_verified_at`. |
| MCP server configs | none | SQLite `mcp_servers`. |
| Subagent definitions | none | SQLite `subagent_definitions`. |
| Workspace allowlist | empty after first install | SQLite `workspace_allowlist`. |
| Cloud options JSON | none | SQLite `settings.cloudOptions`. |

### Pricing Settings

The Pricing tab owns these keys:

| Key | Type | Default | UI control |
|---|---:|---:|---|
| `pricing.composer-2-5-fast.input_per_million_usd_micros` | integer | `0` | currency-per-million input. |
| `pricing.composer-2-5-fast.output_per_million_usd_micros` | integer | `0` | currency-per-million output. |
| `pricing.composer-2-5-fast.cached_input_per_million_usd_micros` | integer | `0` | currency-per-million cached input. |
| `pricing.composer-2-5.input_per_million_usd_micros` | integer | `0` | currency-per-million input. |
| `pricing.composer-2-5.output_per_million_usd_micros` | integer | `0` | currency-per-million output. |
| `pricing.composer-2-5.cached_input_per_million_usd_micros` | integer | `0` | currency-per-million cached input. |
| `pricing.promo_multiplier` | decimal | `1.0` | numeric multiplier, min `0`, max `1`. |
| `pricing.last_verified_at` | ISO datetime or null | `null` | set to current timestamp when user confirms rates. |

Settings UI displays both human USD and stored micro-USD values. The persisted value is always integer micro-USD.

Example conversion:

```ts
function dollarsPerMillionToMicros(valueUsd: number): number {
  return Math.round(valueUsd * 1_000_000);
}

function microsToDollars(valueMicros: number): number {
  return valueMicros / 1_000_000;
}
```

The promo multiplier is applied at calculation time. Historical runs keep their already-computed `cost_usd_micros`; changing the multiplier affects future finalizations only. This preserves historical truth when a promotion starts or expires.

### Environment Configurable

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Fastify bind host. |
| `PORT` | `4783` | Fastify port. |
| `WEB_ORIGIN` | `http://127.0.0.1:5173` | Allowed dev UI origin. |
| `DB_PATH` | `~/Library/Application Support/cursor-sdk-agent-harness/harness.sqlite` | SQLite file path. |
| `LOG_LEVEL` | `info` | Server log level. |
| `KEYCHAIN_SERVICE` | `cursor-sdk-agent-harness` | macOS Keychain service name. |
| `CURSOR_API_KEY` | unset | One-shot bootstrap import into Keychain. Never persisted to plaintext. |
| `ALLOW_REMOTE_BIND` | `false` | Required to bind non-loopback hosts; not used in normal local mode. |

`CURSOR_API_KEY` handling:

1. On startup, if Keychain has no API key and `CURSOR_API_KEY` is present, import it into Keychain.
2. Do not write the key to SQLite, logs, `.env`, or config files.
3. Redact the variable from structured logs.
4. Use the Keychain value for `Agent.create({ apiKey })`.

### File Configurable

Non-secret file config is optional and loaded from:

```text
~/Library/Application Support/cursor-sdk-agent-harness/config.json
```

Allowed file-config fields:

```ts
type FileConfig = {
  host?: "127.0.0.1";
  port?: number;
  dbPath?: string;
  logLevel?: "debug" | "info" | "warn" | "error";
};
```

File config cannot contain API keys, MCP secrets, pricing values, or workspace allowlist entries. Pricing values belong in SQLite settings so the UI can display freshness and validation status.

---

## 10. Security & Sandboxing

### Bind Address Policy

- Default bind address is `127.0.0.1`.
- Binding to `0.0.0.0` is rejected unless `ALLOW_REMOTE_BIND=true`.
- Remote bind mode also requires explicit `WEB_ORIGIN`; wildcard CORS is never allowed.
- Production local mode serves the web app and API from the same origin when built.

### API Key Storage

- Cursor API key is stored only in macOS Keychain through `keytar`.
- SQLite stores only whether a key exists and the last successful validation timestamp.
- REST never returns the key.
- Logs redact `apiKey`, `CURSOR_API_KEY`, Authorization-like fields, and MCP config fields containing `token`, `secret`, `password`, or `key`.

### Workspace Allowlist Enforcement

Before `Agent.create` or `Agent.get` is used for local execution with a cwd:

1. Resolve candidate path with `fs.realpath`.
2. Reject nonexistent paths.
3. Reject paths containing unresolved symlinks that escape their apparent parent.
4. Compare realpath against every `workspace_allowlist.path`.
5. Allow exact match.
6. Allow descendant only when allowlist row has `recursive = 1`.
7. Reject if no allowlist rule matches.
8. Persist `last_used_at` for matched entries.

```ts
type WorkspaceDecision =
  | { allowed: true; matchedEntryId: string; normalizedPath: string }
  | { allowed: false; normalizedPath: string; reason: "not_allowlisted" | "missing" | "symlink_escape" };
```

All server-side file reads used for code previews use the same allowlist policy.

### Handling Agent Attempts Outside Allowed Paths

The provided SDK surface does not expose per-tool interception hooks. The harness therefore enforces what it controls:

- It never creates local agents with unallowlisted cwd roots.
- It defaults `sandboxOptions.enabled = true`.
- It warns prominently when sandboxing is disabled.
- It refuses server-side preview reads outside allowlisted paths.
- It flags tool-call args/results that mention paths outside the allowlist, but does not claim to prevent SDK-internal tool execution without a verified SDK interception mechanism.

Sandbox guarantees are listed under Open Questions because the exact enforcement semantics of `sandboxOptions` are not specified.

### CORS and CSRF

| Surface | Policy |
|---|---|
| REST | Allow only configured local origins. Mutating methods require CSRF header. |
| WebSocket | Validate `Origin` before upgrade. Require CSRF token in query or protocol header. |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure=false` on localhost. |
| Public internet | Unsupported. Remote bind requires explicit override and remains development-only. |

### Usage and Cost Privacy

- Usage and cost data is local-only in SQLite.
- No external telemetry is emitted.
- Cost values are computed from user-configured pricing and SDK-reported usage.
- Exported transcripts include usage only when the user explicitly exports run metadata.
- Pricing settings do not include secrets and are safe to back up with the SQLite database.

---

## 11. Error Handling & Resilience

### WebSocket Disconnect Recovery

- Client keeps `lastAppliedSeqByRunId`.
- Reconnect sends `subscribe_run` with `after_seq`.
- Server replays persisted events before attaching live subscription.
- Duplicate events are ignored by `(run_id, seq)`.
- Gaps are detected client-side when `seq !== lastSeq + 1`; client immediately resubscribes from the last contiguous sequence.

### Mid-run Server Crash Recovery

On startup:

1. Query runs with `status IN ('CREATING', 'RUNNING')`.
2. Insert `run.interrupted` event for each with reason `server_restart`.
3. Mark run `status = "ERROR"` with `interrupted_reason = "server_restart"`.
4. Preserve all events already committed.
5. Preserve any token/cost fields that were already known.
6. Leave unknown usage as `usage_source = "unavailable"`.
7. Allow the user to resume the durable agent and start a new run.

The current SDK surface does not include `Run.get` or stream reattachment. The harness does not pretend to resurrect in-flight streams after process death.

### Partial-event Handling

Malformed SDK events:

- persist redacted raw object only in development mode;
- emit `error` frame with `code = "SDK_ERROR"` if the malformed event affects a live run;
- keep the stream task alive if possible;
- mark run `ERROR` only when stream iteration fails or terminal status is unrecoverable.

Large or partially unserializable payloads:

- serialize with a safe JSON stringifier;
- replace circular references with `"[Circular]"`;
- store serialization errors in event payload metadata;
- keep `JsonInspector` functional with available fields.

### SDK API Errors Surfaced to User

SDK errors are mapped into stable UI errors:

| SDK failure point | UI behavior |
|---|---|
| `Agent.create` fails | New Agent dialog shows failure; persisted agent row becomes `error`. |
| `Agent.get` fails | Agent Picker shows “Resume failed” and keeps local metadata. |
| `agent.send` fails | Composer remains open with prompt preserved. |
| `run.stream()` throws due to user abort | Timeline receives `CANCELLED` status if cancellation is verified. |
| `run.stream()` throws unexpectedly | Timeline receives `ERROR` status and error card with raw redacted details. |
| `run.wait()` fails after stream terminal event | Timeline remains replayable; final result panel shows wait failure and usage remains unavailable. |

### Usage Parse Failures

Usage extraction is allowed to fail without failing the run.

| Failure | Persistence | UI behavior |
|---|---|---|
| Final result has no usage metadata | `usage_source = "unavailable"`, token fields null, cost null | `CostBadge` shows “Usage unavailable.” |
| Final result has unknown usage shape | `usage_source = "unavailable"`, parse error recorded in `final_result_json` metadata | Run detail shows “Usage parse failed” with redacted raw shape in developer inspector. |
| Pricing values are missing or zero | Token fields persist, `cost_usd_micros = NULL` | `CostBadge` shows “Tokens recorded, pricing not configured.” |
| Cached token field missing | `cached_input_tokens = NULL` | Cost calculation uses fresh input only if SDK metadata clearly defines input tokens as fresh-only; otherwise cost remains unavailable. |
| Reasoning token field present but billing semantics unknown | `reasoning_tokens` persists | UI displays reasoning tokens separately and excludes them from cost until verified. |

The server emits `USAGE_PARSE_FAILED` only for unexpected malformed usage shapes. Absence of usage metadata is not an error; it is a known `unavailable` state.

### Tool Timeouts and Run Cancellation

The primary cancellation path is `AbortController`.

Run startup creates one controller:

```ts
const controller = new AbortController();
const run = await maybeSendWithSignal(agent, prompt, controller.signal);
```

Implementation attempts this call first:

```ts
async function maybeSendWithSignal(agent: Agent, prompt: string, signal: AbortSignal): Promise<Run> {
  return agent.send(prompt, { signal });
}
```

If TypeScript definitions prove that `agent.send` accepts only one argument, the implementation switches to:

```ts
const run = await agent.send(prompt);
```

and `RunController` checks for a runtime cancellation method:

```ts
async function cancelRunHandle(run: unknown, reason: string): Promise<"cancelled" | "unavailable"> {
  if (typeof run === "object" && run !== null && "cancel" in run) {
    const cancel = (run as { cancel?: (reason?: string) => Promise<void> | void }).cancel;
    if (typeof cancel === "function") {
      await cancel.call(run, reason);
      return "cancelled";
    }
  }

  return "unavailable";
}
```

Cancellation contract:

1. Client sends `cancel_run`.
2. Server validates the run is active.
3. Server calls `abortController.abort(reason ?? "user_cancelled")`.
4. If the SDK has accepted the signal, the stream task catches an abort.
5. Server persists `run.interrupted` with reason `user_cancelled`.
6. Server sets run status to `CANCELLED`.
7. Server broadcasts `sdk.status` or `run.interrupted` reflecting cancellation.
8. If AbortSignal is unsupported, server calls `run.cancel()` if present.
9. If no cancellation primitive is available, server returns `CANCEL_UNAVAILABLE`, leaves run status unchanged, and shows a UI warning.

Tool stall detection remains UI-level because the SDK surface does not define a per-tool timeout option:

| Condition | Behavior |
|---|---|
| Tool call running for `> 30s` | Show “Still running” duration badge. |
| Tool call running for `> 120s` | Show “Long-running tool” warning. |
| No event for active run for `> 180s` | Show run stalled banner and offer cancel. |
| Cancel requested with verified cancellation | Abort run and mark `CANCELLED` when stream confirms or abort is caught. |
| Cancel requested without verified cancellation | Return `CANCEL_UNAVAILABLE` and keep run marked running until SDK stream changes. |

No code may mark a run `CANCELLED` unless the underlying SDK run is actually cancelled, the SDK emits `CANCELLED`, `run.cancel()` succeeds, or an SDK-accepted AbortSignal aborts the stream.

---

## 12. Replay & History

### Replay Source

Replay reconstructs from the canonical `events` table, not from final transcript text.

Rationale: the event log preserves timing, markdown streaming, tool lifecycle, thinking traces, status changes, request prompts, code edit previews, cancellation, cost finalization, and partial failures. Final transcript text cannot reconstruct these surfaces.

### Completed Run Rendering

A completed run renders through the same components as a live run:

```text
events table
  → /api/runs/:runId/events
  → run-store.ingestServerFrame(...)
  → EventTimeline projection
  → Message / StreamingMarkdown / ThinkingTrace / ToolCallCard / CodeEditPreview / CostBadge
```

The only difference is source timing:

| Mode | Timing source |
|---|---|
| Live | Actual WebSocket arrival. |
| Instant replay | Apply all events in sequence in one store transaction. |
| Timed replay | Use persisted `received_at` deltas with speed multiplier. |

### Replay Speed Controls

| Speed | Behavior |
|---|---|
| `instant` | Apply all events immediately. |
| `1x` | Preserve original inter-event timing, capped at `2s` between events. |
| `2x` | Halve inter-event delays, capped at `1s`. |
| `4x` | Quarter inter-event delays, capped at `500ms`. |

Replay controls:

- play/pause;
- step next event;
- jump to next tool call;
- jump to next error;
- jump to terminal status;
- jump to final usage/cost event;
- scrub by event sequence.

### Transcript Export

`/api/runs/:runId/transcript` reconstructs a readable transcript from canonical events and final result. It is for export and search, not rendering.

```ts
type TranscriptResponse = {
  runId: string;
  agentId: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool" | "thinking";
    text?: string;
    metadata?: unknown;
  }>;
  finalText?: string;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    cached_input_tokens: number | null;
    reasoning_tokens: number | null;
    cost_usd_micros: number | null;
    usage_source: "sdk_final_result" | "derived" | "unavailable";
  };
  eventCount: number;
};
```

Transcript export includes usage metadata because it is run-level metadata, not chat content. It does not include raw API keys or redacted MCP secrets.

---

## 13. Performance Budget

| Metric | Target | Enforcement |
|---|---:|---|
| Submit prompt → first persisted event | `< 500ms p50`, `< 1500ms p95` local | Measure around `agent.send` and first stream event. |
| SDK event received → DB commit | `< 8ms p50`, `< 25ms p95` excluding large payloads | Single transaction per event; WAL enabled. |
| DB commit → WS broadcast | `< 5ms p50` | Broadcast after commit through in-memory run bus. |
| Client frame validation | `< 1ms` for normal frames | Shared Zod schemas; large payload refs for oversized JSON. |
| Client event ingestion | `< 2ms` per event p50 | Zustand imperative store updates. |
| Assistant prose run update | `< 4ms` per event | `StreamingText` mutates leaf text nodes through RAF-batched refs. |
| Markdown block-boundary re-render | `< 12ms` per structural boundary | `StreamingMarkdown` re-renders only at code-block/list/table/heading/paragraph boundaries; expected frequency is ~1–2x/sec under normal token rates. |
| Code edit insertion batch | `< 4ms` per RAF batch | Batch 1–4 chars per frame; Lezer incremental parse after batch. |
| Lezer incremental parse | `< 1ms` typical edit batch | Cache parser state by file/language and changed range. |
| React render work per non-boundary event | `< 4ms` p50 | RAF batching and projection memoization. |
| Sustained event rate | `100 events/sec` | Batch client visual commits by animation frame. |
| Server WS flush delay | max `33ms` or `32 events`, whichever comes first | Preserve streaming feel while reducing frame overhead. |
| Client buffered events before forced flush | `128` | Prevent memory spikes during tool fan-out. |
| Timeline virtualization threshold | `> 200 events` | Avoid long-run layout collapse. |
| Large payload inline WS cap | `256 KiB` | Store full payload in SQLite and lazy-fetch on expansion. |
| Code edit animation default | `120 chars/sec` | Keeps edits legible and captivating. |
| Usage aggregate query | `< 50ms` for local DB with 10k runs | Indexed `runs.started_at`, `model_id`, `agent_id`, and cost fields. |

Backpressure decision:

- The server never drops persisted events.
- If a socket falls more than `1,000` events behind, server sends `error` with `retryable = true`, closes that subscription, and forces the client to replay from SQLite.
- `StreamingMarkdown` may coalesce prose deltas inside one RAF tick, but it must not drop text.
- `CodeEditPreview` may skip animation for oversized edits after the configured cap, but it must still show final content or diff.

---

## 14. Open Questions

| Question | Why it matters | How to verify |
|---|---|---|
| Does prompt caching expose any SDK-visible metadata or controls? | The spec assumes server-side automatic caching with no explicit knob. | Run repeated prompts and inspect SDK docs/types for cache metadata or options. |
| Does `run.wait()` final result expose token/usage metadata? In what shape? | Cost tracking depends on authoritative provider-side usage rather than local estimates. | Capture final results from several runs and inspect the returned object with redacted logging. |
| Does any stream event carry incremental usage? | Active-run `CostBadge` can show running estimates only if incremental usage exists. | Log raw `status`, `task`, and final stream events during long runs and inspect for usage fields. |
| Does the SDK distinguish cached vs fresh input tokens? | Accurate promo/caching cost requires separate cached input tokens. | Compare final result usage fields across repeated prompts and inspect for cache-specific counters. |
| Are reasoning tokens reported separately? | Reasoning tokens should be displayed and costed only according to verified billing semantics. | Inspect final result usage fields for reasoning token keys and compare to official billing docs. |
| Are `assistant` and `thinking` stream payloads deltas or snapshots? | The normalizer supports both, but exact behavior affects testing fixtures. | Create a run that streams long markdown and log raw events with sequence numbers. |
| What exact built-in tool names appear for `Explore`, `Bash`, and `Browser`? | UI can provide better icons/grouping once names are confirmed. | Run targeted prompts invoking each built-in subagent and record `tool_call.name`. |
| What shapes do code edit tool args/results use? | High-confidence `CodeEditPreview` extraction depends on actual edit payload formats. | Trigger file edits in a disposable repo and capture raw `tool_call` events. |
| What is the exact `request` event payload beyond `request_id`, if any? | Approval prompts need richer context than inferred nearby events. | Trigger a permission/approval scenario and inspect raw `request` events. |
| What SDK method resolves a `request` approval/denial? | `ApprovalResponder.resolve` cannot be implemented without a verified call. | Inspect `@cursor/sdk` types and examples; build a tiny approval fixture. |
| Does `agent.send(prompt, opts)` accept `{ signal: AbortSignal }`? | AbortSignal is the primary cancellation path in v1.1. | Inspect TypeScript declarations and test a long-running prompt with `AbortController`. |
| Does `Run` expose a `cancel()` method? | `run.cancel()` is the fallback cancellation path if `agent.send` does not accept a signal. | Inspect the returned Run object/type and attempt cancellation on a controlled long Bash run. |
| What status does a successfully cancelled run report — `CANCELLED` or `ERROR` with metadata? | Persistence must map successful cancellation without misclassifying user abort as a failure. | Cancel several runs and compare emitted status events, stream errors, and `run.wait()` behavior. |
| Can a running `Run` stream be reattached after process restart? | Mid-run crash recovery currently marks runs interrupted. | Search SDK types for run retrieval/stream resume and test restart behavior. |
| What is the exact shape of `run.wait()` final result beyond usage? | Persistence stores unknown fields as JSON now; typed columns can improve later. | Capture final result from successful, failed, cancelled, and cloud runs. |
| What is the exact `CloudOptions` schema? | Cloud mode currently uses JSON editor and conservative validation. | Inspect exported SDK types and create a cloud run in a sandbox account. |
| What guarantees does `sandboxOptions.enabled` provide? | Security language must distinguish cwd allowlist from actual execution confinement. | Attempt writes outside cwd with sandbox on/off in a disposable environment. |
| What `McpServerConfig` shapes are accepted inline? | MCP editor currently validates object/serializability but not config semantics. | Inspect SDK types and run one stdio and one HTTP MCP server config. |
| Does `Agent.list()` include agents created from other apps or only this API key? | Agent Picker sync behavior depends on visibility scope. | Create agents with different names/IDs and compare `Agent.list()` output. |
| Does `Agent.get(agentId)` require the same model/options as creation? | Resume flow currently relies on durable SDK state. | Resume an agent after server restart with only `agentId` and API key. |
| Which incremental markdown parser package best matches the app’s streaming needs? | `streaming-markdown` is the chosen class of solution; exact package API must be verified. | Prototype `StreamingMarkdown` against long assistant markdown fixtures and measure block-boundary renders. |
| Which Lezer parsers cover all v1.1 languages cleanly? | `SyntaxHighlighter` needs stable parser packages for TypeScript, JavaScript, Python, JSON, Markdown, and shell. | Build parser registry and run highlighting fixtures for each language. |

---

## 15. v1.1 Scope Cut

| Feature | In v1.1 | Deferred |
|---|---|---|
| Local durable agents | Yes: create, resume, list, terminate local handle. | SDK-level delete/destroy if later exposed. |
| Model selection | Yes: Composer 2.5 Fast and Standard. | Arbitrary model registry. |
| Token-by-token assistant streaming | Yes: normalized deltas with snapshot fallback. | Semantic message chunk classification beyond SDK blocks. |
| Streaming markdown rendering | Yes: hybrid `StreamingMarkdown` with block-level parser and leaf text mutation. | Full CommonMark compliance tests beyond required coding-agent output patterns. |
| Thinking trace streaming | Yes: collapsible trace with duration. | Advanced reasoning analytics. |
| Tool-call lifecycle cards | Yes: running/completed/error with args/result JSON. | Tool-specific bespoke renderers except code-edit preview. |
| Collapsible JSON inspector | Yes: arbitrary shapes, lazy large-payload fetch. | JSON diffing between lifecycle updates. |
| Code edit live preview | Yes: best-effort diff/patch extractors and character animation. | Guaranteed edit previews for unknown future tool schemas. |
| Incremental syntax highlighting | Yes: Lezer-backed `SyntaxHighlighter` for TypeScript, JavaScript, Python, JSON, Markdown, shell, and plain text. | Shiki-quality themed static highlighting; additional languages. |
| Persistent run history | Yes: canonical event log and transcript endpoint. | Full-text search across all payloads → **v1.2 Phase 19**. |
| Replay | Yes: instant, 1x, 2x, 4x. | Timeline minimap and video-like export. |
| WebSocket reconnect/gap recovery | Yes: `after_seq` replay. | Cross-device subscriptions. |
| Mid-run process crash recovery | Yes: mark interrupted and preserve events. | True stream reattachment unless SDK supports it. |
| API key Keychain storage | Yes. | Multi-profile key management. |
| Workspace allowlist | Yes: realpath enforced before agent creation and preview reads. | Per-tool filesystem policy enforcement unless SDK exposes hooks. |
| Sandbox toggle | Yes: default enabled and visible. | Fine-grained sandbox profiles. |
| `settingSources` UI | Yes. | Per-run temporary overrides after agent creation. |
| Multi-cwd workspaces | Yes. | Workspace graph visualization. |
| MCP server CRUD | Yes: JSON config, validation, status. | Marketplace/import catalog. |
| Subagent CRUD | Yes: description, prompt, model override, scoped saved MCP servers. | Inline one-off MCP configs inside subagents. |
| Durable agent picker | Yes: last-active timestamp, run count, resume, aggregate usage. | Agent tagging and folders. |
| Token and cost tracking | Yes: run-level token fields, micro-USD cost field, pricing settings, promo multiplier, `usage_source` marker, Run History Cost column, `/usage` aggregates. | Backfill from external billing exports; automatic price fetching. |
| Cloud mode | Partial: visible secondary config and labeled run path after `CloudOptions` verification. | Production-grade cloud execution management, VM file browser. |
| Approval UI | Partial: request prompt, approve/deny protocol, persisted decisions. | Enabled SDK resolution once exact approval method is verified. |
| Run cancellation | Yes when AbortSignal or `run.cancel()` is verified; implementation includes AbortController primary and `run.cancel()` fallback. If SDK exposes neither, runtime behavior remains Partial with explicit `CANCEL_UNAVAILABLE`. | Force-kill of SDK-internal tools without SDK support. |
| Design system | Yes: reference image to token extraction, Tailwind v4 token integration, no hardcoded visual values. | Multi-theme support unless a second reference image is provided. |
| Execution modes | No. | **v1.2 Phase 19**: Ask / Agent / YOLO mode system. |
| Git status | No. | **v1.2 Phase 19**: Branch + dirty indicator in statusbar. |
| Code block actions | No. | **v1.2 Phase 19**: Copy and "Apply to file" buttons. |
| Session rename | No. | **v1.2 Phase 19**: Click-to-edit session names. |
| Context intelligence | No. | **v1.2 Phase 20**: @-mentions, rules system, codebase search. |
| Plan mode | No. | **v1.2 Phase 20**: Agent generates reviewable plan before executing. |
| Custom docs indexing | No. | **v1.2 Phase 21**: Crawl + index external docs by URL. |
| Notepads | No. | **v1.2 Phase 21**: Persistent context documents. |
| Terminal AI | No. | **v1.2 Phase 21**: Natural-language-to-command in terminal. |
| Remote hosting | No. | Hosted multi-user deployment. |
| Telemetry | No external telemetry. | Optional local metrics dashboard. |

---

## 16. Implementation Plan

### Phase 0 — Monorepo Bootstrap

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 0.5–1 day | none | `pnpm dev` starts placeholder Fastify server and Vite app. |

Tasks:

- Create pnpm workspace.
- Configure TypeScript strict mode across packages.
- Add shared package exports.
- Add ESLint/Prettier.
- Add basic Vite React 19 app with Tailwind CSS v4.
- Add Fastify server with health route.
- Add root scripts: `dev`, `build`, `test`, `typecheck`, `migrate`.

### Phase 0.5 — Design Token Extraction

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 0.5 day | Phase 0, reference image provided | `tokens.css` populated with full token set; Tailwind v4 config wired; `Button` primitive reads exclusively from tokens in every state. |

Tasks:

- Place the reference image at `design-reference/reference.png`.
- Inspect the reference image and record palette, typography, density, radius, elevation, and motion notes in `design-reference/token-notes.md`.
- Populate `apps/web/src/styles/tokens.css` with the required token categories: color, typography, spacing, radius, motion, and elevation.
- Configure Tailwind v4 theme to read CSS custom properties.
- Implement `Button` using only token-backed Tailwind classes.
- Render `Button` in default, hover, pressed, disabled, focused, and loading states.
- Add a lint or review rule that rejects hardcoded visual values in component code.
- Replace all placeholder token values before merging the phase.

### Phase 1 — Shared Contracts and Database Foundation

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 1–1.5 days | Phase 0 | Server boots, runs migrations, validates settings and pricing defaults. |

Tasks:

- Implement `packages/shared` domain schemas.
- Implement WS protocol schemas.
- Implement REST contract schemas.
- Implement pricing and usage schemas.
- Add SQLite connection with WAL and foreign keys.
- Add Drizzle schema and initial migration.
- Implement repositories for settings, agents, runs, events.
- Add usage columns to `runs` from the first migration.
- Seed pricing settings with zero values and null verification timestamp.
- Add retention cleanup for raw events.
- Add unit tests for schema parsing and repository transactions.

### Phase 2 — Security, Keychain, and Workspace Policy

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 1 day | Phase 1 | User can store API key in Keychain and manage allowlisted workspaces. |

Tasks:

- Implement `keytar` API-key helpers.
- Add one-shot `CURSOR_API_KEY` import.
- Implement CSRF/session secret.
- Implement CORS and WebSocket Origin policy.
- Implement realpath workspace allowlist checks.
- Add REST routes for settings and workspace allowlist.
- Build Settings and Workspace pages using Phase 0.5 tokens.
- Add tests for symlink escape and non-allowlisted cwd rejection.

### Phase 3 — Cursor SDK Runtime Manager

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2 days | Phase 2 | User can create/resume an agent and start a run from REST. |

Tasks:

- Implement `AgentRuntimeManager`.
- Implement `agent-options-builder`.
- Wire `Agent.create`, `Agent.get`, and `Agent.list`.
- Persist agent lifecycle states.
- Implement `agent.send(prompt)` run startup.
- Create `AbortController` per run.
- Verify whether `agent.send(prompt, { signal })` compiles and works.
- Implement `run.cancel()` fallback detection.
- Add stream task skeleton.
- Add `run.wait()` final-result persistence.
- Add `usage-extractor` with unavailable default.
- Add `cost-calculator` using pricing settings and micro-USD integers.
- Add REST routes for agents and runs.
- Add integration tests with a mocked SDK adapter.

### Phase 4 — Event Normalization and WebSocket Streaming

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2–3 days | Phase 3 | Live SDK events stream to browser and replay after reconnect. |

Tasks:

- Implement SDK message guards.
- Implement canonical event normalizer.
- Implement sequence assignment transaction.
- Implement final result event normalization with usage payload.
- Implement run interruption event normalization.
- Implement run event bus.
- Implement WebSocket plugin and connection registry.
- Implement heartbeat and backoff contract.
- Implement subscribe/unsubscribe/replay.
- Implement `cancel_run` frame handling through `RunController`.
- Implement large payload references.
- Add tests for delta derivation, duplicate handling, cancellation states, and gap recovery.

### Phase 5 — Frontend State, Hooks, and Chat Shell

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2 days | Phase 0.5, Phase 4 | Browser can connect, subscribe to a run, and show a token-consistent raw event timeline. |

Tasks:

- Implement `websocket-client`.
- Implement Zustand stores.
- Implement `usage-store`.
- Implement `useWebSocket`.
- Implement `useAgentStream`.
- Implement `useUsage`.
- Build `AppShell`, sidebar, Chat page, Agent Picker page.
- Add `/usage` route skeleton.
- Add `ConnectionBanner`.
- Add basic `EventTimeline`.
- Add `CostBadge` placeholder states.
- Enforce no direct `useEffect` in components through lint rule or code review gate.
- Verify all visual primitives use Phase 0.5 tokens only.

### Phase 6 — Streaming Surfaces

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 3–4 days | Phase 0.5, Phase 5 | Chat renders markdown messages, thinking, tool calls, status, system banners, and cost states. |

Tasks:

- Implement `Message`.
- Implement `StreamingText` as leaf text-node primitive.
- Implement `StreamingMarkdown` with incremental block parser.
- Implement markdown rendering for paragraphs, headings, lists, blockquotes, code fences, tables, and thematic breaks.
- Implement parser fallback to escaped plain text.
- Implement `ThinkingTrace`.
- Implement `ToolCallCard`.
- Implement `ToolCallLane`.
- Implement `SystemBanner`.
- Implement `RunStatusPill`.
- Implement `CostBadge`.
- Implement `JsonInspector`.
- Add error boundaries around each streaming surface.
- Add visual states for running/completed/error tool calls.
- Add tests for arbitrary JSON payload rendering and streaming markdown fixtures.
- Verify block-boundary render budget with long markdown streams.

### Phase 7 — Code Edit Preview

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2–3 days | Phase 0.5, Phase 6 | Tool calls with diff/edit-shaped payloads animate character-by-character previews with incremental syntax highlighting. |

Tasks:

- Implement server `code-edit-extractors`.
- Support unified diff extraction.
- Support `{ path, before, after }` and `{ path, oldText, newText }` extraction.
- Emit `derived.code_edit` frames.
- Implement `useCodeEditAnimation`.
- Implement `useIncrementalSyntaxHighlighter`.
- Implement `SyntaxHighlighter` backed by `@lezer/highlight`.
- Add Lezer parser registry for TypeScript, JavaScript, Python, JSON, Markdown, shell, and plain text.
- Implement `CodeEditPreview`.
- Add caret rendering and replay speed integration.
- Add fixtures for large edits and unsupported shapes.
- Benchmark insertion batches and keep highlight work under budget.

### Phase 8 — History, Replay, and Usage

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2–3 days | Phase 0.5, Phase 6 | Completed runs replay identically from the event log and usage aggregates render on `/usage`. |

Tasks:

- Implement run history REST filters.
- Add Run History Cost column and token columns.
- Implement transcript endpoint with usage metadata.
- Implement usage summary, daily, weekly, by-model, and by-agent endpoints.
- Implement `useRunHistory`.
- Implement `useUsage`.
- Build Run History page.
- Build Run Replay page.
- Build Usage page with summary cards, breakdown tables, and trend chart.
- Add replay speed controls.
- Add event stepping and jump-to-error/tool-call/final-usage.
- Add virtualization for long runs.
- Verify completed streaming markdown renders identically to live rendering.

### Phase 9 — MCP, Subagents, and Advanced Agent Creation

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2–3 days | Phase 0.5, Phase 3 | New Agent dialog supports MCP servers, subagents, settings sources, sandbox, multi-cwd, and model selection. |

Tasks:

- Implement MCP repositories and routes.
- Implement MCP validation/status probes.
- Implement Subagent repositories and routes.
- Build MCP Servers page.
- Build Subagents page.
- Build advanced New Agent dialog.
- Resolve selected MCP/subagents into `Agent.create` options.
- Add tests for invalid config rejection and disabled resource exclusion.
- Verify all settings forms follow token and state styling rules.

### Phase 10 — Approval, Cancellation, and Resilience Seams

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 1–2 days | Phase 0.5, Phase 4 | UI handles request events, approval responses, and run cancellation honestly. |

Tasks:

- Implement `ApprovalPrompt`.
- Implement `approval_response` frame validation.
- Persist approval decision events.
- Implement `ApprovalResponder` seam with explicit unimplemented error until SDK method is verified.
- Complete `cancel_run` UI flow.
- Complete AbortController primary path.
- Complete `run.cancel()` fallback path.
- Surface `CANCEL_UNAVAILABLE` clearly.
- Add tests for pending request lifecycle, failed approval resolution, AbortSignal cancellation, and unavailable cancellation.

### Phase 11 — Performance, Polish, and Hardening

| Estimate | Dependencies | Runnable artifact |
|---:|---|---|
| 2–3 days | Phase 0.5, Phases 1–10 | v1.1 local app with measured streaming markdown, replay, settings, usage, history, and code-edit animation. |

Tasks:

- Add performance counters for event latency.
- Add stress fixture for 10,000 events and 100 events/sec.
- Benchmark `StreamingMarkdown` prose updates and block-boundary renders.
- Benchmark Lezer incremental highlighting during code-edit animation.
- Add payload truncation/lazy fetch tests.
- Add usage parse fixtures for known, missing, and malformed final result shapes.
- Add pricing settings validation tests.
- Audit logs for secret redaction.
- Add UI empty/loading/error states across all major views.
- Add crash-recovery integration test.
- Add cancellation integration test for verified SDK mechanism.
- Add design QA pass against the reference image and token checklist.
- Add build verification for strict TypeScript.
- Write README with setup, Keychain import, workspace allowlist, pricing setup, reference-image token process, and SDK verification checklist.

---

## 17. v1.2 Additions — Cursor Feature Parity

v1.2 closes the highest-impact gaps between CursorHarness and the native Cursor app. Phases are numbered 19+ and continue the existing phase discipline. All v1.2 work follows the same working agreements, token-only visual rules, persist-before-broadcast contract, and test gates from v1.1.

### 17.1 Execution Mode System (Phase 19)

The native Cursor app has three execution modes: Ask (read-only Q&A), Agent (default autonomous mode), and YOLO (auto-approve all actions). CursorHarness v1.1 has only one mode (Agent). v1.2 adds a first-class mode system.

#### Domain model

```ts
export const executionModeSchema = z.enum(["ask", "agent", "yolo"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;
```

Mode is stored at two levels:
- **Agent default mode**: Persisted in `agents.mode`. New runs inherit the agent's mode unless overridden.
- **Per-run mode**: Persisted in `runs.mode`. The mode used for a specific run is immutable after creation.

A global `settings.defaultMode` controls what mode new agents start with.

#### Mode behaviors

| Mode | SDK prompt modification | Approval handling | UI indicator |
|---|---|---|---|
| `ask` | Prepends read-only instruction: "You are in Ask Mode. Answer the user's question about the codebase. Do NOT make any file changes, do NOT run any terminal commands, do NOT use any tools that modify files or execute code. Only read files and answer questions." | N/A — agent should not trigger approvals | Message-circle icon, `--color-info` accent |
| `agent` | No modification (current behavior) | Normal approval flow (user approve/deny) | Bot icon, `--color-accent` |
| `yolo` | No modification | Auto-approve all approval requests when OQ-10 is resolved; store preference otherwise | Zap icon, `--color-warning` accent, one-time confirmation tooltip |

The prompt prefix for `ask` mode is applied at the SDK boundary in `agent-runtime.ts` only. The `runs.prompt` column stores the original user prompt for display and search.

#### UI surface

`ModeToggle`: Three-pill segmented control in the Composer area. Each pill shows an icon and short label. YOLO requires a one-time confirmation before first use per session.

#### Schema changes

```sql
ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'agent'
  CHECK (mode IN ('ask', 'agent', 'yolo'));
ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'agent'
  CHECK (mode IN ('ask', 'agent', 'yolo'));
ALTER TABLE runs ADD COLUMN name TEXT;
```

### 17.2 Git Status in Statusbar (Phase 19)

Native Cursor shows the current git branch and working-tree state. CursorHarness has no git awareness.

#### Server endpoint

`GET /api/git/status` returns:

```ts
const gitStatusResponseSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().nullable(),
  isDirty: z.boolean(),
  ahead: z.number(),
  behind: z.number(),
});
```

Implementation uses `execFile` (never `exec`) with the project's `execFileNoThrow` utility for subprocess safety. All git commands run with `cwd` set to the active workspace (realpath-validated). Results are cached for 10 seconds server-side.

#### UI surface

The statusbar gains a git section (left side): branch icon + branch name in `--font-mono --text-xs`, dirty dot in `--color-warning`, ahead/behind counts when non-zero. Hidden when `isGitRepo: false`. Frontend polls every 30 seconds via `useGitStatus` hook.

### 17.3 Code Block Actions (Phase 19)

v1.1 code blocks are display-only. v1.2 adds two action buttons.

#### Copy button

Every fenced code block gets a "Copy" overlay button (top-right corner, ghost style, clipboard icon). Uses `navigator.clipboard.writeText()`. Shows "Copied" checkmark for 2 seconds after click.

#### "Apply to file" button

Code blocks whose info string contains a filename annotation (e.g., `` ```ts:src/utils/helper.ts `` or `` ```ts src/utils/helper.ts ``) get an "Apply" button. The markdown block parser is extended to emit a `filename` field when the info string contains a path-like token.

**Server endpoint:** `POST /api/files/write`

```ts
const fileWriteRequestSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  workspaceId: z.string().optional(),
});
```

**Security (critical):** The endpoint reuses `workspace-policy.ts` checks:
1. Resolve workspace root from `workspaceId` or active workspace.
2. Join root + relative path, then `fs.realpath`.
3. Verify the resolved path starts with the workspace root (traversal guard).
4. Verify the workspace is in the allowlist.
5. Reject if any check fails.

### 17.4 Session Rename (Phase 19)

Runs gain a mutable `name` column (`TEXT`, nullable, max 200 chars). When a run is created without an explicit name, the server auto-generates one from the first line of the prompt (truncated to 60 chars with ellipsis).

`SessionsRail` displays `run.name`. Double-click activates inline edit mode. Enter/blur saves via `PATCH /api/runs/:runId`. Escape reverts.

### 17.5 Keyboard Shortcuts (Phase 19)

| Shortcut | Action |
|---|---|
| `Cmd+N` | New session: clear active run state, focus Composer. Run record is created on first send, not on shortcut press. |

Desktop menu: "New Session" added to File menu, wired through existing `onMenuAction` IPC bridge.

### 17.6 Run History Full-Text Search (Phase 19)

v1.1 deferred full-text search. v1.2 implements it with SQLite FTS5.

#### FTS5 virtual table

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(
  run_id UNINDEXED,
  prompt,
  name,
  content='',
  tokenize='porter unicode61'
);
```

Kept in sync via `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers on the `runs` table. Existing runs are backfilled at migration time.

#### Server endpoint

`GET /api/runs/search?q=...` returns ranked results with FTS5 `snippet()` highlights:

```ts
const runSearchQuerySchema = z.object({
  q: z.string().min(2).max(500),
  limit: z.number().int().min(1).max(100).default(20),
});
```

#### UI surface

Search input at the top of the Run History page. Debounced 300ms, minimum 2 characters. When active, replaces normal run list with ranked search results. `Cmd+F` on the page focuses the search input.

### 17.7 v1.2 Roadmap Summary

| Phase | Title | Key features | Dependencies |
|---|---|---|---|
| 19 | Execution Modes, Git Status, and UX Quick Wins | Mode system (Ask/Agent/YOLO), git status bar, code block copy/apply, session rename, Cmd+N, FTS search | v1.1 complete |
| 20 | Context Intelligence and Rules | @-mention system (@file, @folder, @symbol), project rules (`.harness/rules/`), codebase grep/search UI, Ask mode + codebase context | Phase 19 |
| 21 | Enrichment | Custom docs indexing, Notepads (persistent context), terminal AI (Cmd+K → command), slash commands | Phase 20 |
| 22 | Strategic | Codebase vector indexing, sub-agent parallel UI, Design Mode (browser → context), commit message generation, session diff view | Phases 19–21 |

Phase prompts live in the existing prompts directory. Each phase follows the same one-phase-per-session discipline from v1.1.
