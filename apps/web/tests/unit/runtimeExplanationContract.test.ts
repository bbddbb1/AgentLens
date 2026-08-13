import { describe, expect, it } from 'vitest';
import {
  RUNTIME_EXPLANATION_VERSION,
  createRuntimeExplanationUpdatedV1,
  type RuntimeExplanationV1,
} from '@agentlens/protocol';
import {
  decodeRuntimeExplanationV1,
  runtimeExplanationFromRealtime,
} from '../../src/lib/runtimeExplanationContract';

function explanation(): RuntimeExplanationV1 {
  const provenance = { basis: 'unknown' as const, condition: 'not_recorded' as const, evidence_refs: [] };
  return {
    mission_id: 'm1',
    branch_id: 'main',
    as_of_sequence_num: 3,
    as_of_timestamp: '2026-08-13T00:00:03.000Z',
    projection_version: RUNTIME_EXPLANATION_VERSION,
    run_outcome: 'unknown',
    run_outcome_provenance: provenance,
    frame: {
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 3,
      as_of_timestamp: '2026-08-13T00:00:03.000Z',
      projection_version: RUNTIME_EXPLANATION_VERSION,
    },
    run_status: 'Unknown',
    run_status_provenance: provenance,
    runtime_phase: {
      id: 'phase:unknown', label: 'Unknown', basis: 'unknown', condition: 'not_recorded', evidence_refs: [],
    },
    progress_markers: [],
    selected_activity_state: { kind: 'no_activity', reason: 'no_selectable_activity' },
    run_duration_provenance: provenance,
    activities: [],
    relations: [],
    parallel_groups: [],
    merge_groups: [],
    consistency_flags: [],
  };
}

describe('RuntimeExplanation web contract decoder', () => {
  it('uses the same schema for REST and exact-frame realtime updates', () => {
    const payload = explanation();
    expect(decodeRuntimeExplanationV1(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    const message = createRuntimeExplanationUpdatedV1({
      type: 'runtime.explanation.updated',
      mission_id: 'm1',
      branch_id: 'main',
      projection_version: RUNTIME_EXPLANATION_VERSION,
      runtime_explanation: payload,
    });
    expect(runtimeExplanationFromRealtime(message, {
      missionId: 'm1', branchId: 'main', sequenceNum: 3,
    })).toEqual(payload);
  });

  it('rejects malformed, cross-mission, cross-branch, and cross-frame updates', () => {
    const payload = explanation();
    const message = createRuntimeExplanationUpdatedV1({
      type: 'runtime.explanation.updated',
      mission_id: 'm1',
      branch_id: 'main',
      projection_version: RUNTIME_EXPLANATION_VERSION,
      runtime_explanation: payload,
    });
    expect(runtimeExplanationFromRealtime(message, { missionId: 'other', branchId: 'main', sequenceNum: 3 })).toBeNull();
    expect(runtimeExplanationFromRealtime(message, { missionId: 'm1', branchId: 'child', sequenceNum: 3 })).toBeNull();
    expect(runtimeExplanationFromRealtime(message, { missionId: 'm1', branchId: 'main', sequenceNum: 2 })).toBeNull();
    expect(runtimeExplanationFromRealtime({ ...message, projection_version: 'runtime_explanation.v2' }, {
      missionId: 'm1', branchId: 'main', sequenceNum: 3,
    })).toBeNull();
  });
});
