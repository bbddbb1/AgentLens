# @agentlens/protocol

Shared TypeScript schemas and semantic convention constants for the AgentLens control plane.

## What's Inside

- **schemas.ts** — Zod schemas for OTLP span validation, agent events, interrupts, and API request/response types.
- **semconv.ts** — TypeScript constants for AgentLens semantic convention attributes and event names (mirrors the Python `agentlens-otel-semconv` package).
- **types.ts** — TypeScript type definitions for missions, agents, graph nodes/edges, snapshots, and HITL interrupts.

## Usage

```typescript
import { AgentAttributes, MissionSchema } from '@agentlens/protocol';
```

## Build

```bash
pnpm --filter protocol build
```

## Design Rules

- This package is the **source of truth** for the API boundary. API routes validate input with these schemas.
- Fields added here propagate to `apps/api-ts` and `apps/web` through TypeScript types.
- Keep the semconv constants in sync with `packages/otel-semconv/` (Python counterpart).
