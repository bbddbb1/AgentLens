# @agentlens/protocol

Shared TypeScript schemas and semantic convention constants for the AgentLens control plane.

## What's Inside

- **schemas.ts** — Zod schemas for OTLP span validation, agent events, interrupts, and API request/response types.
- **semconv.ts** — TypeScript constants for AgentLens semantic convention attributes and event names (mirrors the Python `agentlens-otel-semconv` package).
- **types.ts** — TypeScript type definitions for missions, agents, graph nodes/edges, snapshots, and HITL interrupts.
- **runtimeContract.ts** — Frozen RuntimeExplanation v1, frame, provenance, and Governance contract schemas.
- **internal.ts** — Repository-internal deterministic projector exports; not a public wire contract.

## Usage

```typescript
import { AgentAttributes, MissionSchema } from '@agentlens/protocol';
```

## Build

```bash
pnpm --filter protocol build
```

## Design Rules

- This package is the **schema authority** for the API boundary; raw recorded telemetry,
  not an API schema or projection, remains the source of runtime truth. API routes
  validate input with these schemas.
- Fields added here propagate to `apps/api-ts` and `apps/web` through TypeScript types.
- Keep the semconv constants in sync with `packages/otel-semconv/` (Python counterpart).
- Keep L1 types workload-neutral and deterministic from evidence within one explicit
  runtime frame.
- Put optional domain or framework meaning in namespaced L2 lens contracts. Lenses must
  not alter core identity, lifecycle, outcome, topology, causality, provenance, or frame.
- Reuse existing evidence contracts before adding a field, relation, runtime node kind,
  or replay semantic; version and migrate any unavoidable contract change.
- Validate runtime contract behavior with both a domain-specific workload and at least one
  generic/non-domain fixture.
- Public consumers import schemas, constants, and DTOs from the package root. Projection
  implementations are available only through `@agentlens/protocol/internal` and must not
  be treated as a serializable public input contract.

## Runtime Story Validation Notes

- The runtime-story contract is validated against three corpus classes:
  - Corpus A: BSOps update/diagnosis
  - Corpus B: generic HITL multi-agent
  - Corpus C: sparse/conflict-heavy
- In this checkout, the shared corpus scaffolds live at:
  - `apps/api-ts/tests/fixtures/runtimeStoryCorpus.ts`
  - `apps/web/tests/fixtures/runtimeStoryFixtures.ts`
- If an external BSOps harness is unavailable, use the in-repo corpora and targeted unit
  suites as the compatibility fallback before adding new runtime fields or changing
  runtime-story transport behavior.
