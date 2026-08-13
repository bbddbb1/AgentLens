# AgentLens

<p align="center">
  <strong>Framework-agnostic Human-in-the-Loop telemetry and governance for multi-agent systems.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://github.com/agentlens/agentlens/actions"><img src="https://img.shields.io/badge/build-pending-lightgrey" alt="Build Status"></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-informational" alt="Version"></a>
</p>

AgentLens ingests **OpenTelemetry traces** from any multi-agent framework, structures them into **visual execution graphs**, and provides a **review UI** with pause, review, and resume workflows — giving you observability and runtime control over multi-agent loops without coupling to any single framework.

---

## Features

- **Framework-Agnostic Ingestion** — Uses standard OTLP/HTTP (`/v1/traces`) and compatibility JSON endpoints. Includes **native integration for LangGraph** (via automated callback handler) and **standard manual telemetry instrumentation for other frameworks** (CrewAI, AutoGen, OpenAI Agents SDK, custom scripts) via core SDK decorators.
- **Visual Execution Graphs** — Every agent step, handoff, tool call, and delegating loop is projected into an interactive visual graph you can step through chronologically.
- **Human-in-the-Loop (HITL) Reviews** — Agents can raise interrupts when human review or authorization is required. Reviewers can approve, reject, or supply execution overrides directly from the web UI.
- **Timeline Branching** — Fork execution at any state step to explore alternative outcomes or overrides without affecting the original run.
- **Real-Time WebSocket Updates** — Watch agent runs progress live with Redis-backed pub/sub for horizontal scaling.
- **Automated Anomaly Detection** — Automated detection of execution anomalies, recursive loops, and agent failures with template-based summaries and LLM support.
- **Telemetry SDKs** — Clean, lightweight Python SDK decorators and context managers for custom frameworks, plus a zero-code LangGraph callback handler.
- **Database and File Storage** — Secure storage of run logs and states in PostgreSQL, with support for file-based artifact storage in MinIO.

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

```bash
git clone https://github.com/agentlens/agentlens.git
cd agentlens

cp .env.example .env
pnpm install
docker compose up -d
pnpm dev
```

For full instructions, including configuration and running the examples, please see our [Getting Started Guide](docs/tutorials/getting-started.md).

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
├── docs/                 # Documentation (Diátaxis structure)
│   ├── tutorials/        # Getting started
│   ├── how-to/           # Guides and recipes
│   ├── explanation/      # Architecture and background
│   ├── reference/        # API and semantic conventions
│   └── project/          # Roadmap and governance
├── docker-compose.yml    # PostgreSQL, Redis, MinIO
├── turbo.json            # Turborepo pipeline config
├── pnpm-workspace.yaml   # pnpm workspace definition
└── pyproject.toml        # Python workspace (uv)
```

## Architecture

AgentLens is built on a high-throughput **control-plane / data-plane** split.
For a detailed architectural overview of the current span-backed evidence store,
derived replay compatibility shape, and timeline branching, see
[Architecture](docs/explanation/architecture.md).

For broader maintainer documentation (design constraints, roadmap), see [docs/README.md](docs/README.md).

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

Both endpoints accept spans with AgentLens/OpenTelemetry semantic convention
attributes (`gen_ai.agent.id`, `gen_ai.agent.role`, `gen_ai.agent.task`, etc.)
and project them into run state graphs.

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

## Roadmap

See [docs/project/roadmap.md](docs/project/roadmap.md) for detailed implementation status and future plans.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

---

<p align="center">
  <sub>Observe, review, and govern multi-agent system execution.</sub>
</p>
