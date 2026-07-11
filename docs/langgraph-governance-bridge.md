# LangGraph Governance Bridge (vertical slice)

This document describes the LangGraph-only governance flow introduced by
`openspec/changes/establish-langgraph-governance-bridge`.

## Scope

- LangGraph is the only framework in scope.
- The bridge stays thin and framework-specific.
- LangGraph owns checkpoint state and native resume semantics.
- AgentLens Core stores user intent, delivery facts, and observed outcomes.
- `span_projection.v1` remains the runtime-observation path.
- No public executable runtime reference, checkpoint payload persistence,
  generalized governance adapter protocol, command bus, retry engine, or
  RuntimeEvidence abstraction.

## Separate state axes

```text
decision recorded ≠ delivery accepted ≠ runtime resumed
```

| Axis | Values (summary) |
| --- | --- |
| Request lifecycle | pending / resolved / expired / stale / unsupported |
| Decision state | none / recorded |
| Delivery state | not_requested / pending / accepted / failed / stale / unknown |
| Runtime outcome | awaiting_interaction / resumed / continued_with_input / rejected_or_terminated / failed / unknown |

## Binding liveness

Bindings are private and lease-based:

- States: `active`, `expired`, `revoked`, `consumed`
- Fields: registration time, lease expiry, last heartbeat/renewal, generation, revocation/consumption
- Only an **active, unexpired** binding may make a request actionable or claim a delivery
- Re-registration creates a new control reference and supersedes the prior binding
- Bridge restart must re-register; AgentLens restart preserves persisted metadata subject to lease
- Raw control reference is never disclosed on public APIs/UI/OTLP

## Claim versus acceptance

- A **claim** only reserves delivery for one binding instance.
- External delivery remains `pending` after claim.
- Delivery becomes `accepted` only after an explicit receipt that LangGraph accepted the native operation.
- Claim timeout / uncertain post-claim disappearance → `unknown` (no automatic retry).
- Claim internals stay private to Core/bridge.

## Exact identity matching

Required equal fields:

- mission ID, branch ID, `framework=langgraph`, interaction/interrupt request ID
- thread ID when required by the reference graph

Consistency when both sides present:

- run ID, parent-run ID, checkpoint ID/namespace, activity-correlation ID

Rules:

- missing required → non-actionable
- explicit conflict → diagnostic + block
- optional absence → partial, not conflict
- no names/timing/topology/fuzzy/`native_execution_key` matching
- observational IDs are not authentication credentials
- bridge endpoints also use existing service auth (`AGENTLENS_SERVICE_TOKEN` / Bearer) plus mission/branch path isolation

## Out-of-order reconciliation

Decision records, receipts, and correlated runtime telemetry may arrive in any order.

- Axes remain independent
- Late events must not regress a stronger already-recorded state
- Accepted delivery + later runtime failure → `delivery=accepted`, `runtime_outcome=failed`
- Accepted without outcome evidence → outcome `unknown`
- Unrelated later activity never implies resume

## Structured decision bounds

Operator structured values are validated before recording:

- max serialized size / nesting depth / collection size (protocol constants)
- JSON-like types only
- schema validation against the request’s safe schema
- binary / arbitrary objects rejected
- public display allowlisted; full values excluded from OTLP/replay/graph/explanation/unrestricted audit
- secrets/tokens/credentials out of scope unless an existing dedicated secret mechanism applies

## Feature flag

`LANGGRAPH_GOVERNANCE_ENABLED` defaults to **off**.

Control-plane availability also requires configured service authentication
(`AGENTLENS_SERVICE_TOKEN` or `AGENTLENS_API_KEY`). When the flag is on but the
token is missing, bridge endpoints fail closed (503) and actionability stays
unavailable; `span_projection.v1` observability continues to operate.

- When control plane unavailable: bridge registration and request actionability are unavailable; new control delivery is prevented
- Existing request/decision/delivery/audit records remain readable
- `span_projection.v1` observability remains available
- Govern UI controls remain hidden or non-actionable

Enable only for the reference deployment:

```bash
LANGGRAPH_GOVERNANCE_ENABLED=true
AGENTLENS_SERVICE_TOKEN=your-service-token
```

## Adapter bridge

See `packages/sdk-langgraph/agentlens_langgraph/governance_bridge.py`.

Private endpoints:

- `POST /api/v1/missions/:missionId/branches/:branchId/langgraph/bridge/register`
- `POST .../renew`
- `POST .../claim`
- `POST .../receipt`

## Deferred

Generalized multi-framework governance, second framework, plugins, arbitrary
workflow controls, checkpoint browsing, public executable references, and broad
authorization redesign remain explicitly out of scope.

## Accepted follow-ups (not in this change)

1. Add a real CI path using live API + PostgreSQL + HTTP bridge + OTLP + LangGraph.
2. Optionally transition unclaimed pending deliveries to `unknown` when their binding expires
   (pending-delivery expiry sweeper / background reconciliation — not implemented here).
