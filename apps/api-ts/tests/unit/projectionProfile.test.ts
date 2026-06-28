import { describe, expect, it } from 'vitest';
import {
  classifySpan,
  deriveProjectionProfile,
  projectTraceSnapshot,
} from '../../src/services/runtime/projection.js';
import type { NodeType } from '@agentlens/protocol';

/**
 * `deriveProjectionProfile` is presentation metadata (ROPS inspector dispatch
 * + field surfacing). It is a pure rule over verbatim attrs + operation_name +
 * the already-classified NodeType. These tests lock in the rules against the
 * srsran-e2e span kinds (see tests/fixtures/srsran-e2e-baseline.md) and the
 * architectural invariants: identity-first priority, and that `llm.call`
 * (which inherits `gen_ai.agent.id` → L3 `task`) is profiled `llm`, not agent.
 */
describe('deriveProjectionProfile', () => {
  function profile(
    attrs: Record<string, unknown>,
    operationName: string | undefined,
    nodeType: NodeType = 'task',
  ): string {
    return deriveProjectionProfile(attrs, operationName, nodeType);
  }

  it('profiles invoke_agent as agent (identity-first)', () => {
    expect(
      profile(
        { 'agent.span.kind': 'invoke_agent', 'gen_ai.agent.role': 'planning' },
        'invoke_agent',
        'agent',
      ),
    ).toBe('agent');
  });

  it('profiles llm.call as llm even when typed task (inherits gen_ai.agent.id)', () => {
    // BSOps llm.call spans inherit gen_ai.agent.id → L3 → NodeType='task'.
    expect(
      profile(
        {
          'gen_ai.agent.id': 'diagnosis',
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'diagnosis-v1',
          'gen_ai.usage.input_tokens': 1304,
        },
        'llm.call',
        'task',
      ),
    ).toBe('llm');
  });

  it('profiles a pure L2 LLM span (no gen_ai.agent.*) as llm', () => {
    expect(
      profile({ 'gen_ai.system': 'openai', 'gen_ai.request.model': 'gpt-4o' }, 'llm.completion', 'tool'),
    ).toBe('llm');
  });

  it('prefers agent over llm when an invoke_agent span also carries gen_ai.system', () => {
    expect(
      profile(
        { 'agent.span.kind': 'invoke_agent', 'gen_ai.system': 'openai' },
        'invoke_agent',
        'agent',
      ),
    ).toBe('agent');
  });

  it('profiles retrieval.search as retrieval (typed tool)', () => {
    expect(
      profile(
        {
          'agent.span.kind': 'execute_tool',
          'gen_ai.tool.name': 'retrieval.search',
          'retrieval.backend': 'lancedb',
          'search.query': 'CELL_OUT_OF_SERVICE root cause',
        },
        'retrieval.search',
        'tool',
      ),
    ).toBe('retrieval');
  });

  it('profiles execute_tool (non-retrieval) as tool', () => {
    expect(
      profile(
        { 'agent.span.kind': 'execute_tool', 'gen_ai.tool.name': 'logs' },
        'execute_tool',
        'tool',
      ),
    ).toBe('tool');
  });

  it('profiles workflow.step and workflow.transition as workflow_step', () => {
    expect(profile({ 'gen_ai.workflow.id': 'default-diagnosis' }, 'workflow.step', 'task')).toBe('workflow_step');
    expect(profile({ 'gen_ai.workflow.id': 'default-diagnosis' }, 'workflow.transition', 'task')).toBe('workflow_step');
  });

  it('profiles mission.execute as mission', () => {
    expect(
      profile(
        { 'basestation.aiops.mission.id': 'm1', 'basestation.aiops.alarm.id': 'a1' },
        'mission.execute',
        'task',
      ),
    ).toBe('mission');
  });

  it('does NOT profile a span as mission from basestation.aiops.mission.id alone', () => {
    // mission.id is the mission-grouping key carried by every span; it is not
    // a profile signal. A task span with only mission.id (no mission.execute
    // op, no workflow context) is generic, not mission.
    expect(profile({ 'basestation.aiops.mission.id': 'm1' }, 'some.other.op', 'task')).toBe('generic');
  });

  it('profiles runtime.checkpoint.save/load as checkpoint', () => {
    expect(profile({ 'gen_ai.workflow.id': 'wf' }, 'runtime.checkpoint.save', 'task')).toBe('checkpoint');
    expect(profile({ 'gen_ai.workflow.id': 'wf' }, 'runtime.checkpoint.load', 'task')).toBe('checkpoint');
  });

  it('profiles memory and artifact ops', () => {
    expect(profile({ 'agent.span.kind': 'memory' }, 'memory.read', 'memory')).toBe('memory');
    expect(profile({ 'agent.span.kind': 'artifact' }, 'artifact.created', 'artifact')).toBe('artifact');
  });

  it('profiles human input', () => {
    expect(profile({ 'agent.span.kind': 'agent.human.input' }, 'human.input', 'human')).toBe('human');
  });

  it('falls back to generic for unrecognized task spans', () => {
    expect(profile({ 'some.custom.attr': 'x' }, 'unknown.op', 'task')).toBe('generic');
  });
});

describe('projectTraceSnapshot sets projection_profile', () => {
  it('stamps each node with its derived profile', () => {
    const spans = [
      {
        span_id: 'agent-1',
        trace_id: 't1',
        parent_span_id: null,
        operation_name: 'invoke_agent',
        start_time_unix_nano: '1000000',
        end_time_unix_nano: '2000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'planner',
          'gen_ai.agent.name': 'planner',
          'gen_ai.agent.role': 'planning',
          'agent.span.kind': 'invoke_agent',
        },
        events: [],
      },
      {
        span_id: 'llm-1',
        trace_id: 't1',
        parent_span_id: 'agent-1',
        operation_name: 'llm.call',
        start_time_unix_nano: '1100000',
        end_time_unix_nano: '1900000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'planner',
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'diagnosis-v1',
          'gen_ai.usage.input_tokens': 10,
          'gen_ai.usage.output_tokens': 5,
        },
        events: [],
      },
      {
        span_id: 'ret-1',
        trace_id: 't1',
        parent_span_id: 'agent-1',
        operation_name: 'retrieval.search',
        start_time_unix_nano: '1200000',
        end_time_unix_nano: '1300000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'planner',
          'agent.span.kind': 'execute_tool',
          'gen_ai.tool.name': 'retrieval.search',
          'retrieval.backend': 'lancedb',
          'search.query': 'q',
        },
        events: [],
      },
    ];
    const snap = projectTraceSnapshot('m', 'main', spans);
    const byId = new Map(snap.nodes.map((n) => [n.id, n]));
    expect(byId.get('agent-1')?.projection_profile).toBe('agent');
    expect(byId.get('llm-1')?.projection_profile).toBe('llm');
    expect(byId.get('ret-1')?.projection_profile).toBe('retrieval');
  });
});

describe('deriveProjectionProfile never re-maps NodeType', () => {
  it('does not change the node type (presentation metadata only)', () => {
    // An llm.call span classifies to L3 task (inherits gen_ai.agent.id); the
    // profile is 'llm' but classifySpan still reports L3 and the snapshot keeps
    // NodeType='task'. Profile is dispatch metadata, not runtime identity.
    const span = {
      span_id: 'llm-x',
      trace_id: 't',
      parent_span_id: null,
      operation_name: 'llm.call',
      start_time_unix_nano: '1',
      end_time_unix_nano: '2',
      status_code: 'OK',
      attributes: { 'gen_ai.agent.id': 'a', 'gen_ai.system': 'openai' },
      events: [],
    };
    expect(classifySpan(span)).toBe('L3');
    const snap = projectTraceSnapshot('m', 'main', [span]);
    const node = snap.nodes.find((n) => n.id === 'llm-x');
    expect(node?.type).toBe('task');
    expect(node?.projection_profile).toBe('llm');
  });
});
