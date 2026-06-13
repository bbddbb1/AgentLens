# Getting Started

Setting up AgentLens locally to run a multi-agent demonstration.

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** 20+
- **pnpm** 9+
- **Python** 3.11+ (for SDKs and demos)
- **Docker** + Docker Compose (for PostgreSQL, Redis, MinIO)

## 1. Clone & Install

Clone the repository and install the required Node.js dependencies:

```bash
git clone https://github.com/agentlens/agentlens.git
cd agentlens

cp .env.example .env
pnpm install
```

## 2. Start Infrastructure

Start the background services using Docker Compose. This boots PostgreSQL, Redis, and MinIO with health checks and auto-initialized buckets.

```bash
docker compose up -d
```

## 3. Start Dev Servers

Launch both the API server (default port `8001`) and the Next.js web UI (default port `3000`) via Turborepo. This command uses `scripts/ensure-docker.js` to confirm Docker is running before starting.

```bash
pnpm dev
```

*(Note: To skip the Docker check, run `pnpm dev:skip-docker`)*

## 4. Configure the Web App

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001
```

Once running, you can open the review UI at **http://localhost:3000**.

## 5. Run a Demo

Now that the control plane is running, you can run one of the included demo scenarios to see AgentLens in action.

First, sync your Python environment:
```bash
uv sync
```

### Release Gate Demo
The release gate demo runs a multi-agent execution with a LangGraph graph, raises a Human-in-the-Loop (HITL) interrupt, and prompts you to make a human decision. A markdown report is written to `examples/outputs/`.

```bash
python examples/hitl_release_gate_demo.py
```

### Incident Response Demo
To run the incident response scenario:

```bash
python examples/hitl_incident_response_demo.py
```

### Software Deployment Audit Demo
To run the software deployment audit demo using LangGraph:

```bash
python examples/demo_audit.py
```
