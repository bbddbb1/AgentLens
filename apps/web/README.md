# AgentLens Web App

Next.js 16 review dashboard for observing and steering multi-agent AI systems.

## Architecture

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout (Tailwind, fonts, metadata)
│   │   ├── page.tsx            # Home — mission list
│   │   ├── missions/[id]/
│   │   │   └── page.tsx        # Mission detail — graph + review panel
│   │   └── api/
│   │       ├── assistant/
│   │       │   └── route.ts    # "Ask Pi" AI assistant endpoint
│   │       └── why-this-state/
│   │           └── route.ts    # State explanation endpoint
│   └── components/
│       ├── graph/
│       │   ├── MissionGraph.tsx # XYFlow-based graph visualization
│       │   ├── AgentNode.tsx    # Custom agent node renderer
│       │   └── TaskNode.tsx     # Custom task node renderer
│       ├── ai/
│       │   └── AiAssistant.tsx  # Embedded "Ask Pi" chat panel
│       └── common/
│           └── Tooltip.tsx      # Shared tooltip component
├── tests/
│   ├── unit/stores.test.ts      # Store unit tests
│   └── e2e/ui-flow.test.ts      # End-to-end UI flow tests
├── next.config.ts
└── package.json
```

## State Management

The app uses React Context + `useReducer` for client-side state:
- Mission list state (fetch, filter, sort)
- Active mission detail + graph data
- WebSocket connection state and event buffering
- AI assistant session state

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
- Embedded "Ask Pi" AI assistant (`@earendil-works/pi-coding-agent`)
- Demo-only "why this state" explanations

## Tests

```bash
pnpm --filter web test
```

## Design Rules

- Keep framework-specific logic out of the UI — it consumes the protocol types only.
- Graph visualization state is derived from the API's `/graph` endpoint, not raw events.
- AI assistant queries are server-side to keep credentials out of the browser.
