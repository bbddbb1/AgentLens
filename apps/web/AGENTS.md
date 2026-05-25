# AgentLens Web App - Code Agent Guide

This document is for code agents working on apps/web. It focuses on the web app, the embedded assistant, and how the web UI integrates with the API service.

## Workspace map

- Repo root: two levels above apps/web (used by the assistant resource loader).
- Web app root: apps/web
- API service: apps/api-ts
- Protocol package: packages/protocol

## Run (local)

```bash
pnpm --filter web dev
```

Create apps/web/.env.local:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001
```

## High-level architecture

```
Next.js UI (apps/web)
  ├─ Mission pages + replay UI
  ├─ API client (src/lib/api.ts)
  ├─ Realtime updates via WS (NEXT_PUBLIC_WS_URL)
  ├─ Embedded Pi assistant
  └─ Demo-only why-this-state API

TypeScript control plane (apps/api-ts)
  ├─ OTLP ingest (/v1/traces)
  ├─ Replay + summary APIs
  ├─ HITL interrupt/decision/resume
  └─ WebSocket fan-out (/ws/missions/:missionId)
```

## Embedded Pi assistant

### Flow

1. UI posts the prompt to /api/assistant.
2. The server route calls askAgentLens() to run Pi Coding Agent.
3. askAgentLens() loads the repo, runs read-only tools, and returns a response.
4. The UI renders the response or error.

### Key files

- [src/components/ai/AiAssistant.tsx](src/components/ai/AiAssistant.tsx)
- [src/app/api/assistant/route.ts](src/app/api/assistant/route.ts)
- [src/lib/ai.ts](src/lib/ai.ts)

### askAgentLens() details

- Repository root is resolved two levels up from apps/web.
- Pi Coding Agent runs with read-only tools: `read`, `grep`, `find`, `ls`.
- `.pi` directory is used for agent state/config at the repo root.
- The system prompt is set in [src/lib/ai.ts](src/lib/ai.ts).
- Response streaming is captured via `message_update` + `text_delta` events.

### API contract

Request:

```json
{
  "prompt": "Why is the mission blocked?",
  "missionId": "mission-123",
  "missionObjective": "Incident response",
  "missionStatus": "active"
}
```

Response:

```json
{
  "response": "..."
}
```

Errors:

- `400` missing prompt
- `500` assistant failure

## Why-this-state (demo route)

The demo UI calls a Next.js route rather than the API service.

Key file:

- [src/app/api/why-this-state/route.ts](src/app/api/why-this-state/route.ts)

Input:

```json
{
  "missionId": "demo-1",
  "phase": "executing",
  "eventDescription": "agent.task.completed",
  "agentStates": [
    { "name": "Researcher", "role": "research", "status": "active" }
  ],
  "pendingInterrupts": 1
}
```

Output:

```json
{
  "summary": "...",
  "conflicts": [],
  "anomalies": []
}
```

## UI entrypoints and data flow

- App router pages live in apps/web/src/app.
- API client lives in [src/lib/api.ts](src/lib/api.ts).
- Mission replay and why-this-state UI live under apps/web/src/components/replay.
- Shared view state is managed in apps/web/src/stores.

## When changing protocol or API

- Update schemas/constants in packages/protocol first.
- Keep web API clients aligned with API responses.
- If you add new events or attributes, update docs/semconv.md.

## Tests and lint

```bash
pnpm --filter web test
pnpm --filter web lint
```
1. Loading the repository structure
2. Checking for mission-specific logging or comments
3. Analyzing the codebase to infer execution flow
4. Returning a structured timeline

### Example 2: Code Exploration

User question: "Show me the main mission service implementation"

The assistant will:
1. Search for mission-related files
2. Read `services/missionStore.ts`
3. Extract key functions and their purposes
4. Summarize the mission store architecture

### Example 3: Framework Detection

User question: "What frameworks are being used for this mission?"

The assistant will:
1. Grep for known framework imports (LangGraph, CrewAI, AutoGen)
2. Analyze package.json and pyproject.toml
3. Report detected frameworks and versions

## Extending the Assistant

### Adding Custom Tools

Edit [src/lib/ai.ts](src/lib/ai.ts) and modify the `tools` array:

```typescript
const { session } = await createAgentSession({
  // ... other config ...
  tools: ['read', 'grep', 'find', 'ls', 'your_custom_tool'],
});
```

**Note:** Tool implementation is handled by Pi Coding Agent's tool registry.

### Modifying System Prompt

Override the system prompt to customize behavior:

```typescript
systemPromptOverride: () => [
  'You are an expert agent reviewer.',
  'Focus on performance metrics and anomalies.',
  'Suggest optimizations when relevant.',
].join(' '),
```

### Session Persistence

For multi-turn conversations, implement persistent session storage:

```typescript
const sessionManager = SessionManager.filesystem(
  path.join(process.cwd(), '.sessions')
);

const { session } = await createAgentSession({
  // ... other config ...
  sessionManager,
});
```

## Troubleshooting

### Assistant Returns Generic Responses

**Cause:** Mission context not properly passed.

**Solution:** Verify props in `<AiAssistant>` and API request body:

```tsx
<AiAssistant
  missionId={missionId} // Must not be undefined
  missionObjective={objective}
  missionStatus={status}
/>
```

### Cannot Find Repository Files

**Cause:** Repository root detection failed.

**Solution:** Ensure `.pi` agent directory exists and `process.cwd()` is set correctly:

```bash
mkdir -p .pi
```

### LLM Errors (Rate Limit, Auth)

**Cause:** Model registry or auth token issues.

**Solution:** Check environment variables:

```bash
# Verify API keys
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY

# Test model registry
node -e "require('./dist/lib/ai.js')"
```

### Timeout on Large Repositories

**Cause:** Repository analysis taking too long.

**Solution:** 
1. Increase request timeout in [src/app/api/assistant/route.ts](src/app/api/assistant/route.ts)
2. Limit search scope with `.gitignore` or explicit `cwd` configuration

## Best Practices

1. **Provide context** — Always pass mission metadata for grounded responses.
2. **Use templates** — Create common query patterns for consistency.
3. **Monitor costs** — Track LLM token usage for budgeting.
4. **Cache responses** — "Why This State" results are persisted in `semantic_summaries` (keyed by `mission_id + sequence_num + level`). Repeated requests for the same snapshot return instantly without calling the LLM.
5. **Iterative refinement** — Ask follow-up questions to refine results.
6. **Handle fallback gracefully** — The rule-based fallback in `buildWhyThisStateFallback()` produces varied, meaningful output even when the AI model is unavailable. Always design fallback paths that degrade gracefully rather than showing empty or generic text.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Next.js Frontend                  │
│  ┌──────────────────────────────────────────────┐   │
│  │        AiAssistant + Why This State          │   │
│  │  ╔════════════════════════════════════════╗  │   │
│  │  ║  Ask Pi Button                         ║  │   │
│  │  ║  ┌──────────────────────────────────┐  ║  │   │
│  │  ║  │ Prompt Input Textarea            │  ║  │   │
│  │  ║  ├──────────────────────────────────┤  ║  │   │
│  │  ║  │ Response Display                 │  ║  │   │
│  │  ║  └──────────────────────────────────┘  ║  │   │
│  │  ╠════════════════════════════════════════╣  │   │
│  │  ║  BranchExplorer "Why This State"      ║  │   │
│  │  ║  ┌──────────────────────────────────┐  ║  │   │
│  │  ║  │ AI-generated causal explanation  │  ║  │   │
│  │  ║  │ (per-snapshot, 40-80 words)      │  ║  │   │
│  │  ║  └──────────────────────────────────┘  ║  │   │
│  │  ╚════════════════════════════════════════╝  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         POST /api/assistant    POST /api/why-this-state
              ║                        ║
         ┌────▼────────────┐    ┌─────▼──────────────┐
         │  Next.js API    │    │  Next.js API route  │
         │  Handler        │    │  (demo missions)    │
         │  - Validate     │    │  - askAgentLens()   │
         │  - askAgentLens │    │  - Server-side only │
         └────┬────────────┘    └─────────────────────┘
              ║
         ┌────▼───────────────────┐
         │   Pi Coding Agent      │
         │  ┌──────────────────┐  │
         │  │ Model Registry   │  │
         │  ├──────────────────┤  │
         │  │ Resource Loader  │  │
         │  │ (Repo context)   │  │
         │  ├──────────────────┤  │
         │  │ Session Manager  │  │
         │  │ (In-memory)      │  │
         │  ├──────────────────┤  │
         │  │ Tool Executor    │  │
         │  │ - read, grep,    │  │
         │  │   find, ls       │  │
         │  └──────────────────┘  │
         └────────┬───────────────┘
                  ║
    ┌─────────────┴──────────────────┐
    │                                │
    ▼                                ▼
┌──────────────┐          ┌─────────────────────┐
│  Assistant   │          │  Why This State     │
│  Response     │          │  Backend API        │
│  (chat)      │          │  POST .../why-this  │
└──────────────┘          │  - generateWhyThis  │
                          │    State()          │
                          │  - Fallback engine  │
                          │  - Cache in PG      │
                          └─────────┬───────────┘
                                    │
                               ┌────▼────────────┐
                               │  LLM Response    │
                               │  (JSON-parsed)   │
                               └─────────────────┘
```

## References

- **Pi Coding Agent:** https://github.com/earendil-works/pi-coding-agent
- **OpenTelemetry:** https://opentelemetry.io/
- **AgentLens Semantic Conventions:** [packages/otel-semconv/](../../packages/otel-semconv/)
- **Python SDK:** [packages/sdk-core/](../../packages/sdk-core/)
- **LangGraph Adapter:** [packages/sdk-langgraph/](../../packages/sdk-langgraph/)

## Support

For issues or questions:

1. Check [examples/](../../examples/) for working demos
2. Review logs in `.pi/` agent directory
3. File an issue on the repository
4. Consult the main [README.md](../../README.md)
