import { describe, expect, it } from 'vitest';
import { describeRuntimeEvent, projectRuntimeSummary } from '@agentlens/protocol';
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
    agent_id: typeof payload.agent_id === 'string' ? payload.agent_id : 'planner',
    payload,
    metadata: {},
  };
}

describe('describeRuntimeEvent', () => {
  it('returns null for noisy span events', () => {
    expect(describeRuntimeEvent(event('span.started', {}))).toBeNull();
    expect(describeRuntimeEvent(event('span.completed', {}))).toBeNull();
  });

  it('describes tool and task events generically', () => {
    expect(describeRuntimeEvent(event('tool.called', { tool_name: 'grep', agent_id: 'researcher' }, 1))).toContain('grep');
    expect(describeRuntimeEvent(event('task.started', { task: 'Collect logs', agent_id: 'worker' }, 2))).toContain('Collect logs');
  });

  it('describes BSOps domain events after normalization', () => {
    expect(
      describeRuntimeEvent(
        event('hypothesis.proposed', { 'hypothesis.description': 'RF interference on sector 3' }, 3),
      ),
    ).toContain('RF interference');
    expect(
      describeRuntimeEvent(
        event('decision.made', { 'decision.type': 'root_cause', 'decision.summary': 'Faulty antenna' }, 4),
      ),
    ).toContain('root_cause');
  });
});

describe('projectRuntimeSummary', () => {
  it('builds progressive execution summary from events only', () => {
    const events = [
      event('agent.registered', { agent_id: 'planner', name: 'Planner', role: 'planner' }, 0),
      event('task.started', { agent_id: 'planner', task: 'Plan execution' }, 1),
      event('tool.called', { agent_id: 'planner', tool_name: 'search' }, 2),
      event('delegation', { agent_id: 'planner', target_agent_id: 'worker' }, 3),
      event('interrupt.requested', { agent_id: 'worker', reason: 'Approval needed', interrupt_id: 'int-1' }, 4),
    ];

    const summary = projectRuntimeSummary({
      mission_id: 'm1',
      branch_id: 'main',
      objective: 'Investigate incident',
      status: 'active',
      phase: 'executing',
      events,
    });

    expect(summary.progress.length).toBeGreaterThanOrEqual(4);
    expect(summary.actions.some((a) => a.text.includes('search'))).toBe(true);
    expect(summary.pending_work.some((p) => p.kind === 'interrupt')).toBe(true);
    expect(summary.requires_human).toBe(true);
    expect(summary.headline).toContain('human');
    expect(summary.narrative).toBeDefined();
    expect(summary.agents.length).toBeGreaterThanOrEqual(2);
    const planner = summary.agents.find((a) => a.agent_id === 'planner');
    expect(planner?.facts.role).toBe('planner');
    expect(planner?.recent_runtime_events.length).toBeGreaterThan(0);
  });

  it('respects up_to_sequence_num for replay scrubbing', () => {
    const events = [
      event('task.started', { task: 'Step 1' }, 0),
      event('task.completed', { task: 'Step 1' }, 1),
      event('task.started', { task: 'Step 2' }, 2),
    ];

    const partial = projectRuntimeSummary({
      mission_id: 'm1',
      branch_id: 'main',
      objective: 'Test',
      status: 'active',
      phase: 'executing',
      events,
      up_to_sequence_num: 1,
    });

    expect(partial.sequence_num).toBe(1);
    expect(partial.progress.some((p) => p.text.includes('Step 2'))).toBe(false);
  });

  it('classifies memory writes as evidence', () => {
    const events = [
      event('memory.written', { memory_key: 'findings', agent_id: 'researcher' }, 0),
    ];

    const summary = projectRuntimeSummary({
      mission_id: 'm1',
      branch_id: 'main',
      objective: 'Test',
      status: 'active',
      phase: 'executing',
      events,
    });

    expect(summary.evidence.length).toBe(1);
    expect(summary.evidence[0].source).toBe('findings');
  });

  it('surfaces failures as warnings', () => {
    const events = [
      event('task.failed', { task: 'Fetch data', agent_id: 'worker' }, 0),
    ];

    const summary = projectRuntimeSummary({
      mission_id: 'm1',
      branch_id: 'main',
      objective: 'Test',
      status: 'active',
      phase: 'executing',
      events,
    });

    expect(summary.warnings.length).toBe(1);
    expect(summary.is_blocked).toBe(true);
  });

  it('projects per-agent node state from registration goal and events', () => {
    const events = [
      event('agent.registered', { agent_id: 'executor_router', name: 'Executor Router', role: 'router', goal: 'Schedule execution nodes according to planning DAG' }, 0),
      event('task.started', { agent_id: 'executor_router', task: 'Build execution schedule' }, 1),
    ];

    const summary = projectRuntimeSummary({
      mission_id: 'm1',
      branch_id: 'main',
      objective: 'Run diagnosis',
      status: 'active',
      phase: 'executing',
      events,
    });

    const agent = summary.agents.find((a) => a.agent_id === 'executor_router');
    expect(agent).toBeDefined();
    expect(agent!.facts.role).toContain('Schedule execution nodes');
    expect(agent!.generated?.current_understanding).toContain('Executor Router');
    expect(agent!.facts.status).toBe('active');
    expect(agent!.recent_runtime_events.length).toBeGreaterThanOrEqual(2);
  });
});
