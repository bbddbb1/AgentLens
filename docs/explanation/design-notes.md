# Design notes

Status: living document  
Last updated: 2026-06-11

Non-goals, known technical debt, and component boundaries. For design constraints and principles, see [architecture.md](architecture.md). For remediation schedule, see [roadmap.md](roadmap.md).

## Non-goals

We reject proposals that fall into these non-goals, recommending they be built as external projections instead.

### Directions we intentionally avoid

| Non-goal | Reason |
|---|---|
| Prompt playground | Optimizes experimentation, not runtime governance; crowded category |
| Chat interface as core product | Chat is a projection pattern, not the runtime abstraction |
| Low-code workflow builder | Implies owning orchestration; blurs control/data plane split |
| Generic tracing dashboard | Traces lack agent runtime state; we normalize above traces |
| AI IDE / Copilot | Different problem (code authoring vs execution evidence) |
| Vector memory as core dependency | Record memory *interactions*; don't own memory backends |
| One framework as source of truth | Value is cross-framework compatibility |
| UI graph layout as runtime truth | Layout is presentation; identity/state come from events |
| Governance in side effects | Policy and HITL must be durable events |
| Deterministic replay without fidelity classification | Overclaiming destroys trust with infra users |

### Features to defer (not never)

These may return as **projections** once ledger primitives are solid:

- Token/cost dashboards → after model provenance correctness
- Rich graph animation → after replay determinism
- Framework-specific UI affordances → after adapter conformance
- Execution replay at scale → after projection replay and fidelity markers

### Review filter

Before adding a major feature, ask:

1. Does it strengthen `EventEnvelope`, ledger, replay, branch, or policy events?
2. Can it be built as a projection without new canonical state?
3. Would it pull AgentLens toward orchestration or framework lock-in?

If all answers are no, defer.

## Known technical debt and traps

Issues to fix or avoid while evolving the runtime model.

### Dangerous shortcuts

| Shortcut | Risk | Fix |
|---|---|---|
| Graph snapshots as truth | Replay becomes UI animation | Snapshots as rebuildable cache; determinism tests |
| Unversioned JSONB payloads | Migration and query pain | Version `EventEnvelope`; index stable fields |
| Policy outside event stream | Governance not auditable | Emit evaluation/enforcement events with rule version |
| Docker sandbox = deterministic replay | Overstated branch fidelity | Fidelity classification; external dependency policies |
| Store all prompts/outputs by default | Unsafe for production | Pre-persistence redaction/minimization |

### Architectural traps

| Trap | Avoidance |
|---|---|
| Dashboard-driven development | Map major UI work to runtime primitives |
| Adapter-led semantics | Conformance suite + protocol review for new semantics |
| Competitor feature parity | Optimize replay, governance, provenance — not trace UX parity |
| LLM summaries as evidence | Summaries as projections with event citations and deterministic fallback |
| Distributed infra too early | Interfaces and constraints first; scale after semantics stabilize |

### Coupling risks

| Coupling | Fix |
|---|---|
| UI shape → runtime schema | Protocol/API independent of React components |
| PostgreSQL shape → public API | Expose runtime semantics, not table layout |
| Adapter metadata → replay | Replay-critical facts in canonical fields |
| Provider APIs → provenance model | Generic provider/model/version + extension fields |

### Scalability bottlenecks

| Bottleneck | Mitigation |
|---|---|
| Full replay from genesis | Versioned checkpoints; state hashes |
| JSONB-heavy queries | Extract/index envelope fields and event classes |
| Single-process sandbox | Pluggable runner interface; job leasing |
| WebSocket fan-out volume | Batching, projection snapshots, selective subscriptions |

### Wrong abstractions

| Avoid | Use instead |
|---|---|
| Mission graph as source of truth | Ledger + graph projection |
| Trace as complete runtime record | Trace → semantic `EventEnvelope` |
| Review as collaboration artifact | Human decision as state transition |
| Policy as alert | Policy decision event |
| Branch as snapshot copy | Event lineage with divergent suffix |

### Expected rewrites

| Component | Current state | Likely direction |
|---|---|---|
| Replay engine | MVP projection | State schema versioning, checkpoints, nondeterminism handling |
| Policy engine | Built-in rules | Declarative DSL, rule versioning, enforcement hooks |
| Sandbox runner | Docker MVP | Backend interface, remote execution, dependency simulation |
| Database migrations | `CREATE TABLE IF NOT EXISTS` | Explicit migration tooling, schema versions, backfills |
| Adapter testing | Unit tests only | Golden traces, expected events, replay assertions |

## Component boundaries

What belongs in AgentLens vs what stays in frameworks or projections.

| Capability | In AgentLens? | Notes |
|---|---|---|
| Canonical `EventEnvelope` | Yes | Core ingestion ↔ projection boundary |
| Append-only branch-aware ledger | Yes | Source of truth; trace stores lack branch semantics |
| Semantic convention versioning | Yes | Public SDK/adapter contract |
| State reconstruction from events | Yes | Beyond trace viewing |
| Branching / fork semantics | Yes | Isolated alternate histories with lineage |
| Checkpointing | Yes | Replay acceleration; must match event/branch model |
| Policy decision model | Yes | Allow/deny/redact/review as durable events |
| HITL interrupt/resume protocol | Yes | Human control is runtime semantics |
| Determinism test harness | Yes | Core correctness guardrail |
| Fidelity classification | Yes | Honest replay confidence for nondeterministic systems |
| Adapter translation layer | Yes | Cross-framework is central; adapters do not own truth |
| Semantic execution graph | Projection | Agents, tasks, tools, humans, edges — derived from ledger |
| Timeline and state diff | Projection | Requires canonical replay |
| Runtime diagnostics (loops, deadlocks) | Projection | Needs agent-specific semantics |
| Runtime policy DSL | Planned | Must bind to canonical events (see [roadmap.md](roadmap.md)) |
| Causal query engine | Projection | Agent debugging is causality over replayed state |
| Redaction / minimization boundary | Yes | Control durable payload before persistence |
| Tamper-evident integrity (hash-chain) | Yes | Audit depends on ledger integrity per branch |

## Related docs

- [architecture.md](architecture.md) — Mental model, principles, design constraints
- [roadmap.md](roadmap.md) — Milestone schedule
- [agent.md](agent.md) — Current implementation
