## Purpose

Define the canonical best-effort realtime notification for changes to durable replay evidence.

## Requirements

### Requirement: Canonical replay update has one precise meaning
AgentLens SHALL define `replay.updated` as the single realtime notification meaning that durable runtime evidence changed and replay-derived projections for the identified mission and branch should be reloaded. The notification SHALL NOT state or imply that a graph snapshot was created or persisted.

#### Scenario: Shared protocol represents replay update
- **WHEN** API and Web code handle the canonical notification
- **THEN** they use a shared protocol message containing `type: 'replay.updated'`, `mission_id`, and `branch_id`

#### Scenario: Existing projection notifications continue
- **WHEN** runtime summary or explanation projections are refreshed after ingest
- **THEN** their existing update notifications may still be sent with their distinct meanings
- **AND** none replaces or duplicates the durable-evidence meaning of `replay.updated`

### Requirement: Evidence-changing ingest attempts one best-effort replay update publication after commit
Each ingest request that changes durable runtime evidence SHALL make one best-effort attempt to publish `replay.updated` after the ingest transaction commits successfully. AgentLens SHALL NOT claim exactly-once publication or delivery, and publication failure SHALL NOT turn the committed ingest into an HTTP failure.

#### Scenario: Compatibility ingest commits
- **WHEN** `/api/v1/ingest/otlp` changes durable runtime evidence and its transaction commits
- **THEN** the API makes one best-effort `replay.updated` publication attempt for the request's resolved mission and branch

#### Scenario: Standard OTLP ingest commits
- **WHEN** `/v1/traces` changes durable runtime evidence and its transaction commits
- **THEN** the API makes one best-effort `replay.updated` publication attempt for the request's resolved mission and branch

#### Scenario: Realtime publication fails after commit
- **WHEN** the best-effort realtime publication attempt fails after durable ingest committed
- **THEN** the ingest route retains its successful HTTP response
- **AND** the API does not claim that the notification was delivered

#### Scenario: Validation or persistence fails
- **WHEN** ingest validation fails or the ingest transaction rolls back/throws
- **THEN** the API makes no `replay.updated` publication attempt

#### Scenario: Idempotent batch changes no evidence
- **WHEN** an already-accepted batch is recognized as an idempotent no-op and changes no durable evidence
- **THEN** the API makes no `replay.updated` publication attempt
- **AND** it uses the existing duplicate-`batch_id` outcome rather than a new generalized idempotency mechanism

### Requirement: Each ingest request retains one mission and branch scope
AgentLens SHALL preserve the current ingest constraint that one request resolves to one mission and one branch for all spans in that request. A successful evidence-changing request SHALL therefore require at most one branch-scoped `replay.updated` publication attempt.

#### Scenario: Compatibility batch contains multiple spans
- **WHEN** one compatibility ingest request contains multiple spans
- **THEN** all spans use the request's single resolved mission and branch
- **AND** the route makes at most one branch-scoped publication attempt after commit

#### Scenario: Standard OTLP JSON contains multiple resource or scope span groups
- **WHEN** `normalizeOtlpJson()` flattens multiple resource or scope span groups into one ingest batch
- **THEN** the current pipeline resolves one mission and branch for that entire request
- **AND** the change does not introduce per-span or multi-scope publication behavior

### Requirement: Web client handles a delivered replay update with a scoped reload
The existing mission realtime transport SHALL attempt its normal best-effort delivery of `replay.updated` to subscribed WebSocket clients. When the Web client receives the notification, it SHALL reload replay-derived state for the matching branch.

#### Scenario: Matching branch receives replay update
- **WHEN** the mission WebSocket client receives `replay.updated` for its current branch
- **THEN** it requests the current branch replay again and synchronizes replay-derived UI state from the server response

#### Scenario: Another branch receives replay update
- **WHEN** the mission WebSocket client receives `replay.updated` for a branch other than its current branch
- **THEN** it does not reload the current branch as though its evidence changed

#### Scenario: Interrupt or sandbox event arrives
- **WHEN** an existing interrupt or sandbox update event arrives
- **THEN** its existing branch-scoped reload behavior continues to operate alongside `replay.updated`

#### Scenario: Legacy snapshot-created assumption is evaluated
- **WHEN** ingest changes evidence but creates no persisted graph snapshot
- **THEN** the Web client relies on `replay.updated` rather than `graph.snapshot.created` to reload replay
