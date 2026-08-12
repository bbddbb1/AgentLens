# R0-A: Evidence & Frame Foundation

## Scope

This slice changes L0 evidence mechanics only. It does not add or reinterpret any
universal runtime activity, relationship, Assurance, Governance, A2A, or framework
semantics.

## Verified Current Gaps

- OTLP span timestamps are converted to JavaScript `Number` during both direct-schema
  validation and standard OTLP JSON normalization, and PostgreSQL numeric values are
  converted back to `Number` on read.
- `spans` has one mutable row per `{mission, branch, span_id}` and ingestion overwrites
  that row on conflict.
- replay cursors are hashes of derived event identity while frame prefixes are located
  by chronological array position; late earlier telemetry therefore joins an old prefix.
- the final snapshot is deliberately widened to all currently available events.
- graph snapshots are rebuilt from source-time prefixes, while explanation, summary,
  audit, current state, and branch reconstruction locate cutoffs independently.
- branch forks persist the mutable event cursor and source-local span identity is not
  scoped when parent and child lineages collide.

## Implemented Model

### Source time

OTLP nanoseconds are canonical unsigned decimal strings at the validation boundary,
in PostgreSQL `NUMERIC`, and after reads. Ordering and duration arithmetic use `BigInt`;
ISO timestamps remain millisecond presentation values only.

### Evidence admission and revision

`spans` remains the authoritative span-backed evidence store and becomes append-only.
Each stored span revision has:

- an immutable mission-wide positive 32-bit `admission_seq` allocated under the
  existing mission advisory lock;
- a positive `revision_num` scoped by `{mission_id, branch_id, span_id}`;
- its original source timestamps and complete recorded representation.

An identical re-ingest is a no-op. A changed representation for the same logical source
span appends the next revision and receives a new admission sequence. No EventEnvelope
ledger is introduced.

### Frames

Frame `N` means exactly: select lineage-admissible rows with `admission_seq <= N`, then
choose the newest admitted revision of each logical span. Derived span start, internal
event, and span end records all carry the same revision admission sequence. Source time
orders the selected frame for presentation, but never decides membership.

One graph snapshot is materialized per admitted evidence revision. Its `sequence_num`
and `source_event_sequence_num` are the exact admission cutoff. Explanation, summary,
audit/replay evidence, graph, and current state use that same cutoff without final-frame
widening or timestamp-derived expansion.

Persisted interrupt aggregates keep the request evidence captured at first admission;
later aggregate enrichment cannot rewrite that admitted request. Mutable delivery/outcome
fields are not projected backward into the already-admitted decision fact.

### Branches

`forked_from_sequence_num` stores the immutable mission admission cutoff selected on the
parent. Each ancestor is bounded by the next lineage fork cutoff; child evidence is
admitted later. Runtime span identities in a non-root branch view are lineage-qualified
from the first frame, so a later collision cannot rename earlier evidence; raw
`source_span_id` provenance is preserved.

The admission cursor domain is intentionally constrained to PostgreSQL `INTEGER`, which
is exactly representable by JavaScript and matches existing frame/branch protocol fields.
Allocation fails explicitly on exhaustion instead of silently widening the domain.

## Compatibility and Migration

The migration is additive and non-destructive: existing span rows are backfilled as
revision 1 in deterministic `{created_at, id}` order per mission, the old logical-span
uniqueness constraint is replaced with revision uniqueness, and future writes append.
Existing frame numbers were not durable admission cursors and cannot be made immutable
retroactively; frames published after migration use the new model.

## Validation Matrix

- adjacent nanosecond direct and standard-OTLP validation plus PostgreSQL round trip;
- late earlier admission leaves a captured old frame unchanged and appears in a later
  frame;
- correction A/B selects A at the old cutoff and B at the new cutoff;
- replay, explanation, summary, graph, and current state agree on one historical cutoff,
  including internal span events;
- forked parent prefix remains unchanged after later parent admission/correction and
  parent/child source span collisions remain distinguishable;
- repeated reconstruction with identical evidence, lineage, frame, and projection
  version yields equivalent deterministic runtime results.

## Constitution Check

`PASS`: raw evidence remains authoritative and span-backed; the change establishes
deterministic L0 revision/admission membership, preserves the L0 to L1 direction, adds no
L1 ontology, and makes historical and branched frame cutoffs explicit and shared.
