# AgentLens TypeScript API

Canonical AgentLens control-plane backend.

## Responsibilities

- Validate AgentLens protocol payloads with `@agentlens/protocol`.
- Ingest OTLP/HTTP JSON at `POST /v1/traces`.
- Ingest compatibility AgentLens span JSON at `POST /api/v1/ingest/otlp`.
- Project spans/events into temporal graph snapshots.
- Validate and serve the frozen `runtime_explanation.v1` REST/realtime contract.
- Persist missions, snapshots, reviews, comments, shares, and HITL interrupts.
- Store artifact metadata and issue MinIO presigned URLs.
- Broadcast mission events through Redis-backed WebSockets.

## Run (local)

```bash
pnpm --filter api-ts dev
```

Defaults:

- API: http://localhost:8001
- WebSocket: ws://localhost:8001/ws/missions/:missionId
- Database: postgresql://agentlens:agentlens@localhost:5432/agentlens
- MinIO: http://localhost:9000 (bucket: agentlens-artifacts)

## Environment variables

These default to local Docker Compose values if unset:

- `PORT` (default 8001)
- `DATABASE_URL` (default postgresql://agentlens:agentlens@localhost:5432/agentlens)
- `REDIS_URL` (default redis://localhost:6379)
- `MINIO_ENDPOINT` (default http://localhost:9000)
- `MINIO_BUCKET` (default agentlens-artifacts)
- `MINIO_ACCESS_KEY` (default agentlens)
- `MINIO_SECRET_KEY` (default agentlens-secret)
- `MINIO_REGION` (default us-east-1)
- `SUMMARY_TIMEOUT_MS` (default 15000)

## Key endpoints

Ingestion:

- `POST /v1/traces` OTLP/HTTP JSON
- `POST /api/v1/ingest/otlp` compatibility JSON

Mission graph and replay:

- `GET /api/v1/missions/:id/graph`
- `GET /api/v1/missions/:id/graph/snapshots`
- `GET /api/v1/missions/:id/replay?branch_id=...`
- `GET /api/v1/missions/:id/replay/branches`
- `POST /api/v1/missions/:id/replay/branches`
- `GET /api/v1/missions/:id/explanation?branch_id=...&sequence_num=...`
- `GET /api/v1/missions/:id/runtime-summary?branch_id=...&sequence_num=...` (derivative compatibility view)

HITL interrupts:

- `POST /api/v1/interrupts`
- `GET /api/v1/missions/:missionId/interrupts?status=pending`
- `POST /api/v1/missions/:missionId/interrupts/:interruptId/decision`
- `POST /api/v1/interrupts/resume`

Summaries:

- `GET /api/v1/missions/:missionId/summary`
- `POST /api/v1/missions/:missionId/summary/generate`
- `POST /api/v1/missions/:missionId/why-this-state`

Reviews and comments:

- `POST /api/v1/missions/:missionId/reviews`
- `GET /api/v1/missions/:missionId/reviews`
- `POST /api/v1/missions/:missionId/comments`
- `GET /api/v1/missions/:missionId/comments`
- `PATCH /api/v1/missions/:missionId/comments/:commentId/resolve`

Artifacts:

- `POST /api/v1/missions/:missionId/artifacts/presign`
- `GET /api/v1/missions/:missionId/artifacts`
- `GET /api/v1/missions/:missionId/artifacts/:artifactId/download`

Sharing:

- `POST /api/v1/missions/:missionId/share`
- `GET /api/v1/missions/:missionId/shares`

## Tests

```bash
pnpm --filter api-ts test
```

## Design rules

- Keep framework-specific translation in private normalization modules; universal projection remains framework-neutral.
- Add protocol fields in `packages/protocol` before using them here.
- Treat OTel spans/events as the execution-framework boundary.
