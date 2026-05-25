# Changelog

All notable changes to AgentLens are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-25

### Added

- Initial public release of AgentLens.
- **Protocol** (`packages/protocol`): Shared TypeScript schemas (Zod), OTEL semantic convention constants, API types, and event definitions for multi-agent observability.
- **API Server** (`apps/api-ts`): TypeScript control plane with OTLP/HTTP ingest (`/v1/traces`), compatibility JSON endpoint, mission replay engine, HITL interrupt management, semantic summaries, artifact storage (MinIO), encrypted sharing, and Redis-backed WebSocket streaming.
- **Web UI** (`apps/web`): Next.js 16 review dashboard with XYFlow graph visualization, real-time mission monitoring, HITL decision panel, and embedded AI assistant ("Ask Pi").
- **Python SDK** (`packages/sdk-core`): Instrumentation SDK with context-manager API, OTLP span exporter, and AgentLens HTTP client.
- **LangGraph Integration** (`packages/sdk-langgraph`): Zero-code callback handler that auto-instruments LangGraph graphs.
- **OTEL Semantic Conventions** (`packages/otel-semconv`): Python constants for AgentLens-span attributes and event names.
- **Graph Engine** (`packages/graph-engine`): Python graph layout and data models.
- **Demo Scenarios**: Release gate (HITL production release review) and incident response (human-in-the-loop containment decision) demos.
- **Monorepo Infrastructure**: pnpm workspaces, Turborepo pipeline, uv Python workspace, Docker Compose stack (PostgreSQL 16, Redis 7, MinIO).
- **Documentation**: README, CONTRIBUTING guide, agent architecture whitepaper (`docs/agent.md`), OTEL semantic convention reference (`docs/semconv.md`), and quickstart guides.
