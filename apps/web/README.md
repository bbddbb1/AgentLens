# AgentLens Web App

Next.js 16 review dashboard for observing and steering multi-agent AI systems.

## Architecture

The App Router mission workspace uses Zustand stores for replay, graph, audit,
and selection state. Summary, Graph, Timeline, Inspector, and current-event
focus consume the same frame-scoped RuntimeExplanation meaning. The web client
validates REST and realtime v1 payloads before changing state and rejects
mission, branch, version, or frame mismatches.

## State Management

The app uses Zustand for client-side state:
- Mission list state (fetch, filter, sort)
- Active mission detail + graph data
- frame-scoped RuntimeExplanation and Summary responses

## Graph Rendering

Mission graphs are rendered with [XYFlow](https://xyflow.com/), a React library for node-based graph UIs:
- Custom node types per `NodeType` (agent, task, tool, human, memory, artifact)
- Custom edge types per `EdgeType` (delegation, critique, review, escalation, data_flow, produces)
- Animated edge transitions on real-time updates
- Drag-to-rearrange with auto-layout fallback

## Run (local)

```bash
pnpm --filter web dev
```

## Environment Variables

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001
```

## Features

- Mission list with status filtering
- Interactive mission graph with real-time updates via WebSockets
- HITL interrupt and decision panel (approve / reject / revise)
- Evidence-bounded "why this state" explanations

## Tests

```bash
pnpm --filter web test
```

## Design Rules

- Keep framework-specific logic out of the UI — it consumes the protocol types only.
- Graph visualization state is derived from the API's `/graph` endpoint, not raw events.
- AI assistant queries are server-side to keep credentials out of the browser.
