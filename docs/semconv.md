# AgentLens Semantic Conventions (Frozen Reference)

This document establishes the telemetry semantic conventions emitted by AgentLens SDKs and adapters. It defines the formal data contract between agent framework integrations and the Express control plane.

Version: 0.1 (frozen)

## Goals

- Establish a unified, framework-agnostic telemetry schema for multi-agent workflows.
- Standardize trace representations of agent execution steps, tool invocations, handoffs, human-in-the-loop interrupts, and reviews.
- Keep agent instrumentation code minimal while enabling consistent execution replay, visual graph rendering, and UI reporting.

## Scope

These conventions apply to OpenTelemetry spans and span events emitted by AgentLens adapters. The TypeScript control plane treats them as the formal interface contract.

## Required Base Attributes

Adapters must set these attributes on every AgentLens span:

- `agent.id` (required)
- `agent.span.kind` (required)
- `agent.framework` (recommended)
- `agent.name` (recommended)
- `agent.role` (recommended)

## Span Kinds

The `agent.span.kind` attribute is required on telemetry spans. Supported enum values:

- `mission` (represents the top-level workflow/run execution)
- `agent.orchestration`
- `agent.task`
- `agent.delegation`
- `agent.tool.call`
- `agent.review`
- `agent.reflection`
- `agent.planning`
- `agent.memory.op`
- `agent.human.input`

## Events

### Tool Call

Tool invocations can be represented as standalone spans or events on an existing span:

- Span attribute: `agent.span.kind = agent.tool.call`
- Required attribute: `agent.tool.name`
- Optional events:
  - `agent.tool.call` with `agent.tool.input`
  - `agent.tool.result` with `agent.tool.output`
  - `agent.tool.error` with `agent.tool.status = error`

### Handoff

Emit handoff events when control transitions between agents or shifts to a human supervisor:

- `agent.handoff.requested` (required when initiating a transition)
- `agent.handoff.accepted` (required when accepted by the recipient)
- `agent.handoff.rejected` (required when rejected or returned)

Required attributes:

- `agent.handoff.target`

Recommended attributes:

- `agent.handoff.reason`

Legacy alias: `agent.delegation` and `agent.delegation.*` are supported for backwards compatibility but should be replaced by `agent.handoff.*` in new integrations.

### Interrupt and Resume

Interrupts represent human-in-the-loop review gates or automated runtime policy blocks:

- `agent.interrupt.requested` (required when execution is paused)
- `agent.interrupt.resumed` (required when execution is continued)

Required attributes on `agent.interrupt.requested`:

- `agent.interrupt.id`
- `agent.interrupt.reason`

Recommended attributes:

- `agent.interrupt.resume_url`
- `agent.resume.token`
- `agent.timeout_at`
- `agent.policy.required_review`

When a human override decision is recorded, emit:

- `agent.human.decision` containing:
  - `agent.human.decision` (approve, reject, revise, resume)
  - `agent.human.input` (optional comments or parameters)

### Review

Formal peer or supervisor review steps emit one of:

- `agent.review`
- `agent.review.approved`
- `agent.review.changes_requested`
- `agent.review.rejected`

Required attributes:

- `agent.review.target` (the agent_id or span_id under review)

Recommended attributes:

- `agent.review.result` (approved, changes_requested, rejected)

## Source of Truth Reference

Constants and enums reside in the following modules:

- Python: `packages/otel-semconv/agentlens_otel_semconv/attributes.py`
- Python: `packages/otel-semconv/agentlens_otel_semconv/events.py`
- TypeScript: `packages/protocol/src/semconv.ts`

## LLM Trace Attributes

When an agent interacts with an LLM, the following attributes should be captured to provide model provenance:

- `gen_ai.system` (provider, e.g., openai, anthropic)
- `gen_ai.request.model` (model name)
- `gen_ai.model.version` (specific version)
- `gen_ai.prompt` (full prompt text)
- `gen_ai.completion` (full completion text)
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.usage.total_tokens`
- `gen_ai.request.temperature`
- `gen_ai.request.max_tokens`
- `gen_ai.response.finish_reason`
- `gen_ai.latency_ms`

LLM events to emit:
- `gen_ai.call`
- `gen_ai.response`
- `gen_ai.error`
- `gen_ai.streaming.start`
- `gen_ai.streaming.end`

## Error Attribution

To explicitly track failures across the system, use the following attributes:

- `error.source` (model, tool, human, policy, system)
- `error.cause` (hallucination, prompt_injection, tool_failure, timeout, permission_denied, validation_error)
- `error.severity` (low, medium, high, critical)
- `error.recovery.action` (retry, fallback, escalate, abort)
- `error.original` (original error message)
