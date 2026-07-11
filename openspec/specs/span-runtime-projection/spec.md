## Purpose

Define the current durable span/control evidence boundary and deterministic replay/graph projection behavior.

## Requirements

### Requirement: Runtime authority boundary matches persisted data
AgentLens SHALL treat persisted OTLP spans, the span events stored with those spans, explicit interrupt records, replay branches, and other existing control records as the current durable runtime evidence. AgentLens SHALL treat replay timeline envelopes, graph snapshots, current runtime state, runtime summaries, and runtime explanations as deterministic server-side projections rather than persisted authoritative facts.

#### Scenario: Replay is reconstructed from durable evidence
- **WHEN** a replay response is requested for a persisted mission and branch
- **THEN** the server derives replay events, graph snapshots, and current runtime state from the applicable spans, span events, interrupts, and branch records
- **AND** the server does not require a persisted `EventEnvelope` stream or graph snapshot

#### Scenario: Graph snapshots are requested
- **WHEN** a client requests the current graph or graph snapshots
- **THEN** the server returns graph data derived from the applicable durable runtime evidence
- **AND** the response does not imply that a graph-snapshot record was persisted

#### Scenario: Web client renders runtime meaning
- **WHEN** the Web client displays replay, graph, summary, or explanation data
- **THEN** it consumes the authoritative server-side projection for semantic runtime meaning
- **AND** it does not independently infer causal relationships from timing overlap, proximity, or names

#### Scenario: Authority documentation is read
- **WHEN** current architecture, API, ROPS, or protocol documentation describes the implemented runtime pipeline
- **THEN** it identifies projected `EventEnvelope` values and graph snapshots as derived rather than a durable append-only ledger
- **AND** aspirational ledger behavior is clearly separated from implemented behavior

### Requirement: Span-to-projection behavior is deterministic and evidence-bound
For the same ordered durable evidence and projection version, AgentLens SHALL produce equivalent replay event, graph node, graph edge, lifecycle status, and current-state semantics. Relationships SHALL require explicit recorded evidence, and explicit failure evidence SHALL never be projected as success.

#### Scenario: Single agent lifecycle
- **WHEN** one agent span records a start and successful terminal status
- **THEN** replay contains the agent lifecycle evidence and the projected agent/node reaches a completed state

#### Scenario: Parent-child span relationship
- **WHEN** a child span records a `parent_span_id` that resolves to a projected parent node
- **THEN** the graph contains the evidence-backed parent-child dependency edge

#### Scenario: Missing parent node
- **WHEN** a span records a `parent_span_id` for which no projected parent node exists
- **THEN** the graph does not fabricate a parent node or dependency edge

#### Scenario: Tool succeeds
- **WHEN** explicit tool lifecycle or span terminal evidence records success
- **THEN** the replay/explanation lifecycle and graph status represent the tool as successful or completed

#### Scenario: Tool fails
- **WHEN** explicit tool lifecycle or span terminal evidence records failure
- **THEN** the replay/explanation lifecycle and graph status represent the tool as failed
- **AND** no completion default overrides the failure

#### Scenario: Explicit interrupt
- **WHEN** a persisted interrupt or explicit interrupt span event applies to the branch
- **THEN** replay exposes the corresponding interrupt lifecycle with its recorded identifiers and status

#### Scenario: Explicit handoff or delegation with resolvable target
- **WHEN** supported telemetry records a handoff or delegation with an explicit source and a target that resolves to a projected node
- **THEN** the graph emits the corresponding delegation relationship with source evidence identifiers

#### Scenario: Relationship target is missing or unresolved
- **WHEN** handoff, delegation, or review telemetry omits a target or names a target that cannot resolve to a projected node
- **THEN** the graph emits no relationship edge to a fabricated or dangling target

#### Scenario: Timing overlap without relationship evidence
- **WHEN** two spans overlap in time but record no parent, handoff, delegation, review, or other supported relationship evidence
- **THEN** the projection emits no causal edge based only on overlap

### Requirement: Span projection responses expose an explicit version
AgentLens SHALL expose `projection_version: 'span_projection.v1'` on authoritative replay and graph projection responses so their semantics can be compared with future projection implementations.

#### Scenario: Replay projection is returned
- **WHEN** the replay endpoint returns a successful response
- **THEN** the top-level response includes `projection_version` equal to `span_projection.v1`

#### Scenario: Graph projection is returned
- **WHEN** the current-graph or graph-snapshots endpoint returns a successful response
- **THEN** the top-level response includes `projection_version` equal to `span_projection.v1`

#### Scenario: Existing client reads a versioned response
- **WHEN** a client ignores unknown additive response fields
- **THEN** all pre-existing replay and graph response fields retain their prior meaning

### Requirement: Projection baseline is protected at public boundaries
AgentLens SHALL protect the required projection semantics with characterization tests against public projection functions and API response contracts rather than private helper implementation details.

#### Scenario: Projection implementation is refactored
- **WHEN** internal helpers change without changing evidence-backed public behavior
- **THEN** the characterization suite continues to pass without depending on the private helper structure
