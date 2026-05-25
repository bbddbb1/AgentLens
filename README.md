# AgentLens

<p align="center">
  <strong>Framework-agnostic Human-in-the-Loop control plane for multi-agent AI systems.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://github.com/agentlens/agentlens/actions"><img src="https://img.shields.io/badge/build-pending-lightgrey" alt="Build Status"></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-informational" alt="Version"></a>
</p>

AgentLens ingests **OpenTelemetry traces** from any multi-agent framework, projects them into **replayable interaction graphs**, and powers a **review UI** with interrupt/decision/resume workflows — giving you observability and control over autonomous AI teams without coupling to a specific agent framework.

---

## Features

- **Framework-Agnostic Ingestion** — Native OTLP/HTTP (`/v1/traces`) and compatibility JSON endpoints. Supports LangGraph, AutoGen, CrewAI, OpenAI Agents SDK, and custom frameworks out of the box.
- **Replayable Mission Graphs** — Every agent interaction, delegation, critique, tool call, and handoff is projected into a time-series graph you can pause, rewind, and replay.
- **Human-in-the-Loop (HITL)** — Agents can request human review via interrupts. Reviewers approve, reject, request changes, or trigger remediation branches — all from the web UI.
- **Branch-Based What-If Analysis** — Fork mission timelines at any sequence point to explore alternative decisions without affecting the original execution.
- **Real-Time WebSocket Streaming** — Watch multi-agent missions unfold live with Redis-backed pub/sub for horizontal scaling.
- **Semantic Analysis Engine** — AI-powered summaries of mission state, conflict detection, and anomaly flagging (with deterministic template-based fallbacks).
- **Multi-Framework SDKs** — First-class Python instrumentation SDK with context-manager API, plus a LangGraph callback handler for zero-code instrumentation.
- **End-to-End Encryption** — Mission data and shared artifacts support encrypted storage with per-user key sharing.
- **MinIO Artifact Storage** — S3-compatible object storage for agent-produced artifacts (reports, datasets, decision logs).

## Tech Stack

| Layer | Technology |
|---|---|
| **API Server** | Node.js 20+, Express 5, TypeScript |
| **Web UI** | Next.js 16 (App Router), React 19, Tailwind CSS 4, [XYFlow](https://xyflow.com/) |
| **Database** | PostgreSQL 16 (missions, events, snapshots, agents) |
| **Cache & Pub/Sub** | Redis 7 (real-time WebSocket fan-out) |
| **Object Storage** | MinIO (S3-compatible, agent artifacts) |
| **Telemetry** | OpenTelemetry (custom OTLP/JSON exporter) |
| **Python SDKs** | Python 3.11+, OpenTelemetry SDK, httpx |
| **AI/LLM** | `@earendil-works/pi-coding-agent` (semantic summaries), BYOK model support |
| **Monorepo** | pnpm 9 + Turbo + uv (Python workspace) |
| **Validation** | Zod (TypeScript), Pydantic-style (Python, planned) |
| **Linting/Formatting** | ESLint 9, Prettier, Ruff (Python) |

## Quick Start

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **Python** 3.11+ (for SDKs and demos)
- **Docker** + Docker Compose (for PostgreSQL, Redis, MinIO)

### 1. Clone & Install

```bash
git clone https://github.com/agentlens/agentlens.git
cd agentlens

cp .env.example .env
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose up -d
```

This boots PostgreSQL, Redis, and MinIO with health checks and auto-initialized buckets.

### 3. Start Dev Servers

```bash
pnpm dev
```

This launches both the API server (default port `8001`) and the Next.js web UI (default port `3000`) via Turborepo. Uses `scripts/ensure-docker.js` to confirm Docker is running before start.

To skip the Docker check:

```bash
pnpm dev:skip-docker
```

### 4. Configure the Web App

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001
```

Open **http://localhost:3000**.

### 5. Run a Demo

```bash
uv sync
python examples/hitl_release_gate_demo.py
```

The demo creates a multi-agent mission with a LangGraph graph, raises a HITL interrupt, and prompts you to make a human decision. A markdown report is written to `examples/outputs/`.

For the incident response scenario:

```bash
python examples/hitl_incident_response_demo.py
```

## Monorepo Layout

```
agentlens/
├── apps/
│   ├── api-ts/           # TypeScript control plane (ingest, replay, HITL)
│   └── web/              # Next.js review UI + embedded AI assistant
├── packages/
│   ├── protocol/         # Shared TS schemas, semconv keys, API types (Zod)
│   ├── sdk-core/         # Python instrumentation SDK (AgentLens client)
│   ├── sdk-langgraph/    # LangGraph callback handler (auto-instrumentation)
│   ├── otel-semconv/     # Python semantic convention constants
│   └── graph-engine/     # Python graph layout & models
├── examples/             # HITL demo scenarios (release gate, incident response)
├── scripts/              # Dev helpers (Docker check, run-dev orchestrator)
├── docs/                 # Technical specifications
│   ├── semconv.md        # OTEL semantic convention reference
│   └── agent.md          # AI Agent architecture whitepaper
├── docker-compose.yml    # PostgreSQL, Redis, MinIO
├── turbo.json            # Turborepo pipeline config
├── pnpm-workspace.yaml   # pnpm workspace definition
└── pyproject.toml        # Python workspace (uv)
```

## Architecture

AgentLens follows a **control-plane / data-plane** architecture:

1. **Data Plane** — Your multi-agent system (LangGraph, CrewAI, custom) runs normally. The AgentLens Python SDK instruments it with OpenTelemetry spans and events.
2. **Control Plane** — The TypeScript API ingests OTLP traces, builds replayable graph snapshots, manages HITL interrupts, and serves the review UI.
3. **Review UI** — A Next.js dashboard for browsing missions, inspecting replay graphs, submitting human decisions, and forking timelines.

For a deep-dive into the AI agent architecture, prompt engineering, tool definitions, and the replay state machine, see **[docs/agent.md](docs/agent.md)**.

## Ingestion API

**Native OTLP/HTTP JSON:**

```text
POST http://localhost:8001/v1/traces
Content-Type: application/json
```

**Compatibility JSON:**

```text
POST http://localhost:8001/api/v1/ingest/otlp
Content-Type: application/json
```

Both endpoints accept spans with AgentLens semantic convention attributes (`agent.id`, `agent.role`, `agent.task`, etc.) and project them into mission graphs.

## Developer Workflows

### TypeScript

```bash
pnpm lint          # ESLint across all workspaces
pnpm test          # Vitest across all workspaces
pnpm format        # Prettier
pnpm build         # TypeScript compilation
```

### Python

```bash
uv sync            # Install Python dependencies
uv run pytest      # Run Python test suite
uv run ruff check  # Lint Python code
```

### Individual Packages

```bash
pnpm dev:api-ts             # API server only (hot reload)
pnpm --filter api-ts test   # API tests only
pnpm --filter web dev       # Web UI only
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

---

<p align="center">
  <sub>Built for teams who need to observe, review, and steer their AI agents — not just trust them.</sub>
</p>
