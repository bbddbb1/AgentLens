# R0-C2 Control Enforcement

## Authority boundary

Observation does not authorize mutation. Every interrupt now persists one
internal control mode:

```text
framework_binding  -> exact current live framework binding required
legacy_token       -> explicit API-created legacy compatibility record
unavailable        -> observation only
```

Missing control metadata is `unavailable`; it is never interpreted as legacy.
Pre-C2 rows are migrated to `legacy_token` only when their immutable request
evidence proves that the legacy API created and returned a resume token.
Recognized LangGraph and Microsoft Agent Framework rows use
`framework_binding`. Unknown framework records remain observation-only.

## Enforcement

- Decision submission revalidates request lifecycle, expiry, framework feature
  availability, exact native identity, and the current live binding inside the
  decision transaction. The final SQL compare-and-set repeats those predicates.
- Claim requires the persisted authorized binding, a live binding lease, an
  actionable pending request, and an undecayed framework control mode.
- Receipt requires the exact mission, branch, interrupt, delivery, and binding
  that claimed the delivery. A receipt cannot precede a claim.
- Binding replacement may supersede an owner before a decision. Decision or
  delivery freezes the owner; registration and reconciliation cannot transfer
  it afterward, including under races.
- Resume-token mutation accepts only explicit `legacy_token` records. Known,
  unknown, or unavailable framework rows cannot fall through to token or
  sandbox compatibility mutation.
- The historical replay UI exposes no controls. Inherited parent evidence in a
  child branch is also observational; only the exact current branch's latest
  control identity can be actionable.

## Idempotency and structured responses

An idempotency key identifies the complete decision content: decision kind,
comment, and canonical payload. Exact retries return the original durable
decision. Reusing a key with different content is a conflict, and a new key
cannot overwrite a finalized decision. Realtime publication is best effort
after commit, so transport failure cannot turn durable success into a second
mutation attempt.

`structured_response` is actionable only with a bounded supported schema and a
non-empty value that validates against it. Unsupported schema vocabulary fails
closed. Current first-party telemetry provides nominal response types but no
safe value schema, so MAF/LangGraph expose only the decisions they can validate.
The current UI has no typed structured-value collector and therefore hides the
structured action even if a non-UI integration supplies a valid schema.

## Corrected legacy behavior

The removed behavior treated disabled framework control, missing replay
metadata, or an unknown framework as permission to use the legacy DB/sandbox
path. It also allowed any live same-scope LangGraph binding to claim or receipt
another request, accepted empty structured responses, and compared duplicate
decisions by label only. Those expectations contradicted fail-closed control
authority and are intentionally not preserved.
