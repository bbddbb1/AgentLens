# R0-C1 Governance State Authority

## Authority map before remediation

| Fact | Recorded source | Current owner | Defect verified |
| --- | --- | --- | --- |
| Request lifecycle / waiting | admitted interrupt request plus normalized framework interaction evidence | interrupt aggregate and canonical Runtime projection | request admission is immutable, but later aggregate fields can be read beside an older frame |
| Decision state | operator decision and `decided_admission_seq` | interrupt aggregate | decision membership is admitted, but the immutable decision fact is not the source for all state reconstruction |
| Delivery state | bridge claim/receipt in `interrupt_delivery_attempts` | delivery lifecycle service | aggregate `delivery_state` is overwritten without an admission-keyed revision |
| Runtime outcome | normalized LangGraph/MAF terminal telemetry or explicit legacy resume | normalization plus delivery lifecycle service | aggregate `runtime_outcome` is overwritten without preserving the prior frame-local value |
| RuntimeExplanation / Summary | exact R0-A replay evidence | protocol projection | correctly owns Runtime lifecycle, but Governance aggregate state can disagree with a selected historical frame |

Framework-native vocabulary remains privately translated by the LangGraph and
MAF normalization modules. C1 does not move that vocabulary into the universal
projector.

## C1 design

The existing interrupt aggregate gains an internal, append-only
`governance_state_history` value. Each entry records one axis transition with
the mission-local R0-A evidence admission cursor that first made the transition
known. The value is an internal persistence revision mechanism, not a public
Runtime event, semantic ledger, or ontology extension.

The four axes are materialized independently at one admission cutoff:

```text
request lifecycle
decision state
delivery state
runtime outcome
```

- `interrupt.requested` records request `pending` and Runtime
  `awaiting_interaction` at the request admission.
- recording a decision records only decision `recorded`; creation of the
  delivery attempt independently records delivery `pending` at that admission.
- a bridge receipt records only its delivery transition.
- normalized, explicitly correlated Runtime telemetry records Runtime outcome;
  only terminal Runtime outcome resolves the request.
- duplicate revisions are idempotent. Conflicting same-admission revisions
  materialize conservatively with an explicit diagnostic.

Historical state and branch inheritance filter these revisions by the exact
frame/fork admission cutoff. Existing pre-C1 rows are deterministically
backfilled from their available admissions; the migration cannot recreate
unrecorded intermediate delivery states.

## Acceptance focus

Focused tests cover request-only, decision-before-delivery, accepted delivery
without continuation, explicit continuation, accepted delivery followed by
Runtime failure, frame-local reconstruction, and deterministic duplicate or
conflicting revisions.
