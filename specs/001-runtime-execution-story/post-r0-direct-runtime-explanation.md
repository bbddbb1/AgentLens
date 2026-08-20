# Post-R0 direct RuntimeExplanation hardening

This structural hardening preserves the executable `R0_REFROZEN` contract. It
adds no evidence, frame, activity, relationship, provenance, or Governance
semantics.

## Authority and frame behavior

The selected PostgreSQL snapshot remains the L0 authority. Branch lineage,
span revisions, and Governance rows are selected once inside the existing
`REPEATABLE READ READ ONLY` transaction. The direct path then projects only
the compatible evidence events needed by canonical normalization and
`RuntimeExplanation` at the requested admission cutoff.

Before:

```text
selected database snapshot
  -> replay evidence
  -> normalize once per admission
  -> build every historical Graph snapshot
  -> select one frame
  -> RuntimeExplanation
```

After:

```text
selected database snapshot
  -> frame-bounded compatible evidence events
  -> canonical normalization
  -> RuntimeExplanation
  -> Summary / optional Graph replay / UI
```

Replay retains its historical Graph construction for debugger consumers, but
it is not on the explanation, RuntimeSummary, or why-this-state read path.

## Consolidation boundary

- Remove dead raw-event activity and legacy Graph projectors that can assign
  activity identity, kind, lifecycle, or outcome outside canonical authority.
- RuntimeSummary remains a compatibility derivative of RuntimeExplanation.
- Graph topology remains structural/L2. Graph activity status is attached from
  the canonical explanation; a node with no uniquely representable canonical
  activity is `unknown`, never independently classified as a Runtime result.
- Framework parsing remains confined to private normalization.

## Compatibility and validation

The RuntimeExplanation wire version and frozen manifest do not change. Tests
must prove deep contract equivalence between replay-derived and direct
explanations for generic, LangGraph, MAF, historical revision, branch,
waiting, failed, completed, and sparse cases. A structural guard must prove
that the single-frame methods cannot call replay/Graph construction, and the
full R0 refreeze and release gates must remain green.

The completed proof is:

- protocol/API/web lint, typecheck, test, and production builds pass;
- the PostgreSQL-backed refreeze corpus passes without skips (120 tests);
- `conformance:fast` passes (8 manifest, 37 LangGraph, 14 MAF, 36 API, and
  20 web assertions);
- authenticated LangGraph and MAF system harnesses pass all four scenarios;
- `conformance:release` passes.
