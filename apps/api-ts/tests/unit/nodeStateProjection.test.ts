import { describe, expect, it } from 'vitest';
import {
  NODE_GENERATED_PROJECTION_VERSION,
  NODE_LLM_PROMPT_VERSION,
  NODE_PROJECTION_VERSION,
  isNodeProjectionCacheValid,
  projectNodeState,
  renderRuntimeEventRef,
} from '@agentlens/protocol';
import type { MissionEventRecord } from '@agentlens/protocol';

function event(
  type: string,
  payload: Record<string, unknown> = {},
  sequenceNum = 0,
): MissionEventRecord {
  return {
    id: `e-${sequenceNum}`,
    mission_id: 'm1',
    branch_id: 'main',
    sequence_num: sequenceNum,
    branch_sequence_num: sequenceNum,
    event_type: type,
    timestamp: `2026-01-01T00:00:0${sequenceNum}.000Z`,
    agent_id: typeof payload.agent_id === 'string' ? payload.agent_id : 'code_agent',
    payload,
    metadata: {},
  };
}

describe('projectNodeState (code_agent scenario)', () => {
  const events = [
    event('agent.registered', {
      agent_id: 'code_agent',
      name: 'Code Agent',
      role: 'coder',
      goal: 'Trace AST and identify patterns',
    }, 0),
    event('task.started', { agent_id: 'code_agent', task: 'AST tracing' }, 1),
    event('memory.written', {
      agent_id: 'code_agent',
      memory_key: 'finding.root_cause',
      value: { pattern: 'null deref' },
    }, 2),
    event('task.completed', { agent_id: 'code_agent', task: 'AST tracing' }, 3),
    event('delegation', { agent_id: 'code_agent', target_agent_id: 'executor_router' }, 4),
  ];

  const projection = projectNodeState({
    mission_id: 'm1',
    branch_id: 'main',
    agent_id: 'code_agent',
    events,
  });

  it('builds facts from registration goal and completion', () => {
    expect(projection).toBeDefined();
    expect(projection!.facts.role).toContain('Trace AST');
    expect(projection!.facts.status).toBe('completed');
    expect(projection!.facts.status_label).toBe('Completed');
  });

  it('records polymorphic produced_outputs with opaque memory keys', () => {
    const memoryOutput = projection!.facts.produced_outputs.find((o) => o.type === 'memory');
    expect(memoryOutput).toBeDefined();
    expect(memoryOutput!.name).toBe('finding.root_cause');
    expect(memoryOutput!.value).toEqual({ pattern: 'null deref' });
  });

  it('records next_transition to executor_router', () => {
    expect(projection!.facts.next_transition?.target).toBe('executor_router');
    expect(projection!.facts.next_transition?.kind).toBe('delegation');
  });

  it('stores structured recent_runtime_events', () => {
    expect(projection!.recent_runtime_events.length).toBeGreaterThan(0);
    expect(typeof projection!.recent_runtime_events[0].event_type).toBe('string');
    expect(typeof projection!.recent_runtime_events[0].sequence_num).toBe('number');
    expect(projection!.recent_runtime_events.every((ref) => typeof ref !== 'string')).toBe(true);
  });

  it('renders event refs to display strings', () => {
    const completedRef = projection!.recent_runtime_events.find((r) => r.event_type === 'task.completed');
    expect(completedRef).toBeDefined();
    expect(renderRuntimeEventRef(completedRef!)).toBe('completed AST tracing');
  });

  it('builds deterministic current_understanding', () => {
    const text = projection!.generated?.current_understanding ?? '';
    expect(text).toContain('completed');
    expect(text).toContain('output');
    expect(text).toContain('executor_router');
  });

  it('includes projection_version', () => {
    expect(projection!.projection_version).toBe(NODE_PROJECTION_VERSION);
    expect(projection!.generated?.projection_version).toBe(NODE_GENERATED_PROJECTION_VERSION);
  });
});

describe('node projection cache versioning', () => {
  it('rejects stale cache when projection_version mismatches', () => {
    expect(isNodeProjectionCacheValid({
      projection_version: NODE_GENERATED_PROJECTION_VERSION,
      prompt_version: NODE_LLM_PROMPT_VERSION,
    })).toBe(true);

    expect(isNodeProjectionCacheValid({
      projection_version: 999,
      prompt_version: NODE_LLM_PROMPT_VERSION,
    })).toBe(false);

    expect(isNodeProjectionCacheValid({
      projection_version: NODE_GENERATED_PROJECTION_VERSION,
      prompt_version: 'old-prompt',
    })).toBe(false);
  });
});
