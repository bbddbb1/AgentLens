# AgentLens Web App

Next.js review UI for AgentLens missions, realtime graph updates, and embedded AI assistant interactions.

## Run (local)

```bash
pnpm --filter web dev
```

## Environment variables

Create apps/web/.env.local:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001
```

## Features

- Mission graph and replay timeline.
- HITL interrupt and decision UI.
- Realtime updates over WebSockets.
- Embedded Pi assistant via /api/assistant.
- Demo-only why-this-state endpoint at /api/why-this-state.

## Local API routes

- `POST /api/assistant` uses `@earendil-works/pi-coding-agent` to answer mission-aware questions.
- `POST /api/why-this-state` generates a short system-level explanation for demo missions.

## Tests

```bash
pnpm --filter web test
```
