# Quickstart: Coherent Runtime Execution Story

## Prerequisites

- Node.js 20+
- `pnpm` 9.15.4
- Local services needed by AgentLens when running the full stack
- Access to the golden validation corpus: one BSOps update/diagnosis run, one generic HITL multi-agent run, and one sparse/conflict-heavy non-BSOps run

## Validation Corpus

- **Corpus A - BSOps update/diagnosis**: Prefer the documented external `srsran` harness when your environment includes it. In this workspace, the documented substitutes are [apps/api-ts/tests/fixtures/runtimeStoryCorpus.ts](/D:/code/AgentLens/apps/api-ts/tests/fixtures/runtimeStoryCorpus.ts), [apps/api-ts/tests/fixtures/srsran-e2e-baseline.md](/D:/code/AgentLens/apps/api-ts/tests/fixtures/srsran-e2e-baseline.md), [apps/api-ts/tests/unit/projection.test.ts](/D:/code/AgentLens/apps/api-ts/tests/unit/projection.test.ts), and [examples/hitl_incident_response_demo.py](/D:/code/AgentLens/examples/hitl_incident_response_demo.py).
- **Corpus B - Generic HITL multi-agent**: Use a run or fixture that includes interrupt/wait, resume, artifact creation, and memory activity. The shared fixture scaffold is [apps/web/tests/fixtures/runtimeStoryFixtures.ts](/D:/code/AgentLens/apps/web/tests/fixtures/runtimeStoryFixtures.ts).
- **Corpus C - Sparse/conflict-heavy**: Use a run or fixture that includes late or out-of-order events, missing lifecycle evidence, disconnected activities, and at least one story element that must be disclosed as unavailable or incompatible in some surface.

## 1. Build the shared protocol package

```bash
pnpm --filter @agentlens/protocol build
```

## 2. Run targeted backend/runtime-story tests

```bash
node .\node_modules\vitest\vitest.mjs run tests/unit/directRuntimeExplanation.test.ts tests/unit/explanationProjection.test.ts tests/unit/summaryProjection.test.ts tests/unit/projection.test.ts tests/unit/routes.test.ts
```

These tests should confirm:

- historical frames do not inherit later outcomes
- `tool_call_id`, LLM request ID, retrieval request ID, interrupt ID, workflow step ID, and artifact ID take precedence over span or event identity
- retries and multiple activities within one span keep distinct activity identities
- redacted values never leak into the runtime explanation
- `run_status`, fixed runtime phase labels, phase basis, progress markers, disconnected regions, and conflict disclosure remain deterministic for the same frame

## 3. Run targeted web contract tests

```bash
node .\node_modules\vitest\vitest.mjs run tests/unit/explanationContract.test.ts tests/unit/runtimeExplainability.test.ts tests/unit/stores.test.ts tests/unit/ropsPresentation.test.ts tests/unit/uxFidelity.test.ts tests/unit/uxFidelityAdversarial.test.ts
```

These tests should confirm:

- summary, timeline, graph, and inspector consume the same frame payload
- missing explanation data does not get reconstructed from recorded replay events
- evidence gaps remain explicitly disclosed
- progress markers stay subordinate to the single authoritative runtime phase
- keyboard and cross-view focus behavior can be checked against the selected frame model during manual follow-up

## 4. Optional external BSOps harness

If your environment includes the external harness referenced in `docs/reference/rops.md`, you can use the provided BSOps testcase command:

```powershell
$env:LLM_BASE_URL="https://token.sensenova.cn/v1"
$env:LLM_API_KEY="<set-your-own-api-key>"
$env:LLM_MODEL="deepseek-v4-flash"
$env:OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:8001/v1/traces"
pnpm test apps/e2e-tests/src/srsran-e2e.test.ts
```

If a real key was previously embedded here, rotate or revoke it before using this workflow.

In this checkout, `apps/e2e-tests/src/srsran-e2e.test.ts` is not present, so use the documented in-repo substitutes above unless your local environment provides that external harness.

## 5. Run the app for manual validation

```bash
pnpm dev
```

If the full local stack is not available, use the team's preferred reduced local workflow instead.

## 6. Manual engineering acceptance scenarios

### Historical frame truthfulness

1. Open a run with a later success after an earlier wait or failure.
2. Move the replay/frame controls to the earlier frame.
3. Verify the summary, graph, timeline, and inspector all show the earlier state rather than the final outcome.

### Cross-view focus coherence

1. Select the same important activity from summary, timeline, graph, and inspector in turn.
2. Verify the focused activity and frame remain synchronized in every other surface.

### Status, phase, and progress-marker authority

1. Open a run with waits, fan-out, convergence, and a final outcome.
2. Verify every surface shows the same `run_status`, the same fixed workload-neutral runtime phase, and the same phase basis for the selected frame.
3. Verify any progress marker helps explain ordering or transitions without acting like a second phase authority.

### Evidence-gap honesty

1. Open a run containing missing, contradictory, or redacted evidence.
2. Verify the UI distinguishes `missing`, `recorded_empty`, `inconsistent`, `redacted`, `encrypted`, and `oversized` conditions where applicable.
3. Verify permitted evidence references or safe evidence previews remain reachable without fabricated filler text.
4. Verify no explanatory surface exposes redacted, encrypted, permission-denied, or oversized content beyond its permitted safe preview.

### Workload neutrality

1. Repeat the checks above on the BSOps golden run.
2. Repeat them on at least two non-BSOps runs.
3. Verify the same generic activity model works without requiring BSOps-specific core types.

### Accessibility and disclosure

1. Navigate the core story flow with keyboard only.
2. Verify selected activity, phase label and basis, run status, and evidence-condition labels are perceivable without relying on color alone.
3. Verify any surface incompatibility or collapsed background-work disclosure remains reachable and understandable.

## 7. Optional product-validation protocol

Run this section only if the sprint explicitly includes product-validation research.

1. Use the same three-corpus validation set and the standard eight-question comprehension prompt from [spec.md](D:/code/AgentLens/specs/001-runtime-execution-story/spec.md).
2. Compare the current feature against the pre-feature Run UI with the same 12-person cohort and counterbalanced run order.
3. Record comprehension speed and success separately from engineering acceptance so the study does not silently redefine the shipping gate.
