# Runtime Story Usability Results

Status: Pending live study execution

## Current State

- The comparative 12-person usability protocol has not been recorded in this repository yet.
- Automated unit validation is passing for the runtime-story API and web contract suites.
- Manual and cohort-based study results still need to be captured using `usability-evaluation-template.md`.

## Automated Validation Recorded

- `apps/api-ts`: `node .\\node_modules\\vitest\\vitest.mjs run tests/unit/explanationProjection.test.ts tests/unit/summaryProjection.test.ts tests/unit/projection.test.ts tests/unit/routes.test.ts tests/unit/activityProjection.test.ts`
- `apps/web`: `node .\\node_modules\\vitest\\vitest.mjs run tests/unit/explanationContract.test.ts tests/unit/runtimeExplainability.test.ts tests/unit/stores.test.ts tests/unit/ropsPresentation.test.ts tests/unit/uxFidelity.test.ts tests/unit/uxFidelityAdversarial.test.ts`
- `D:\\code\\BSOps`: `node .\\node_modules\\vitest\\vitest.mjs run apps/e2e-tests/src/srsran-e2e.test.ts` with AgentLens running on `http://localhost:8001`

## External BSOps Harness Result

- Date: 2026-06-30
- Result: Passed
- Coverage: 3/3 phases passed
- Phase 1: Zero-Knowledge Diagnosis (Hard Slow Path) passed in about 10.1s
- Phase 2: Reflection & Knowledge Ingestion (Evolution) passed in about 6.3s
- Phase 3: Experience-Guided Diagnosis (Smart Slow Path) passed in about 7.8s
- Environment note: AgentLens `pnpm dev` had to be running locally so OTLP export to `http://localhost:8001/v1/traces` could succeed during the test run.

## Remaining Study Work

1. Recruit and schedule 12 participants.
2. Run the counterbalanced baseline-vs-feature protocol.
3. Record pass/fail outcomes for SC-001, SC-002, SC-007, and SC-008.
4. Summarize observed confusion points and follow-up actions.
