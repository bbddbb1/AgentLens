# Roadmap

Status: draft  
Last updated: 2026-06-11

Prioritized engineering milestones for the runtime control plane. For generational context, see [architecture.md#planned-evolution-gen-1-4](architecture.md#planned-evolution-gen-1-4).

## Priority order

Work in this order unless a dependency forces otherwise:

1. **EventEnvelope v1 + semconv** — abstraction boundary
2. **Replay determinism tests** — correctness guardrail
3. **Branch semantics + ledger integrity** — lineage and audit
4. **Policy decision events** — governance on ledger
5. **Checkpoints + adapter conformance** — scale and portability
6. **Privacy boundary + policy DSL** — production readiness
7. **Sandbox fidelity + audit export + debugging workflows** — operator value
8. **Distributed topology + ecosystem** — after semantics are stable

## Milestone index

| ID | Title | Horizon | Leverage |
|---|---|---|---|
| [S1](#s1-freeze-eventenvelope-v1) | Freeze EventEnvelope v1 | 0–3 mo | Critical |
| [S2](#s2-harden-semantic-conventions) | Harden semantic conventions | 0–3 mo | Critical |
| [S3](#s3-replay-determinism-test-suite) | Replay determinism test suite | 0–3 mo | Critical |
| [S4](#s4-ledger-integrity-verification) | Ledger integrity verification | 0–3 mo | High |
| [S5](#s5-branch-semantics-cleanup) | Branch semantics cleanup | 0–3 mo | Critical |
| [S6](#s6-policy-decision-event-model) | Policy decision event model | 0–3 mo | Critical |
| [S7](#s7-documentation-alignment) | Documentation alignment | 0–3 mo | High |
| [M1](#m1-checkpoint-architecture) | Checkpoint architecture | 3–12 mo | High |
| [M2](#m2-adapter-conformance-suite) | Adapter conformance suite | 3–12 mo | Critical |
| [M3](#m3-governance-policy-dsl-v1) | Governance policy DSL v1 | 3–12 mo | Critical |
| [M4](#m4-privacy-redaction-and-minimization-boundary) | Privacy / redaction boundary | 3–12 mo | Critical |
| [M5](#m5-branch-sandbox-fidelity) | Branch sandbox fidelity | 3–12 mo | High |
| [M6](#m6-audit-evidence-export) | Audit evidence export | 3–12 mo | High |
| [M7](#m7-operator-debugging-workflows) | Operator debugging workflows | 3–12 mo | High |
| [L1](#l1-distributed-execution-topology) | Distributed execution topology | 1–3 y | Critical |
| [L2](#l2-multi-agent-causality-and-provenance-standard) | Multi-agent causality standard | 1–3 y | Critical |
| [L3](#l3-pluggable-replay-and-sandbox-backends) | Pluggable replay/sandbox backends | 1–3 y | High |
| [L4](#l4-compliance-grade-audit-trail) | Compliance-grade audit trail | 1–3 y | High |
| [L5](#l5-runtime-verification-and-consistency-checks) | Runtime verification checks | 1–3 y | Medium–high |
| [L6](#l6-ecosystem-adapter-network) | Ecosystem adapter network | 1–3 y | High |

Each milestone includes: **objective**, **rationale** (where applicable), **dependencies**, **success criteria**, **non-goals**.

## Assumptions and risks

This roadmap assumes:

- Autonomous agent execution justifies dedicated runtime infrastructure (not just LLM trace viewers).
- Cross-framework normalization is feasible via extensible envelope + conformance levels.
- Replay and governance become adoption requirements incrementally (projection first, execution replay later).
- OpenTelemetry remains a useful ingest bridge (internal truth stays the ledger).

If agents stay short-lived and low-risk, lightweight observability may suffice — the mitigation is **profiles**: dev observability vs production governance vs compliance-grade evidence.

If frameworks diverge too much, shallow observability may be all that standardizes — keep the envelope extensible and define conformance tiers.

The highest-risk failure is **weak abstraction**: losing the runtime event boundary turns AgentLens into another dashboard. [Design constraints](architecture.md#design-constraints) exist to prevent that.

## Short term (0–3 mo) — S1–S7

Focus: freeze contracts, prove replay correctness, formalize branches and policy events. **No new UI features** unless they expose existing ledger primitives.

### S1: Freeze EventEnvelope v1

**Objective:** Document and enforce the canonical envelope for all ingestion paths.

**Rationale:** The envelope is the abstraction boundary. Without it, replay, policy, audit, and adapters drift.

**Dependencies:** `packages/protocol`, `SpanNormalizer`, `mission_events`, [semconv.md](semconv.md)

**Success criteria:**

- EventEnvelope v1 documented
- Tests validate required fields; legacy nullable fields documented
- All ingest paths produce the same envelope shape

**Non-goals:** New UI; framework-specific core concepts

### S2: Harden semantic conventions

**Objective:** Version AgentLens semantic conventions; align Python and TypeScript constants.

**Rationale:** Cross-framework compatibility requires stable names and migration paths.

**Dependencies:** [semconv.md](semconv.md), `packages/otel-semconv`, `packages/protocol/src/semconv.ts`, SDK tests

**Success criteria:**

- Required/recommended attributes per supported event
- Legacy aliases marked deprecated
- TS/Python constant compatibility tests

**Non-goals:** Broad new event categories without replay use cases

### S3: Replay determinism test suite

**Objective:** Golden event streams assert stable reconstructed state.

**Rationale:** Replay correctness must be tested, not assumed.

**Dependencies:** `EventReplayEngine`, `GraphStateBuilder`, branch fixtures

**Success criteria:**

- Golden streams cover tasks, tools, handoffs, reviews, HITL, policy, memory, artifacts, branches
- State hashes stable across runs

**Non-goals:** Full execution replay

### S4: Ledger integrity verification

**Objective:** Branch-level hash-chain verification reliable, documented, visible in API.

**Rationale:** Auditability requires tamper evidence.

**Dependencies:** Content hash creation, previous hash validation, branch sequence ordering

**Success criteria:**

- Integrity reports: valid, broken, missing, legacy-unhashed segments
- Tests cover branches independently

**Non-goals:** Cryptographic non-repudiation or distributed consensus claims

### S5: Branch semantics cleanup

**Objective:** Formalize branch creation, fork rules, inherited events, branch-local sequences.

**Rationale:** Branching is a runtime primitive; ambiguity corrupts replay.

**Dependencies:** `BranchManager`, `mission_replay_branches`, sandbox jobs, replay event selection

**Success criteria:**

- Branch invariants documented and tested
- Branch replay deterministic
- Branch-local interrupts and policy isolated from parent

**Non-goals:** Full workflow versioning system

### S6: Policy decision event model

**Objective:** Represent policy evaluation and enforcement as durable runtime events.

**Rationale:** Governance must be auditable and replayable.

**Dependencies:** `PolicyEngine`, EventEnvelope policy fields, interrupt creation

**Success criteria:**

- Allow, deny, redact, require-review recorded with rule ID, version, reason, target event

**Non-goals:** Complete policy DSL (see M3)

### S7: Documentation alignment

**Objective:** Align README, architecture docs, semconv, and roadmap around one runtime model.

**Rationale:** Mixed marketing and architecture language causes contributors to optimize for demos instead of core primitives.

**Dependencies:** Existing docs under `docs/`

**Success criteria:**

- Public docs consistently define ledger, replay, branch, policy, HITL, adapter, projection boundaries
- [docs/README.md](README.md) is the entry point

**Non-goals:** Marketing rewrite

## Medium term (3–12 mo) — M1–M7

Prerequisite: short-term milestones S1–S6 substantially complete.

### M1: Checkpoint architecture

**Objective:** Versioned replay checkpoints accelerate reconstruction without replacing events.

**Dependencies:** Replay determinism (S3), runtime state schema versioning

**Success criteria:** Replay from checkpoint + suffix matches full replay; branch-aware; corrupted checkpoints detectable and rebuildable

**Non-goals:** Checkpoints as authoritative mutable state

### M2: Adapter conformance suite

**Objective:** Golden scenarios every adapter must translate correctly.

**Dependencies:** EventEnvelope v1 (S1), semconv (S2)

**Success criteria:** LangGraph adapter passes; manual SDK path passes; future adapters self-certify

**Non-goals:** Identical raw telemetry across frameworks

### M3: Governance policy DSL v1

**Objective:** Declarative policy layer over canonical events.

**Dependencies:** Policy decision events (S6), event schemas, rule versioning

**Success criteria:** Policies match event type, actor, tool, model, payload metadata, branch, risk fields; decisions recorded as events

**Non-goals:** General workflow engine or arbitrary code execution platform

### M4: Privacy, redaction, and minimization boundary

**Objective:** Ingestion-time controls for secrets, PII, prompts, completions, tool payloads.

**Dependencies:** Payload classification, SDK config, policy engine, storage metadata

**Success criteria:** Redaction before durable persistence; redaction events auditable; metadata inspectable without raw secrets

**Non-goals:** UI masking as privacy control

### M5: Branch sandbox fidelity

**Objective:** Formalize branch execution context, external dependency policies, sandbox telemetry feedback.

**Dependencies:** Branch semantics (S5), sandbox runner, replay fidelity classification

**Success criteria:** Branch context includes fork state, injections, tool policy, selected event/node; sandbox telemetry appends only to branch

**Non-goals:** Perfect deterministic execution for arbitrary agents

### M6: Audit evidence export

**Objective:** Portable audit reports from ledger, policy, HITL, provenance, integrity.

**Dependencies:** Integrity (S4), policy events (S6), provenance fields, access control

**Success criteria:** Reports include branch lineage, hashes, policy decisions, human approvals, model/tool provenance, replay fidelity

**Non-goals:** Full GRC platform

### M7: Operator debugging workflows

**Objective:** Debugger-like workflows: state diff, causal chain, event stepping, why-this-state.

**Dependencies:** Replay determinism (S3), causal fields, state diff, semantic graph

**Success criteria:** Inspect state at sequence N; compare branches; trace policy to source events; identify missing provenance

**Non-goals:** Generic chat or prompt playground

## Long term (1–3 y) — L1–L6

Prerequisite: medium-term milestones and stable Gen 2 replay/branch semantics.

### L1: Distributed execution topology

**Objective:** Model execution across services, hosts, workers, organizations.

**Dependencies:** Causality model, OTel trace context, actor identity, branch-aware stores

**Success criteria:** Distributed handoffs, remote tools, multi-service traces, cross-process reconstruction

**Non-goals:** Becoming a distributed scheduler

### L2: Multi-agent causality and provenance standard

**Objective:** Durable semantic profile for agent runtime causality and provenance.

**Dependencies:** Production evidence, adapter conformance (M2), OTel alignment

**Success criteria:** External tools emit AgentLens-compatible events; semantics influence OTel or adjacent standards where appropriate

**Non-goals:** Standards without implementation evidence

### L3: Pluggable replay and sandbox backends

**Objective:** Docker, microVM, remote runner, simulated backends behind one branch interface.

**Dependencies:** Sandbox fidelity (M5), branch context spec, external dependency policies

**Success criteria:** Backend choice does not change event semantics; comparable branch telemetry and fidelity metadata

**Non-goals:** Binding to one isolation technology

### L4: Compliance-grade audit trail

**Objective:** Verifiable execution evidence for regulated environments.

**Dependencies:** Identity, RBAC/ABAC, retention, legal hold, integrity proofs, policy versioning

**Success criteria:** Auditors verify who/what/when/why for decisions, tool calls, policy blocks, approvals, branch divergence

**Non-goals:** Full compliance management suite

### L5: Runtime verification and consistency checks

**Objective:** Detect design constraint violations during or after execution.

**Dependencies:** Constraint language, replay state, policy DSL, causal graph

**Success criteria:** Flag impossible transitions, missing approvals, broken lineage, ungoverned dangerous tools, replay gaps

**Non-goals:** Formal verification of arbitrary LLM reasoning

### L6: Ecosystem adapter network

**Objective:** Broad adapter support via conformance profiles and stable protocol.

**Dependencies:** Adapter SDKs, conformance suite (M2), semantic versioning, docs

**Success criteria:** Multiple first- and third-party adapters pass conformance; comparable runtime records

**Non-goals:** Chasing every framework with custom core behavior

## Related docs

- [architecture.md](architecture.md) — Scope, mental model, design constraints, evolution
- [design-notes.md](design-notes.md) — Non-goals and known debt
- [semconv.md](semconv.md) — Protocol reference
