# R0-B1 Canonical Runtime Meaning — Working Note

## Constitutional check

PASS. The implementation remains L0 recorded evidence → private framework translation →
workload-neutral L1 facts → product projections. It does not change evidence admission,
add a persisted semantic ledger, introduce framework vocabulary in the universal projector,
or add a public protocol version or activity kind.

## Pre-change authority map (verified 2026-08-12)

| Meaning                     | Generic OTel / GenAI                                                                                | LangGraph                                                                                 | Microsoft Agent Framework                                                                                    | Conflicting production owner                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework-native identity   | `normalize.ts` reads generic span/event attributes only indirectly                                  | `langgraph.ts` translates thread/run/checkpoint/correlation fields                        | `maf.ts` translates workflow/executor/request fields                                                         | `explanationProjection.ts` independently searches public payload and causal fields for invocation identity                                                                               |
| Universal activity identity | `normalize.ts` falls back to span/event position and does not consume all documented invocation IDs | native `run_id` currently replaces universal identity before correlation                  | MAF correlation or event position; request ID remains native metadata                                        | `RuntimeExplanation` separately prefers tool/request/interrupt/workflow/artifact IDs, then span/event ID                                                                                 |
| Activity kind               | `agentLensCompat.ts` maps generic attributes/operations                                             | `normalize.ts` applies LangGraph retrieval/tool/interrupt markers                         | `normalize.ts` applies MAF request markers                                                                   | `RuntimeExplanation`, graph node typing, and projection scratch each classify payload/event vocabulary again                                                                             |
| Lifecycle/outcome           | `otelGenAi.ts` maps span status/end and explicit event evidence                                     | the same neutral mapper understands translated tool `active`/`success`/`error` attributes | span status/end plus bounded MAF enrichment; captured tool telemetry often proves completion but not success | `RuntimeExplanation` reinterprets event names/status and graph status falls back to raw span status, so an ended `UNSET` span can remain active and LangGraph success/error can collapse |
| Run identity/lifecycle      | execution-root detection and explicit lifecycle markers in API replay projection                    | native run IDs are provenance/correlation, not sufficient run-terminal evidence           | private raw MAF workflow events become explicit neutral run lifecycle metadata                               | `RuntimeExplanation` consumes the neutral run-lifecycle metadata; this remains separate from activity outcome                                                                            |
| Terminal evidence           | span end/status and explicit generic event attributes                                               | adapter-visible tool status and private lifecycle markers                                 | private raw workflow lifecycle before public name redaction, plus span end/status                            | explanation raw event switch can disagree with normalization; scratch independently mutates agent status                                                                                 |

`projectionScratch.ts` is a downstream product-state reducer. Its broad Graph/Timeline/Inspector
cleanup belongs to R0-B2, but R0-B1 must prevent it from overriding canonical activity meaning
where the canonical annotation is present.

## Implementation lane

1. Extend the existing internal normalized activity fact with invocation identity and an
   explicit identity basis. Invocation IDs are workload-neutral; framework run/thread/workflow
   IDs remain native provenance. LangGraph's adapter-provided activity correlation is translated
   to invocation identity. A MAF typed request remains partial unless separate neutral evidence
   establishes a human interaction.
2. Use the documented span fallback only when one activity of that kind is unambiguous on the
   span. Multiple same-kind event invocations without explicit identity emit an ambiguity
   diagnostic and are not merged or assigned an order-derived identity.
3. Add a process-internal, workload-neutral activity annotation to replay event objects. It
   carries only existing L1 kind, identity, lifecycle, and outcome, is excluded from serialized
   replay metadata, and is neither a persisted ledger nor a public protocol object.
4. Make `RuntimeExplanation` prefer and trust that annotation for kind, identity, lifecycle, and
   outcome. The raw classifier remains only as backward compatibility for unannotated protocol
   events; the production span-backed path always supplies the canonical annotation.
5. Make graph span status use normalized lifecycle as well as outcome. Do not broaden downstream
   causal, wording, provenance, governance, or story semantics.

## Deliberate partials

- A generic or MAF span with a recorded end and no explicit error is lifecycle `completed` while
  outcome remains `unknown` when status is `UNSET`. Completion is not promoted to business success.
- Captured MAF workflow lifecycle can support run completion/failure without inventing an
  invocation outcome for sparse executor/tool evidence.
- A MAF typed request is not universally a human activity. Native request identity remains
  provenance unless the existing neutral interrupt evidence path establishes human interaction.
- Unknown framework telemetry stays unknown and diagnostic; native IDs do not manufacture L1
  activity identity.
