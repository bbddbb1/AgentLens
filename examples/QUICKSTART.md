# AgentLens Demo Quickstart

This guide runs the LangGraph HITL demos against the TypeScript control plane.

## 1. Start infrastructure

```bash
docker compose up -d
```

## 2. Start the API and web apps

```bash
pnpm dev
```

Create apps/web/.env.local if it does not exist:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001
```

Open http://localhost:3000.

## 3. Configure the demos

Both demos are deterministic and do not require an external model provider.

```bash
AGENTLENS_ENDPOINT=http://localhost:8001
AGENTLENS_UI_URL=http://localhost:3000
```

## 4. Run the release-gate demo

```bash
python examples/hitl_release_gate_demo.py
```

The script writes examples/outputs/release_gate_report.md and prints the mission URL.

## 5. Run the incident-response demo

```bash
python examples/hitl_incident_response_demo.py
```

The script writes examples/outputs/incident_response_report.md and uploads it to MinIO via the presign endpoint.

## What each demo demonstrates

- hitl_release_gate_demo.py: A human reviewer controls whether a production release can proceed, be remediated through data masking, or remain frozen.
- hitl_incident_response_demo.py: A human reviewer controls whether the system may take a disruptive containment action or must fall back to monitoring/manual follow-up.

## What happens under the hood

1. LangGraph emits callback events.
2. packages/sdk-langgraph maps callbacks to AgentLens semantic conventions.
3. packages/sdk-core exports spans to the OTLP endpoint at /v1/traces.
4. apps/api-ts validates spans, builds snapshots, stores them in Postgres, and broadcasts via WebSockets.
5. apps/web renders the mission graph and the pause/resume branch introduced by human decisions.
