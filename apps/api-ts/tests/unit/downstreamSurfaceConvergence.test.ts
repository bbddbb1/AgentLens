import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectRuntimeExplanation,
  projectRuntimeSummary,
  type EventEnvelope,
  type RuntimeExplanationActivity,
} from '@agentlens/protocol';
import { attachExplanationToNodes } from '../../src/services/missionStore.js';
import { projectReplay } from '../../src/services/runtime/projection.js';

const langGraphFixtures = resolve(import.meta.dirname, '../../../../packages/sdk-langgraph/tests/fixtures/otlp');
const mafFixtures = resolve(import.meta.dirname, '../../../../packages/sdk-maf/tests/fixtures/otlp');

function fixture(root: string, name: string, file: string): any[] {
  return JSON.parse(readFileSync(resolve(root, name, file), 'utf8')).spans;
}

function span(overrides: Record<string, any> = {}) {
  return {
    span_id: 'span-1',
    trace_id: 'trace-1',
    operation_name: 'execute_tool',
    start_time_unix_nano: '100',
    end_time_unix_nano: '200',
    status_code: 'UNSET',
    attributes: {
      'gen_ai.tool.name': 'search',
      'gen_ai.tool.call.id': 'call-1',
    },
    events: [],
    ...overrides,
  };
}

function surfaces(spans: any[], cutoff?: number) {
  const replay = projectReplay('surface-mission', 'main', spans);
  const sequenceNum = cutoff ?? replay.snapshots[replay.snapshots.length - 1]?.sequence_num;
  const explanation = projectRuntimeExplanation({
    mission_id: replay.mission_id,
    branch_id: replay.branch_id,
    events: replay.events as EventEnvelope[],
    as_of_sequence_num: sequenceNum,
  });
  const summary = projectRuntimeSummary({
    mission_id: replay.mission_id,
    branch_id: replay.branch_id,
    objective: 'Verify downstream convergence',
    status: 'active',
    phase: 'executing',
    events: replay.events as EventEnvelope[],
    up_to_sequence_num: sequenceNum,
  });
  const snapshot = replay.snapshots.find(candidate => candidate.sequence_num === sequenceNum)
    ?? replay.snapshots[replay.snapshots.length - 1];
  const nodes = attachExplanationToNodes(snapshot?.nodes ?? [], explanation);
  return { replay, explanation, summary, nodes };
}

function expectSameActivity(
  result: ReturnType<typeof surfaces>,
  predicate: (activity: RuntimeExplanationActivity) => boolean,
) {
  const canonical = result.explanation.activities.find(predicate);
  expect(canonical).toBeDefined();
  const summaryActivity = result.summary.activities?.find(activity => activity.id === canonical?.id);
  expect(summaryActivity).toMatchObject({
    id: canonical?.id,
    status: canonical?.status,
    outcome: canonical?.outcome,
    invocation_id: canonical?.invocation_id,
  });
  const graphNode = result.nodes.find(node => node.activity?.id === canonical?.id);
  if (graphNode) {
    expect(graphNode.activity).toMatchObject({
      id: canonical?.id,
      status: canonical?.status,
      outcome: canonical?.outcome,
      invocation_id: canonical?.invocation_id,
    });
    expect(graphNode.status).toBe(canonical?.status);
  } else {
    const degradedNode = result.nodes.find(node =>
      Array.isArray(node.metadata?.runtime_activity_ids)
      && node.metadata.runtime_activity_ids.includes(canonical?.id),
    );
    expect(degradedNode).toMatchObject({
      status: 'unknown',
      activity: undefined,
      metadata: {
        runtime_activity_representation: 'multiple_activities_not_representable',
      },
    });
  }
  return canonical;
}

describe('R0-B2a downstream surface convergence', () => {
  it('preserves generic terminal lifecycle separately from unknown outcome', () => {
    const result = surfaces([span()]);
    expect(expectSameActivity(result, activity => activity.kind === 'tool')).toMatchObject({
      status: 'completed',
      outcome: 'Unknown',
    });
  });

  it('preserves real LangGraph success and failure through Summary and Graph', () => {
    const success = surfaces(fixture(langGraphFixtures, 'tool_success', 'spans.json'));
    const failure = surfaces(fixture(langGraphFixtures, 'tool_failed', 'spans.json'));

    expect(expectSameActivity(success, activity => activity.kind === 'tool')).toMatchObject({
      status: 'completed',
      outcome: 'Success',
    });
    expect(expectSameActivity(failure, activity => activity.kind === 'tool')).toMatchObject({
      status: 'failed',
      outcome: 'Failure',
    });
  });

  it('keeps sparse real MAF tool evidence completed with unknown outcome', () => {
    const result = surfaces(fixture(mafFixtures, 'agent_tool', 'captured_telemetry.json'));
    expect(expectSameActivity(result, activity => activity.kind === 'tool')).toMatchObject({
      status: 'completed',
      outcome: 'Unknown',
    });
  });

  it('degrades shared-span multiple invocations explicitly without choosing one', () => {
    const result = surfaces([span({
      operation_name: 'agent.invoke',
      attributes: {},
      events: [
        { name: 'gen_ai.call', timestamp: '120', attributes: { 'gen_ai.request.id': 'request-a' } },
        { name: 'gen_ai.call', timestamp: '140', attributes: { 'gen_ai.request.id': 'request-b' } },
      ],
    })]);
    const llmActivities = result.explanation.activities.filter(activity => activity.kind === 'llm');
    expect(llmActivities.map(activity => activity.id)).toEqual(['llm:request-a', 'llm:request-b']);
    expect(result.summary.activities?.filter(activity => activity.kind === 'llm').map(activity => activity.id)).toEqual([
      'llm:request-a',
      'llm:request-b',
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      status: 'unknown',
      activity: undefined,
      metadata: {
        runtime_activity_representation: 'multiple_activities_not_representable',
        runtime_activity_count: 2,
        runtime_activity_ids: ['llm:request-a', 'llm:request-b'],
      },
    });
  });

  it('does not promote a terminal activity whose start was not observed into a complete history', () => {
    const result = surfaces([span({
      operation_name: 'agent.invoke',
      end_time_unix_nano: '0',
      attributes: {},
      events: [{
        name: 'tool.failed',
        timestamp: '140',
        attributes: { tool_call_id: 'terminal-only', tool_name: 'search' },
      }],
    })]);
    const activity = expectSameActivity(result, candidate => candidate.id === 'tool:terminal-only');
    expect(activity).toMatchObject({ status: 'failed', outcome: 'Failure' });
    expect(activity?.evidence_refs).toHaveLength(1);
    expect(result.explanation.consistency_flags).toContainEqual(expect.objectContaining({
      code: 'missing_start',
      activity_id: 'tool:terminal-only',
    }));
    expect(result.summary.warnings.some(warning => warning.text.includes('Start evidence is missing'))).toBe(true);
  });

  it('keeps run outcome separate from a completed child activity', () => {
    const result = surfaces([
      span({
        span_id: 'root-span',
        operation_name: 'mission.execute',
        end_time_unix_nano: '0',
        attributes: {},
      }),
      span({ span_id: 'tool-span', parent_span_id: 'root-span' }),
    ]);
    const child = result.explanation.activities.find(activity => activity.kind === 'tool');
    expect(child).toMatchObject({ status: 'completed', outcome: 'Unknown' });
    expect(result.explanation.run_outcome).not.toBe('completed');
    expect(result.summary.status).toBe(result.explanation.run_outcome);
    expect(result.summary.activities?.find(activity => activity.id === child?.id)).toMatchObject({
      status: 'completed',
      outcome: 'Unknown',
    });
  });

  it('keeps every surface on the selected historical admission cutoff', () => {
    const revisionA = span({ admission_seq: 1, revision_num: 1, end_time_unix_nano: '0' });
    const revisionB = span({
      ...revisionA,
      admission_seq: 2,
      revision_num: 2,
      end_time_unix_nano: '200',
      status_code: 'ERROR',
    });
    const historical = surfaces([revisionA, revisionB], 1);
    const current = surfaces([revisionA, revisionB], 2);

    expect(expectSameActivity(historical, activity => activity.kind === 'tool')).toMatchObject({
      status: 'active',
      outcome: 'Unknown',
    });
    expect(expectSameActivity(current, activity => activity.kind === 'tool')).toMatchObject({
      status: 'failed',
      outcome: 'Failure',
    });
  });
});
