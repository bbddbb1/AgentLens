# AgentLens Semantic Conventions (Frozen)

This document freezes the semantic conventions emitted by adapters. It is the contract between framework integrations and the control plane.

Version: 0.1 (frozen)

## Goals

- Provide a unified event model across agent frameworks.
- Define what counts as an agent, tool call, handoff, interrupt, resume, and review.
- Keep adapters lightweight while enabling consistent replay, governance, and UI.

## Scope

These conventions apply to OpenTelemetry spans and span events emitted by AgentLens adapters. The TypeScript control plane treats them as the source of truth.

## Required base attributes

Adapters should set these attributes on every AgentLens span:

- `agent.id` (required)
- `agent.span.kind` (required)
- `agent.framework` (recommended)
- `agent.name` (recommended)
- `agent.role` (recommended)

## Span kinds

`agent.span.kind` is required on spans. Supported values:

- `mission`
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

### Tool call

Tool usage can be a span or events on a span:

- Span attribute: `agent.span.kind = agent.tool.call`
- Required attribute: `agent.tool.name`
- Optional events:
  - `agent.tool.call` with `agent.tool.input`
  - `agent.tool.result` with `agent.tool.output`
  - `agent.tool.error` with `agent.tool.status = error`

### Handoff

Use handoff events when control moves between agents (or to a human supervisor):

- `agent.handoff.requested` (required when initiating a handoff)
- `agent.handoff.accepted` (required when accepted)
- `agent.handoff.rejected` (required when rejected)

Required attributes:

- `agent.handoff.target`

Recommended attributes:

- `agent.handoff.reason`

Legacy alias: `agent.delegation` and `agent.delegation.*` are accepted but should be replaced by `agent.handoff.*` in new adapters.

### Interrupt and resume

Interrupts represent human review or policy gates:

- `agent.interrupt.requested` (required)
- `agent.interrupt.resumed` (required when resumed)

Required attributes on `agent.interrupt.requested`:

- `agent.interrupt.id`
- `agent.interrupt.reason`

Recommended attributes:

- `agent.interrupt.resume_url`
- `agent.resume.token`
- `agent.timeout_at`
- `agent.policy.required_review`

When a human decision is captured, emit:

- `agent.human.decision` with:
  - `agent.human.decision` (approve, reject, revise, resume)
  - `agent.human.input` (optional)

### Review

Formal review steps emit one of:

- `agent.review`
- `agent.review.approved`
- `agent.review.changes_requested`
- `agent.review.rejected`

Required attributes:

- `agent.review.target` (agent id or span id under review)

Recommended attributes:

- `agent.review.result` (approved, changes_requested, rejected)

## Source of truth

Constants and enums live in:

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

Constants and enums live in:

- Python: `packages/otel-semconv/agentlens_otel_semconv/attributes.py`
- Python: `packages/otel-semconv/agentlens_otel_semconv/events.py`
- TypeScript: `packages/protocol/src/semconv.ts`

