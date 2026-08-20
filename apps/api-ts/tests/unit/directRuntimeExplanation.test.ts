import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeRuntimeExplanationV1, type EventEnvelope } from '@agentlens/protocol';
import { projectRuntimeExplanation } from '@agentlens/protocol/internal';
import {
  projectReplayEvidence,
  projectRuntimeFrameEvents,
} from '../../src/services/runtime/projection.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../../');

function fixture(path: string): any[] {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')).spans;
}

function span(overrides: Record<string, unknown> = {}) {
  return {
    span_id: 'span-1',
    trace_id: 'trace-1',
    branch_id: 'main',
    admission_seq: 1,
    revision_num: 1,
    admitted_at: '2026-01-01T00:00:00.000Z',
    operation_name: 'execute_tool',
    start_time_unix_nano: '1000000000',
    end_time_unix_nano: '2000000000',
    status_code: 'UNSET',
    attributes: {
      'gen_ai.tool.name': 'search',
      'gen_ai.tool.call.id': 'call-1',
    },
    events: [],
    ...overrides,
  };
}

function explanation(events: EventEnvelope[], cutoff?: number) {
  return serializeRuntimeExplanationV1(projectRuntimeExplanation({
    mission_id: 'direct-mission',
    branch_id: 'main',
    events,
    as_of_sequence_num: cutoff,
  }));
}

function expectDirectEquivalent(spans: any[], interrupts: any[] = [], cutoff?: number) {
  const replay = projectReplayEvidence('direct-mission', 'main', spans, interrupts);
  const replayResult = explanation(replay.events as EventEnvelope[], cutoff);
  const directResult = explanation(
    projectRuntimeFrameEvents('direct-mission', 'main', spans, interrupts, cutoff),
    cutoff,
  );
  expect(directResult).toEqual(replayResult);
  return directResult;
}

describe('direct exact-frame RuntimeExplanation', () => {
  it('is contract-equivalent for generic completed, failed, and sparse evidence', () => {
    expectDirectEquivalent([span()]);
    expectDirectEquivalent([span({ status_code: 'ERROR' })]);
    expectDirectEquivalent([span({
      operation_name: 'opaque.operation',
      attributes: {},
      end_time_unix_nano: '0',
    })]);
  });

  it('is contract-equivalent for real LangGraph and MAF fixtures', () => {
    expectDirectEquivalent(fixture('packages/sdk-langgraph/tests/fixtures/otlp/tool_success/spans.json'));
    expectDirectEquivalent(fixture('packages/sdk-langgraph/tests/fixtures/otlp/tool_failed/spans.json'));
    expectDirectEquivalent(fixture('packages/sdk-maf/tests/fixtures/otlp/agent_tool/captured_telemetry.json'));
  });

  it('is contract-equivalent at historical and corrected-evidence cutoffs', () => {
    const revisionA = span({ end_time_unix_nano: '0' });
    const revisionB = span({
      admission_seq: 2,
      revision_num: 2,
      admitted_at: '2026-01-01T00:00:01.000Z',
      status_code: 'ERROR',
    });
    expectDirectEquivalent([revisionA, revisionB], [], 1);
    expectDirectEquivalent([revisionA, revisionB], [], 2);
  });

  it('is contract-equivalent for waiting and continued Governance frames', () => {
    const interrupt = {
      interrupt_id: 'interrupt-1',
      branch_id: 'main',
      reason: 'Approval required',
      created_at: '2026-01-01T00:00:00.000Z',
      requested_admission_seq: 1,
      requested_evidence: { reason: 'Approval required', payload: {} },
      governance_state_history: [
        { axis: 'request', state: 'pending', admission_seq: 1, recorded_at: '2026-01-01T00:00:00.000Z' },
        { axis: 'runtime', state: 'awaiting_interaction', admission_seq: 1, recorded_at: '2026-01-01T00:00:00.000Z' },
        { axis: 'runtime', state: 'resumed', admission_seq: 2, recorded_at: '2026-01-01T00:00:01.000Z' },
      ],
    };
    expectDirectEquivalent([], [interrupt], 1);
    expectDirectEquivalent([], [interrupt], 2);
  });

  it('materializes only the effective revision for one frame', () => {
    const revisions = Array.from({ length: 20 }, (_, index) => span({
      admission_seq: index + 1,
      revision_num: index + 1,
      admitted_at: new Date(index * 1000).toISOString(),
      end_time_unix_nano: index === 19 ? '2000000000' : '0',
    }));
    const events = projectRuntimeFrameEvents('direct-mission', 'main', revisions, [], 20);
    expect(new Set(events.map((event) => event.metadata?.evidence_revision))).toEqual(new Set([20]));
  });
});
