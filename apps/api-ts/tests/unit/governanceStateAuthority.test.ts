import { describe, expect, it } from 'vitest';
import { projectRuntimeExplanation } from '@agentlens/protocol';
import {
  governanceTransition,
  materializeGovernanceState,
  mergeGovernanceStateHistory,
} from '../../src/services/interrupts/governanceState.js';
import { mapInterruptRowToRecord } from '../../src/services/interrupts/publicSerializer.js';
import { projectReplayEvidence, projectRuntimeStateAtFrame } from '../../src/services/runtime/projection.js';

const at = (admission: number, axis: 'request' | 'decision' | 'delivery' | 'runtime', state: string) =>
  governanceTransition({
    admission_seq: admission,
    axis,
    state,
    recorded_at: `2026-08-13T00:00:0${Math.min(admission, 9)}.000Z`,
    source: axis === 'request'
      ? 'interrupt_request'
      : axis === 'decision'
        ? 'operator_decision'
        : axis === 'delivery'
          ? 'delivery_receipt'
          : 'runtime_telemetry',
  });

describe('R0-C1 governance state authority', () => {
  const history = [
    at(1, 'request', 'pending'),
    at(1, 'runtime', 'awaiting_interaction'),
    at(2, 'decision', 'recorded'),
    at(2, 'delivery', 'pending'),
    at(3, 'delivery', 'accepted'),
    at(4, 'runtime', 'resumed'),
    at(4, 'request', 'resolved'),
    at(5, 'runtime', 'failed'),
  ];

  it('keeps request, decision, delivery, and runtime outcome independent at every frame', () => {
    expect(materializeGovernanceState(history, 1)).toMatchObject({
      request_lifecycle: 'pending', decision_state: 'none', delivery_state: 'not_requested',
      runtime_outcome: 'awaiting_interaction',
    });
    expect(materializeGovernanceState(history, 2)).toMatchObject({
      request_lifecycle: 'pending', decision_state: 'recorded', delivery_state: 'pending',
      runtime_outcome: 'awaiting_interaction',
    });
    expect(materializeGovernanceState(history, 3)).toMatchObject({
      request_lifecycle: 'pending', decision_state: 'recorded', delivery_state: 'accepted',
      runtime_outcome: 'awaiting_interaction',
    });
    expect(materializeGovernanceState(history, 4)).toMatchObject({
      request_lifecycle: 'resolved', decision_state: 'recorded', delivery_state: 'accepted',
      runtime_outcome: 'resumed',
    });
    expect(materializeGovernanceState(history, 5)).toMatchObject({
      request_lifecycle: 'resolved', decision_state: 'recorded', delivery_state: 'accepted',
      runtime_outcome: 'failed',
    });
  });

  it('does not enrich earlier frames when later transitions are appended', () => {
    const before = materializeGovernanceState(history.slice(0, 4), 2);
    const after = materializeGovernanceState(history, 2);
    expect(after).toEqual(before);
  });

  it('is deterministic for duplicate and out-of-order transition delivery', () => {
    const shuffled = [history[7], history[2], history[0], history[4], history[1], history[5], history[3], history[6]];
    const merged = mergeGovernanceStateHistory([], [...shuffled, history[4]]);
    expect(materializeGovernanceState(merged, 5)).toEqual(materializeGovernanceState(history, 5));
    expect(merged).toHaveLength(history.length);
  });

  it('fails conservatively and diagnoses contradictory same-admission facts', () => {
    const conflict = [
      ...history.slice(0, 4),
      at(3, 'delivery', 'accepted'),
      at(3, 'delivery', 'failed'),
    ];
    expect(materializeGovernanceState(conflict, 3)).toMatchObject({
      delivery_state: 'unknown',
      runtime_outcome: 'awaiting_interaction',
      governance_diagnostics: ['conflicting_governance_state:delivery:3:accepted|failed'],
    });
  });

  it('creates immutable frame-local current_state for every Governance admission', () => {
    const interrupt = {
      branch_id: 'main', interrupt_id: 'irq-frame', status: 'approved', reason: 'review',
      payload: {}, requested_evidence: { interrupt_id: 'irq-frame', reason: 'review', payload: {} },
      created_at: '2026-08-13T00:00:01.000Z', requested_admission_seq: 1,
      decided_at: '2026-08-13T00:00:02.000Z', decided_admission_seq: 2,
      decision: 'approve', governance_state_history: history,
    };
    const replay = projectReplayEvidence('mission-c1', 'main', [], [interrupt]);
    expect(replay.snapshots.map((snapshot) => snapshot.sequence_num)).toEqual([1, 2, 3, 4, 5]);

    const atFrame = (sequence: number) => projectRuntimeStateAtFrame(
      'mission-c1',
      'main',
      replay.events,
      replay.snapshots.find((snapshot) => snapshot.sequence_num === sequence)!,
      [interrupt],
    ).interrupts['irq-frame'];

    expect(atFrame(1)).toMatchObject({ decision_state: 'none', delivery_state: 'not_requested', runtime_outcome: 'awaiting_interaction' });
    expect(atFrame(2)).toMatchObject({ decision_state: 'recorded', delivery_state: 'pending', runtime_outcome: 'awaiting_interaction' });
    expect(atFrame(3)).toMatchObject({ decision_state: 'recorded', delivery_state: 'accepted', runtime_outcome: 'awaiting_interaction' });
    expect(atFrame(4)).toMatchObject({ delivery_state: 'accepted', runtime_outcome: 'resumed' });
    expect(atFrame(5)).toMatchObject({ delivery_state: 'accepted', runtime_outcome: 'failed' });
    expect(atFrame(2)).toEqual(atFrame(2));

    const explanationAt = (sequence: number) => projectRuntimeExplanation({
      mission_id: 'mission-c1', branch_id: 'main', events: replay.events as any,
      as_of_sequence_num: sequence,
    });
    expect(explanationAt(3).run_outcome).toBe('waiting');
    expect(explanationAt(3).as_of_timestamp).toBe('2026-08-13T00:00:03.000Z');
    expect(explanationAt(3).activities.find((activity) => activity.id === 'human:irq-frame')?.outputs)
      .toMatchObject({ decision: 'approve' });
    expect(explanationAt(4).activities.find((activity) => activity.id === 'human:irq-frame')?.status)
      .toBe('completed');
    expect(explanationAt(5).run_outcome).toBe('failed');
    expect(explanationAt(5).activities.find((activity) => activity.id === 'human:irq-frame')?.status)
      .toBe('completed');
  });

  it('uses the revision history as public current-axis authority', () => {
    const row = {
      id: 'row-1', mission_id: 'mission-c1', branch_id: 'main', interrupt_id: 'irq-frame',
      status: 'approved', reason: 'review', payload: {}, decision: 'approve',
      request_lifecycle: 'resolved', decision_state: 'recorded', delivery_state: 'accepted',
      runtime_outcome: 'resumed', governance_state_history: [
        at(1, 'request', 'pending'), at(1, 'runtime', 'awaiting_interaction'),
        at(2, 'delivery', 'accepted'), at(2, 'delivery', 'failed'),
      ],
      created_at: '2026-08-13T00:00:01.000Z', updated_at: '2026-08-13T00:00:02.000Z',
    };
    expect(mapInterruptRowToRecord(row, { governanceEnabled: false })).toMatchObject({
      request_lifecycle: 'pending', decision_state: 'none', delivery_state: 'unknown',
      runtime_outcome: 'awaiting_interaction',
      governance_diagnostics: ['conflicting_governance_state:delivery:2:accepted|failed'],
    });
  });

  it('never projects legacy resume tokens or private control references as replay evidence', () => {
    const replay = projectReplayEvidence('mission-secret', 'main', [], [{
      branch_id: 'main', interrupt_id: 'irq-secret', status: 'pending', reason: 'review',
      payload: {},
      requested_evidence: {
        interrupt_id: 'irq-secret', reason: 'review',
        payload: {
          resume_token: 'resume-secret',
          nested: { control_ref: 'private-control', visible: 'safe' },
        },
      },
      created_at: '2026-08-13T00:00:01.000Z', requested_admission_seq: 1,
      governance_state_history: [at(1, 'request', 'pending'), at(1, 'runtime', 'awaiting_interaction')],
    }]);
    const blob = JSON.stringify(replay.events);
    expect(blob).not.toContain('resume-secret');
    expect(blob).not.toContain('private-control');
    expect(blob).toContain('safe');
  });
});
