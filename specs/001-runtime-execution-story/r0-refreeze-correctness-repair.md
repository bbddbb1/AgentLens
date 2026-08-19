# R0 adversarial correctness repair

This note records the narrow post-freeze repair. It does not authorize new
Runtime ontology or product semantics.

## Audit disposition

| Invalidator | Disposition | Corrected authority |
|---|---|---|
| Same `span_id` in different traces became revisions | reproduced | Evidence identity is mission + branch + trace + span. Corrections retain that full tuple. |
| Same invocation id in different executions merged | reproduced | Invocation identity is scoped by branch + trace when the source-local id collides; native ids remain provenance. |
| Frame reads could straddle a commit | reproduced by inspection and lock-barrier test | One PostgreSQL `REPEATABLE READ READ ONLY` transaction owns branch, span, and Governance reconstruction. |
| Fork synthesized a lossy Governance row | reproduced | Fork persists only the immutable cutoff; lineage reconstruction truncates the authoritative ancestor history. |
| One legacy token could target multiple rows | reproduced by schema inspection | PostgreSQL owns unique non-null token hashes; historical duplicates are all invalidated, never selected. |
| Concurrent pre-interrupt bindings could both be active | reproduced | Advisory locking serializes the DB control identity and partial unique indexes enforce one active authority. |
| Expiry mutated aggregate state without history | reproduced | Expiry only removes actionability; request lifecycle is not silently mutated. |
| Generic resume decision implied Runtime continuation | reproduced | It records the decision axis only. The dedicated legacy-token endpoint is the sole documented compatibility exception. |
| Executable token entered OTLP/raw evidence | reproduced | SDK emission is removed; ingest strips compatibility credentials before persistence; historical JSON is recursively scrubbed. |

## Identity and frame model

- Exact source time remains decimal nanoseconds.
- Evidence admission remains the mission-local immutable frame cursor.
- A span revision chain is keyed by `(mission_id, branch_id, trace_id, span_id)`.
- An explicit invocation id is source-local. It remains unchanged when
  unambiguous and is deterministically scope-qualified when the same id occurs
  in multiple trace/branch scopes in one projection.
- A reconstruction uses one admission cutoff and one repeatable-read database
  snapshot. A concurrent later commit can only appear in a later reconstruction.
- Branches store a parent cutoff, not copied evidence. Parent Governance history
  is truncated at that cutoff; child-local evidence keeps its own branch scope.

## Compatibility and migration

- Existing admissions are never renumbered. Former cross-trace revision chains
  are deterministically reranked inside their correct trace partitions.
- Pre-repair synthetic child interrupt rows whose admission proves they copied
  an ancestor prefix are removed; the ancestor history remains authoritative.
- Duplicate historical legacy-token hashes are all changed to unavailable and
  cleared. No arbitrary row retains mutation authority.
- Duplicate active framework bindings are all revoked before DB uniqueness is
  installed. A runtime must register a fresh unambiguous binding.
- Historical plaintext control keys are recursively removed from interrupt,
  span, and mission JSON. Hashes remain only in control tables/columns.
- The existing `runtime_explanation.v1` contract remains the stable version.
  This repair tightens its executable outcome/provenance vocabulary and adds
  trace scope to evidence references; it adds no new universal Runtime concept.

## Permanent proof

`pnpm conformance:r0-refreeze` fails immediately unless real PostgreSQL URLs are
provided. It runs the PostgreSQL adversarial corpus, semantic/contract/
provenance/causal/Governance guards, and `conformance:fast`. CI supplies a real
PostgreSQL 16 service; required persistence tests cannot silently skip.
