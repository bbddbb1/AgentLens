# R0-B2a — Downstream Surface Convergence

## Authority map before implementation

| Surface | Runtime input | Duplicate or unsafe authority |
|---|---|---|
| Summary | `RuntimeExplanation` plus compatibility mapping | compatibility mapping inferred outcome from lifecycle and discarded canonical outcome |
| Graph | span snapshot plus per-frame `RuntimeExplanation` annotation | one activity was attached by source span; multiple activities on one span were silently unrepresented while span status remained visible |
| Timeline | Summary story activities | lifecycle was canonical, but outcome was inherited from the lossy Summary compatibility mapping |
| Inspector | selected graph node or raw replay event | canonical activity selection could fall back to source span, so two invocation identities on one span could resolve to the same node meaning |
| Header/run state | selected-frame Summary | already uses run outcome independently from child activity status |

## Implementation design

The selected immutable R0-A frame remains the only evidence boundary. Within that frame,
`RuntimeExplanation` is the sole authority for activity identity, lifecycle, and outcome.
Summary copies those values. A graph node may expose an activity only when exactly one
canonical activity maps to its source span. If multiple canonical activities share that
span, the graph keeps the recorded span topology, reports an unknown aggregate status,
and records an explicit presentation limitation with the canonical activity identities.
Timeline and Inspector select canonical activity IDs; neither may invent identity from
span position or event order.

Frame and branch changes invalidate activity, event, and node focus until the new
same-frame explanation is available. Run-level status remains distinct from child
activity status.

This is a downstream convergence refactor. It adds no activity kind, relationship,
semantic convention, framework parser, persisted semantic ledger, or public protocol
version.
