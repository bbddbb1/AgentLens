<!--
Sync Impact Report
- Version change: unratified template -> 1.0.0
- Modified principles:
  - Template Principle 1 -> I. Passive Runtime Observability
  - Template Principle 2 -> II. Evidence Sovereignty and Deterministic Projection
  - Template Principle 3 -> III. Strict L0/L1/L2 Semantic Boundaries
  - Template Principle 4 -> IV. Stable Contracts and Evidence-First Evolution
  - Template Principle 5 -> V. Spec-First, Frame-Consistent Validation
- Added sections:
  - Runtime Model Invariants
  - Development and Quality Gates
- Removed sections:
  - Unnamed template constraint and workflow sections
- Templates requiring updates:
  - updated: .specify/templates/plan-template.md
  - updated: .specify/templates/spec-template.md
  - updated: .specify/templates/tasks-template.md
  - not applicable: .specify/templates/commands/ does not exist
- Runtime guidance synchronized:
  - updated: specs/001-runtime-execution-story/plan.md
  - updated: CONTRIBUTING.md
  - updated: docs/explanation/architecture.md
  - updated: packages/protocol/README.md
- Follow-up TODOs: none
-->
# AgentLens Constitution

## Core Principles

### I. Passive Runtime Observability

AgentLens MUST observe and explain recorded runtime execution; it MUST NOT act as a
workload-domain reasoning system. Core behavior MAY organize, correlate, and summarize
recorded runtime facts deterministically, but it MUST NOT invent business meaning, infer
hidden intent, or present a domain conclusion as runtime truth. Explanatory views are
projections over evidence and MUST remain subordinate to that evidence.

Rationale: Operators must be able to trust AgentLens without also trusting an opaque
reasoning process that was not part of the observed workload.

### II. Evidence Sovereignty and Deterministic Projection

Raw recorded telemetry is the source of truth. Every core fact MUST be reconstructable
from identified evidence available within the selected runtime frame. Given the same
evidence, frame, and projection version, core projection MUST produce the same meaning.
Missing, inconsistent, ambiguous, redacted, or inaccessible evidence MUST be represented
explicitly and MUST NOT be replaced with plausible values. Temporal proximity or
presentation order alone MUST NOT be promoted to causality.

Rationale: Determinism, provenance, and honest gaps make replay and debugging auditable.

### III. Strict L0/L1/L2 Semantic Boundaries

The architecture MUST preserve three one-way layers:

- **L0 - Raw evidence**: recorded telemetry and its durable evidence representation,
  including original identity, ordering, payload, provenance, integrity, and redaction
  conditions.
- **L1 - Universal runtime projection**: deterministic reconstruction of
  workload-neutral facts that are directly supported by L0 evidence.
- **L2 - Domain or framework lenses**: optional decoration, labels, and contextual views
  for a particular workload, framework, or operator audience.

Dependencies MAY flow from L0 to L1 to L2. L2 MUST NOT write back into L1 or L0, redefine
core facts, or become required for a useful core experience. Workload-specific semantics
that cannot be expressed as universal runtime facts MUST remain in L2 or be exposed as
raw evidence.

Rationale: A strict semantic firewall preserves cross-framework usefulness while still
allowing rich, opt-in domain experiences.

### IV. Stable Contracts and Evidence-First Evolution

Runtime node kinds, identity rules, lifecycle and outcome semantics, replay behavior,
frame semantics, and evidence contracts are stable by default. A feature MUST consume
existing evidence and concepts before proposing a new core field, schema, event, relation,
or node kind. Any necessary contract change MUST document the evidence gap, universal
cross-workload meaning, compatibility impact, versioning strategy, and migration path.
A single workload, framework, adapter, or UI need is not sufficient justification for a
new L1 concept.

Rationale: Stable primitives protect replay compatibility and prevent workload-specific
concepts from quietly hardening into platform truth.

### V. Spec-First, Frame-Consistent Validation

Every implementation change MUST begin with, or update, a specification that identifies
its evidence inputs, projection layer, runtime-frame behavior, contract impact, and
validation fixtures. All surfaces describing one execution moment MUST consume the same
explicit frame and MUST agree on core identity, lifecycle, outcome, topology, causality,
and provenance. Every implementation change MUST be validated against at least one
domain-specific workload and at least one structurally relevant generic or non-domain
fixture.

Rationale: Specs make semantic commitments reviewable, and cross-workload tests prevent a
golden scenario from becoming an accidental ontology.

## Runtime Model Invariants

- Core identity, lifecycle, outcome, topology, causality, provenance, and runtime-frame
  membership are L1 facts. L2 lenses MAY decorate them but MUST NOT alter, suppress,
  merge, split, or replace them.
- A historical or branched frame MUST exclude evidence outside its declared lineage and
  cutoff. Later facts MUST NOT leak backward through summaries, caches, UI state, or
  lenses.
- Every L1 claim and relationship MUST retain a stable path to its supporting L0
  evidence. If that path is unavailable, the claim MUST be weakened or omitted and the
  evidence condition disclosed.
- Projection code MUST use workload-neutral names and rules. Framework- or
  domain-specific parsing belongs in adapters or L2 lenses and MUST emit or consume
  versioned evidence contracts.
- New runtime concepts require proof that existing evidence and contracts cannot express
  a universal fact. Convenience, display preference, and one-fixture fidelity are not
  sufficient.
- AI-generated text MAY exist as an explicitly labeled L2 aid, but it MUST NOT establish,
  overwrite, or silently complete L0 evidence or L1 facts.

## Development and Quality Gates

1. **Specify**: Record user-visible behavior, L0 evidence inputs, L1/L2 ownership, frame
   semantics, compatibility impact, evidence gaps, and domain plus generic validation
   fixtures before implementation.
2. **Plan**: Complete the Constitution Check before research and repeat it after design.
   Any failed gate blocks implementation until the design is corrected or this
   constitution is amended.
3. **Task**: Include explicit work for evidence/provenance handling, deterministic and
   historical-frame tests, contract compatibility, and both required fixture classes.
4. **Implement**: Preserve frame identity end to end and keep projection behavior
   deterministic. Do not add fallback inference that changes core meaning when evidence
   is sparse.
5. **Review**: Trace each new L1 fact to recorded evidence and verify that optional
   lenses cannot mutate core semantics.
6. **Validate**: Run focused projection and contract tests plus end-to-end or fixture
   checks for a domain-specific workload and at least one generic/non-domain workload.

## Governance

This constitution is the highest-authority engineering policy for AgentLens. Specifications,
plans, tasks, code, tests, templates, and runtime guidance MUST comply. A conflict MUST be
resolved by changing the subordinate artifact or by adopting a constitutional amendment;
an implementation note or complexity waiver cannot override a principle.

Amendments require a documented proposal that states the motivation, affected principles,
compatibility and migration consequences, and required template or guidance updates.
Maintainer approval is required before merge. The amendment MUST update the Sync Impact
Report and all dependent artifacts in the same change.

Versions follow semantic versioning:

- **MAJOR** for removal or incompatible redefinition of a principle or governance rule.
- **MINOR** for a new principle, new mandatory gate, or material expansion of obligations.
- **PATCH** for non-semantic clarification, correction, or wording improvement.

Every feature plan and pull request MUST include a constitution compliance review.
Reviewers MUST reject unexplained evidence gaps, cross-frame drift, L2-to-L1 leakage, or
new core semantics lacking cross-workload justification. Compliance is re-checked whenever
design changes affect runtime evidence or contracts.

**Version**: 1.0.0 | **Ratified**: 2026-06-29 | **Last Amended**: 2026-06-29
