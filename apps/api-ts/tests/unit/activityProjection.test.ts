import { describe, expect, it } from 'vitest';
import {
  projectRuntimeActivities,
  projectRuntimeActivity,
} from '@agentlens/protocol/internal';
import type { MissionEventRecord } from '@agentlens/protocol';

function event(
  sequence_num: number,
  event_type: string,
  payload: Record<string, unknown>,
  span_id = `span-${sequence_num}`,
): MissionEventRecord {
  return {
    id: `event-${sequence_num}`,
    mission_id: 'm1',
    branch_id: 'main',
    branch_sequence_num: sequence_num,
    sequence_num,
    event_type,
    timestamp: `2026-06-28T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    span_id,
    payload,
  };
}

describe('universal Runtime Activity projection', () => {
  it('derives readable identities from standard runtime evidence', () => {
    const tool = projectRuntimeActivity({
      id: 'tool-1',
      operationName: 'execute_tool',
      attributes: { 'gen_ai.tool.name': 'search_logs' },
      status: 'completed',
      durationMs: 42,
    });
    expect(tool.kind).toBe('tool');
    expect(tool.label).toBe('Tool · search_logs');
    expect(tool.action).toBe('Tool called');
    expect(tool.outcome).toBe('Completed');
    expect(tool.duration_ms).toBe(42);

    const llm = projectRuntimeActivity({
      id: 'llm-1',
      operationName: 'llm.call',
      attributes: { 'gen_ai.request.model': 'gpt-4.1' },
      status: 'completed',
    });
    expect(llm.label).toBe('LLM · gpt-4.1');
  });

  it('falls back honestly to the operation name', () => {
    const activity = projectRuntimeActivity({
      id: 'unknown-1',
      operationName: 'custom.runtime.operation',
      attributes: {},
      status: 'active',
    });
    expect(activity.kind).toBe('runtime');
    expect(activity.label).toBe('Runtime · custom.runtime.operation');
    expect(activity.subtitle).toBeUndefined();
  });

  it('keeps workload vocabulary out of the compact Core story', () => {
    const activities = projectRuntimeActivities([
      event(0, 'basestation.aiops.hypothesis.proposed', {
        operation_name: 'invoke_agent',
        'gen_ai.agent.id': 'diagnosis',
        'hypothesis.description': 'Domain diagnosis',
      }),
      event(1, 'tool.called', {
        operation_name: 'execute_tool',
        'gen_ai.tool.name': 'read_metrics',
        duration_ms: 12,
      }),
    ]);
    expect(activities).toHaveLength(1);
    expect(activities[0].label).toBe('Tool · read_metrics');
    expect(JSON.stringify(activities)).not.toContain('diagnosis');
  });

  it('combines start/terminal events deterministically and keeps failures', () => {
    const activities = projectRuntimeActivities([
      event(0, 'task.started', {
        operation_name: 'workflow.step',
        'gen_ai.workflow.step_id': 'prepare',
      }, 'workflow-1'),
      event(1, 'task.completed', {
        operation_name: 'workflow.step',
        'gen_ai.workflow.step_id': 'prepare',
      }, 'workflow-1'),
      event(2, 'tool.failed', {
        operation_name: 'execute_tool',
        'gen_ai.tool.name': 'fetch',
      }, 'tool-1'),
    ]);
    expect(activities).toHaveLength(2);
    expect(activities[0].outcome).toBe('Completed');
    expect(activities[1].status).toBe('failed');
  });
});
