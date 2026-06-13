# Architecture

Status: accepted  
Last updated: 2026-06-11  
Audience: maintainers, adapter authors

AgentLens is **runtime infrastructure for autonomous agent execution**. It records execution as a canonical, branch-aware, append-only event ledger and derives observability, governance, replay, and human control from that ledger.

The UI is a projection over runtime truth — not the architecture. For current implementation (ingest paths, tables, APIs, replay algorithm), see [agent-api.md](../reference/agent-api.md).

## Scope and boundaries

### What AgentLens owns

| Owns | Does not own |
|---|---|
| Canonical `EventEnvelope` and semantic conventions | Agent framework schedulers or orchestration |
| Append-only mission event ledger | End-to-end agent framework |
| Replay, branch lineage, state reconstruction | Workflow authoring / low-code builders |
| Policy and HITL as runtime events | Vector memory backends |
| Adapter translation into canonical events | Mutable UI state as source of truth |

### Data plane vs control plane

Your agent application (LangGraph, CrewAI, custom) emits OTel spans/events via SDK adapters. AgentLens ingests OTLP, normalizes to the ledger, replays state, and serves projections (graph, policy, HITL, branch APIs) to the web UI.

OpenTelemetry is the **transport and ecosystem bridge**. AgentLens defines the **agent runtime semantic layer** above raw spans: actors, causality, policy decisions, branch identity, interrupts, and provenance.

### Existing building blocks

The repo already contains the primitives this model depends on:

- OTLP ingestion and span normalization
- `EventEnvelope` and AgentLens semantic conventions (`packages/protocol`, `packages/otel-semconv`)
- Append-only `mission_events` with branch and hash-chain fields
- Replay engine and graph snapshots
- HITL interrupts and built-in policy evaluation
- Branch manager and sandbox jobs
- Python/TS SDKs and LangGraph adapter

The maintenance task is to **harden these primitives** so adapters stay thin and projections stay rebuildable.

### Design goals

We optimized for the following outcomes:

1. Events from LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, or custom loops normalize to the same `EventEnvelope`.
2. Given mission ID + branch ID + sequence, replay produces the same runtime state deterministically.
3. Policy actions, human decisions, replay forks, and resumes appear as auditable ledger events.
4. A branch exposes parent, fork point, inherited prefix, divergent suffix, and integrity status.
5. "Why is this state true?" is answerable from the ledger without trusting UI-local state.
6. Adapter authors can pass a conformance suite without reading control-plane internals.

We explicitly avoid building a graph UI over traces, relying on hidden framework state for replay, or running policy as silent side effects.

### Scope boundaries

- **Integrate with OpenTelemetry** — do not replace it.
- **Adapters translate** — they do not define platform truth.
- **Snapshots and summaries are projections** — the ledger is authoritative.
- **Governance is execution semantics** — not comments or alert metadata.

## Runtime mental model

AgentLens uses these core concepts across frameworks. For implementation details, see [agent-api.md#replay-engine--branch-semantics](../reference/agent-api.md#replay-engine--branch-semantics).

### Execution

Execution is the ordered progression of **actors** (agents, tools, humans, policies, systems) through runtime events.

A trace waterfall shows timing and parent-child structure. Agent execution also requires:

- state transitions and governance decisions
- branch identity and causality
- side-effect and external-dependency boundaries

Each recorded action should answer: who acted, what happened, what caused it, what state changed, which branch, whether it was governed, and whether it is replayable.

### State

Runtime state is a **projection from events**.

| Source | Role |
|---|---|
| Canonical events | Source of truth |
| Checkpoints | Replay acceleration; must match event semantics |
| Graph snapshots | UI cache; rebuildable from events |
| UI layout / filters | Ephemeral; never authoritative |

State includes graph topology and non-visual facts: active agents, pending tasks, tool calls, memory reads/writes, artifacts, policy decisions, interrupts, branch lineage, model/tool provenance, errors, and external dependency status.

**State gaps must be explicit.** If something cannot be reconstructed from events and checkpoints, mark it — do not imply determinism.

### Events

`EventEnvelope` is the main abstraction boundary. All ingestion paths should target the same envelope shape.

Minimum dimensions:

| Dimension | Examples |
|---|---|
| Identity | event ID, mission ID, branch ID, sequence, timestamp |
| Classification | event type, span kind, runtime category |
| Actor | actor type, actor ID |
| Causality | parent span, triggering event, tool call ID |
| Payload | event-specific structured data |
| Provenance | framework, model, tool, human, policy, SDK |
| Integrity | previous hash, content hash, branch sequence |
| Governance | policy decision, redaction, review requirement |
| Replay | deterministic input flag, external effect marker, checkpoint link |

Events are **versioned**. Old records must remain interpretable after protocol changes.

### Replay

Three levels — strengthen them in order:

1. **Projection replay** — Rebuild state graphs and runtime state from events. *Current focus.*
2. **Diagnostic replay** — Explain why a state was true (causality, policy, provenance).
3. **Execution replay** — Re-run or fork under controlled external dependency policies.

Replay must distinguish:

- deterministic events
- observed nondeterministic events
- external side effects and mocked dependencies
- human decisions and policy version changes
- missing capture

The replay engine should eventually report **fidelity confidence**, not just animate history.

### Governance

Governance controls whether execution may continue, pause, branch, redact, deny, or require review.

Required control-plane artifacts:

- policy definitions and versions
- policy evaluation and enforcement records
- interrupt creation, human decision capture, resume semantics
- override payloads and audit export

Observability explains what happened; governance explains what was allowed and why. Both come from the same ledger.

### Observability

AgentLens observability is **semantic**, not trace-only:

- execution timeline and semantic graph
- causal, branch, policy, and state graphs
- provenance trail, runtime health, replay fidelity

Traditional metrics and traces remain useful as inputs. The unique layer is agent runtime semantics above them.

### Debugging

Operator debugging should behave like a debugger, not a dashboard:

- state at sequence N
- event before failure
- branch divergence point
- last policy / human decision
- model and tool provenance
- missing state, loops, unsafe handoffs

Stepping, breakpoints, state diffs, and causal queries are projections over replayed state — not one-off UI features.

### Provenance

Provenance connects a runtime fact to its origin:

- framework and adapter/SDK version
- trace/span identity
- actor, model (provider/version), tool
- human identity and decision context
- policy rule and version
- branch lineage and hash-chain integrity

Attach provenance when recording facts. Do not reconstruct it loosely from metadata later.

### Human intervention

Human-in-the-loop is a **state transition sequence**:

```
interrupt.requested → reviewer notified → decision.recorded
  → payload attached → resume validated → execution resumed | rejected
  → optional branch created
```

Record outcome **and** decision context (policy reason, payload). Human actions are replayable events.

## Design principles

These principles guide day-to-day design choices. Violating a [design constraint](#design-constraints) is a hard reject; violating a principle needs explicit justification in review.

### Runtime first, UI second

Every UI capability should map to a runtime question: what happened, why, what state was true, who caused it, what policy applied, whether the branch is auditable/replayable.

If a feature cannot trace back to a ledger primitive, it should not drive the roadmap.

### Event truth over mutable state

Execution is events first. Graph snapshots, summaries, and dashboards are projections.

Strengthening `mission_events` and `EventEnvelope` has higher leverage than new panels or filters.

### Semantics over spans

Consume OTel spans and events; normalize to agent runtime semantics:

actor, causality, model provenance, tool effects, policy, branch lineage, interrupts, state transitions, memory/artifact interactions, error attribution.

Plain traces are necessary but insufficient.

### Governance as execution

Policy evaluation, enforcement, HITL interrupts, human decisions, and resumes are **runtime events** — not alerts, comments, or UI statuses.

### Adapters are translators

Adapters map framework-local telemetry to canonical events. They must not own replay, policy, audit, or state reconstruction.

Measure adapter quality by semantic fidelity and conformance tests, not by framework-specific UI affordances.

### Replay is a correctness feature

Projection replay must be correct before investing in execution replay or sandbox theatrics.

Replay is the forcing function that reveals whether the abstraction holds.

### Narrow durable primitives

Prefer fewer strong primitives:

`EventEnvelope`, ledger, branch, checkpoint, runtime state, semantic graph, interrupt, policy decision, provenance record, projection, adapter conformance.

These outlive feature categories like dashboards, playgrounds, or workflow builders.

## Design constraints

These rules are **non-negotiable**. If a proposed change violates one, reject or redesign it.

### 1. Append-only ledger

Canonical execution history is append-only. Corrections, redactions, decisions, and derived observations are **new events**, not in-place edits.

| Allowed | Rejected |
|---|---|
| Correction, redaction, integrity marker events | Rewriting old payloads as normal behavior |
| Rebuilding projections from ledger | Treating snapshots as canonical state |
| | UI edits that alter history |

### 2. Deterministic replay from canonical events

Same canonical event stream → same replayed state. Uncaptured state → explicit gap marker, not silent best-effort.

| Allowed | Rejected |
|---|---|
| Checkpoints as acceleration | Replay from UI frames only |
| Explicit nondeterminism markers | Hidden framework-local memory dependencies |
| Snapshot compaction | Pretending determinism without evidence |

### 3. Branches are isolated histories with lineage

A branch has parent, fork point, inherited prefix, divergent suffix, and integrity record. Branches are not tags, filters, or UI timelines.

| Allowed | Rejected |
|---|---|
| Parent prefix up to fork sequence | Mixing branch events into parent state |
| Branch-local sequences and decisions | Forking from mutable snapshots without lineage |
| | Branch names as execution identity |

### 4. Semantic conventions are the compatibility boundary

Frameworks differ; AgentLens normalizes through versioned semantic conventions and `EventEnvelope`. The boundary is not the UI, database schema, or one adapter.

| Allowed | Rejected |
|---|---|
| Versioned semconv, extension fields | LangGraph-specific concepts in core semantics |
| Adapter conformance profiles | Projections that require adapter internals |
| | New runtime behavior from raw span attrs without protocol review |

### 5. Adapters translate; they do not own truth

Adapters emit canonical events. They are not authoritative for replay, policy, audit, or reconstruction.

| Allowed | Rejected |
|---|---|
| Adapter-specific enrichment | Adapter-specific replay engines |
| Framework span capture | Policy logic inside adapters |
| Conformance profiles | UI that only works with one adapter's private metadata |

### 6. Policy decisions are runtime events

Every meaningful allow, deny, redact, or require-review decision is durable and replayable with rule ID and version.

| Allowed | Rejected |
|---|---|
| Policy summaries as projections | Silent policy side effects |
| Policy DSL compiled to evaluators | Decisions stored only in logs |
| | Recomputing old decisions with new rules without recording original |

### 7. HITL is a state transition

Interrupt requested, decision recorded, payload supplied, execution resumed/rejected — all are transitions, not collaboration metadata.

| Allowed | Rejected |
|---|---|
| Review UI as projection | Approvals as comments only |
| Comments on decisions | Resume without a ledger event |
| Resume tokens as implementation detail | Override payloads outside ledger |

### 8. Provenance attaches to execution facts

Record actor, framework, model, tool, human, policy, trace lineage, timing, and branch when events are written.

| Allowed | Rejected |
|---|---|
| Partial provenance marked legacy | Unattributed tool calls |
| Progressive enrichment via adapters | Model decisions without provider/model when available |
| Provenance indexes | Human decisions without identity in governed environments |

### 9. UI is a projection, not authority

UI may display, query, annotate, and initiate control actions. Every displayed state must derive from ledger, checkpoints, policy records, or explicit annotations.

| Allowed | Rejected |
|---|---|
| Cached layout, preferences, filters | UI-only branch or approval state |
| | Graph mutations with no corresponding event |

### 10. Privacy before durable persistence

Redaction, encryption, minimization, and retention apply **before** data is stored durably.

| Allowed | Rejected |
|---|---|
| Metadata-only policy evaluation | Storing all prompts/tool outputs by default in prod |
| Client-side encryption, redaction markers | UI masking as security |
| Retention by event class | Privacy controls added only after ingestion |

### Review checklist

Before merging protocol, replay, or governance changes:

- [ ] Does this append to the ledger instead of mutating history?
- [ ] Can replay still reproduce state (or mark gaps)?
- [ ] Are branch boundaries preserved?
- [ ] Are new fields in semconv/protocol, not adapter-only?
- [ ] Are policy and HITL outcomes recorded as events?
- [ ] Is provenance attached at write time?
- [ ] Does UI/API expose projection, not private state?

## Planned evolution (Gen 1–4)

Our generational plan for the control plane. Milestones and scheduling are detailed in the [Roadmap](../project/roadmap.md). Current code reflects **early Gen 1** with Gen 2 work started.

### Gen 1: Canonical runtime record

**Shift:** Telemetry ingestion + UI → versioned runtime event model.

| Area | Target |
|---|---|
| Ingest | OTLP + compatibility JSON → `EventEnvelope` |
| Storage | Append-only `mission_events`, mission/branch sequences |
| Projections | Basic graph snapshots, HITL interrupts, built-in policy |
| Integrity | Hash-chain fields per branch |

**Assumptions:** Single PostgreSQL; full replay acceptable for moderate missions; Docker sandbox sufficient for branch experiments.

**Inflection:** Adapters and internal services treat EventEnvelope v1 as stable contract.

**Migration:** Freeze and document v1; backfill legacy fields where possible; mark unknown provenance explicitly; normalize all ingest paths to one envelope.

### Gen 2: Deterministic projection and branch correctness

**Shift:** Replay correctness becomes the center of the system.

| Area | Target |
|---|---|
| Replay | Versioned state schema, state hashes, determinism tests in CI |
| Branches | Lineage validation, fork rules, isolated branch events |
| Acceleration | Checkpoints; snapshot rebuild tooling |
| Diagnostics | State diff, causal query primitives |
| Quality | Adapter conformance fixtures |

**Inflection:** Same event stream → same reconstructed state across supported versions.

**Migration:** Checkpoint tables without removing event replay; golden streams in CI; version state schemas; snapshots explicitly rebuildable.

### Gen 3: Governance, security, replay fidelity

**Shift:** Observability → governed execution control.

| Area | Target |
|---|---|
| Policy | DSL over canonical events; decision events with rule versions |
| Privacy | Redaction/minimization before persistence |
| Audit | Evidence export from ledger |
| Replay | Fidelity classification; external dependency policies |
| Execution | Pluggable sandbox backend; runtime breakpoints |

**Inflection:** Trusted as governance system, not only inspection tool.

**Migration:** Privacy mode before stricter defaults; sandbox interface while keeping Docker; audit export from existing ledger fields first.

### Gen 4: Ecosystem runtime layer

**Shift:** Reference runtime semantics across frameworks.

| Area | Target |
|---|---|
| Standards | Stable semconv profiles; adapter certification |
| Scale | Distributed topology; pluggable storage/streaming |
| Interop | Audit/provenance export formats; policy/replay APIs for external platforms |

**Inflection:** Teams adopt AgentLens semantics with custom UI or storage.

**Migration:** Stable envelope; infrastructure behind interfaces; conformance profiles and migration guides; OTel alignment where possible.

### What survives framework churn

Keep investing in: runtime events, causal reconstruction, branch lineage, policy/HITL as transitions, semantic conventions, provenance, adapter conformance, replay fidelity, auditability.

Defer or reject: LangGraph-internal concepts in core, prompt-shape assumptions, provider-specific architecture, UI-paradigm coupling, Docker-as-final sandbox.

## Related docs

- [agent-api.md](../reference/agent-api.md) — Current implementation, APIs, replay algorithm
- [semconv.md](../reference/semconv.md) — Attribute and event names
- [Roadmap](../project/roadmap.md) — Milestone schedule
- [design-notes.md](design-notes.md) — Non-goals, known debt, component boundaries
