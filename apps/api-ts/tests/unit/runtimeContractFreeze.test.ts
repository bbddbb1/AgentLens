import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as protocol from '@agentlens/protocol';
import * as protocolInternal from '@agentlens/protocol/internal';
import {
  RUNTIME_EXPLANATION_VERSION,
  RuntimeEvidenceFieldConditionSchema,
  RuntimeExplanationActivityKindSchema,
  RuntimeExplanationActivityOutcomeSchema,
  RuntimeExplanationQueryV1Schema,
  RuntimeExplanationRelationBasisSchema,
  RuntimeExplanationRunOutcomeSchema,
  RuntimeExplanationUpdatedV1Schema,
  RuntimeExplanationV1Schema,
  RuntimeFactBasisSchema,
  RuntimeGovernanceAxesV1Schema,
  RuntimePhaseLabelSchema,
  RunStatusSchema,
  createRuntimeExplanationUpdatedV1,
  serializeRuntimeExplanationV1,
  type EventEnvelope,
  type RuntimeExplanationActivity,
} from '@agentlens/protocol';
import { projectReplay } from '../../src/services/runtime/projection.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../../');
const contractManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'contracts/runtime-core.freeze.json'), 'utf8'));
const semanticGoldens = JSON.parse(readFileSync(resolve(repositoryRoot, 'contracts/runtime-core.semantic-goldens.json'), 'utf8'));
const langGraphFixtures = resolve(repositoryRoot, 'packages/sdk-langgraph/tests/fixtures/otlp');
const mafFixtures = resolve(repositoryRoot, 'packages/sdk-maf/tests/fixtures/otlp');

function fixture(path: string): any[] {
  return JSON.parse(readFileSync(path, 'utf8')).spans;
}

function span(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    span_id: 'span-1',
    trace_id: 'trace-1',
    operation_name: 'execute_tool',
    start_time_unix_nano: '100',
    end_time_unix_nano: '200',
    status_code: 'UNSET',
    attributes: {
      'gen_ai.agent.id': 'agent-1',
      'gen_ai.tool.name': 'search',
      'gen_ai.tool.call.id': 'call-ended',
    },
    events: [{
      name: 'agent.tool.call',
      timestamp: '120',
      attributes: {
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.call.id': 'call-ended',
        'gen_ai.tool.status': 'active',
      },
    }],
    ...overrides,
  };
}

function explanationFor(spans: any[]) {
  const replay = projectReplay('contract-mission', 'main', spans);
  return protocolInternal.projectRuntimeExplanation({
    mission_id: replay.mission_id,
    branch_id: replay.branch_id,
    events: replay.events as EventEnvelope[],
  });
}

function semanticDigest(activity: RuntimeExplanationActivity | undefined) {
  return activity && {
    kind: activity.kind,
    status: activity.status,
    outcome: activity.outcome,
    lifecycle_basis: activity.semantic_provenance?.lifecycle.basis,
    lifecycle_condition: activity.semantic_provenance?.lifecycle.condition,
    outcome_basis: activity.semantic_provenance?.outcome.basis,
    outcome_condition: activity.semantic_provenance?.outcome.condition,
  };
}

describe('R0 frozen Runtime Core contract', () => {
  it('keeps the machine manifest synchronized with executable enums', () => {
    expect(contractManifest.status).toBe('frozen');
    expect(contractManifest.verdict).toBe('R0_REFROZEN');
    expect(contractManifest.previous_verdict).toBe('invalidated_by_adversarial_audit');
    expect(contractManifest.runtime_explanation.version).toBe(RUNTIME_EXPLANATION_VERSION);
    expect(contractManifest.frozen_semantics.activity_kinds).toEqual(RuntimeExplanationActivityKindSchema.options);
    expect(contractManifest.frozen_semantics.activity_outcomes).toEqual(RuntimeExplanationActivityOutcomeSchema.options);
    expect(contractManifest.frozen_semantics.lifecycle_and_run_outcomes).toEqual(RuntimeExplanationRunOutcomeSchema.options);
    expect(contractManifest.frozen_semantics.run_statuses).toEqual(RunStatusSchema.options);
    expect(contractManifest.frozen_semantics.runtime_phases).toEqual(RuntimePhaseLabelSchema.options);
    expect(contractManifest.frozen_semantics.relationship_bases).toEqual(RuntimeExplanationRelationBasisSchema.options);
    expect(contractManifest.frozen_semantics.provenance_bases).toEqual(RuntimeFactBasisSchema.options);
    expect(contractManifest.frozen_semantics.evidence_conditions).toEqual(RuntimeEvidenceFieldConditionSchema.options);
    for (const guard of Object.values(contractManifest.architecture_guards) as string[]) {
      if (!guard.includes('/')) continue;
      expect(existsSync(resolve(repositoryRoot, guard.split('#')[0]!)), guard).toBe(true);
    }
  });

  it('exports public schemas but keeps projection implementations on the internal subpath', () => {
    expect(protocol).toHaveProperty('RuntimeExplanationV1Schema');
    expect(protocol).not.toHaveProperty('projectRuntimeExplanation');
    expect(protocol).not.toHaveProperty('projectRuntimeSummary');
    expect(protocolInternal).toHaveProperty('projectRuntimeExplanation');
  });

  it('validates one exact frame tuple and rejects contract drift', () => {
    const explanation = serializeRuntimeExplanationV1(explanationFor([span()]));
    expect(RuntimeExplanationV1Schema.parse(JSON.parse(JSON.stringify(explanation)))).toEqual(explanation);
    expect(explanation.frame).toEqual({
      mission_id: explanation.mission_id,
      branch_id: explanation.branch_id,
      sequence_num: explanation.as_of_sequence_num,
      as_of_timestamp: explanation.as_of_timestamp,
      projection_version: RUNTIME_EXPLANATION_VERSION,
    });
    expect(explanation.activities.some((activity) =>
      activity.evidence_refs.some((ref) => ref.trace_id === 'trace-1'))).toBe(true);

    expect(RuntimeExplanationV1Schema.safeParse({ ...explanation, unexpected: true }).success).toBe(false);
    expect(RuntimeExplanationV1Schema.safeParse({
      ...explanation,
      activities: explanation.activities.map((activity, index) => index === 0
        ? { ...activity, outcome: 'plausible_but_not_frozen' }
        : activity),
    }).success).toBe(false);
    expect(RuntimeExplanationV1Schema.safeParse({
      ...explanation,
      activities: explanation.activities.map((activity, index) => {
        if (index !== 0) return activity;
        const { semantic_provenance: _, ...withoutProvenance } = activity;
        return withoutProvenance;
      }),
    }).success).toBe(false);
    expect(RuntimeExplanationV1Schema.safeParse({
      ...explanation,
      frame: { ...explanation.frame, branch_id: 'other' },
    }).success).toBe(false);
    expect(RuntimeExplanationV1Schema.safeParse({
      ...explanation,
      relations: [{
        id: 'bad', source_activity_id: 'missing', target_activity_id: explanation.activities[0]?.id,
        basis: 'parent_span', evidence_refs: [],
      }],
    }).success).toBe(false);
  });

  it('uses the same validated payload for REST serialization and realtime delivery', () => {
    const explanation = serializeRuntimeExplanationV1(explanationFor([span()]));
    const message = createRuntimeExplanationUpdatedV1({
      type: 'runtime.explanation.updated',
      mission_id: explanation.mission_id,
      branch_id: explanation.branch_id,
      projection_version: explanation.projection_version,
      runtime_explanation: explanation,
    });
    expect(RuntimeExplanationUpdatedV1Schema.parse(JSON.parse(JSON.stringify(message))).runtime_explanation)
      .toEqual(explanation);
  });

  it('rejects invalid or unsupported frame queries', () => {
    expect(RuntimeExplanationQueryV1Schema.parse({ sequence_num: '12', projection_version: RUNTIME_EXPLANATION_VERSION }))
      .toEqual({ sequence_num: 12, projection_version: RUNTIME_EXPLANATION_VERSION });
    expect(RuntimeExplanationQueryV1Schema.safeParse({ sequence_num: '-1' }).success).toBe(false);
    expect(RuntimeExplanationQueryV1Schema.safeParse({ sequence_num: '1.5' }).success).toBe(false);
    expect(RuntimeExplanationQueryV1Schema.safeParse({ projection_version: 'runtime_explanation.v2' }).success).toBe(false);
  });

  it('pins representative cross-framework lifecycle and outcome meaning', () => {
    const generic = explanationFor([span()]).activities.find((activity) => activity.kind === 'tool');
    const langGraphSuccess = explanationFor(fixture(resolve(langGraphFixtures, 'tool_success/spans.json')))
      .activities.find((activity) => activity.kind === 'tool');
    const langGraphFailure = explanationFor(fixture(resolve(langGraphFixtures, 'tool_failed/spans.json')))
      .activities.find((activity) => activity.kind === 'tool');
    const mafSparse = explanationFor(fixture(resolve(mafFixtures, 'agent_tool/captured_telemetry.json')))
      .activities.find((activity) => activity.kind === 'tool');

    expect(semanticDigest(generic)).toEqual(semanticGoldens.generic_terminal_unset);
    expect(semanticDigest(langGraphSuccess)).toEqual(semanticGoldens.langgraph_tool_success);
    expect(semanticDigest(langGraphFailure)).toEqual(semanticGoldens.langgraph_tool_failure);
    expect(semanticDigest(mafSparse)).toEqual(semanticGoldens.maf_sparse_tool);
  });

  it('keeps Governance axes independent and fail-closed', () => {
    expect(RuntimeGovernanceAxesV1Schema.parse({
      request_lifecycle: 'pending',
      decision_state: 'recorded',
      delivery_state: 'accepted',
      runtime_outcome: 'awaiting_interaction',
      actionability: 'unavailable',
      control_mode: 'unavailable',
      governance_available: false,
      supported_decision_types: [],
    })).toMatchObject({ runtime_outcome: 'awaiting_interaction' });
    expect(RuntimeGovernanceAxesV1Schema.parse({
      request_lifecycle: 'resolved',
      decision_state: 'recorded',
      delivery_state: 'accepted',
      runtime_outcome: 'failed',
      actionability: 'unavailable',
      control_mode: 'framework_binding',
      governance_available: true,
      supported_decision_types: ['approve'],
    })).toMatchObject({ delivery_state: 'accepted', runtime_outcome: 'failed' });
    expect(RuntimeGovernanceAxesV1Schema.safeParse({
      request_lifecycle: 'pending',
      decision_state: 'none',
      delivery_state: 'not_requested',
      runtime_outcome: 'awaiting_interaction',
      actionability: 'actionable',
      control_mode: 'unavailable',
      governance_available: false,
      supported_decision_types: [],
    }).success).toBe(false);
  });
});
