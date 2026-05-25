import { describe, expect, it } from 'vitest';
import type { GraphSnapshot, OtlpSpan } from '@agentlens/protocol';
import { buildGraphSnapshot } from '../../src/services/graphBuilder.js';

function span(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
  return {
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    operation_name: 'test',
    start_time_unix_nano: 1_000_000_000,
    end_time_unix_nano: 2_000_000_000,
    status_code: 'OK',
    attributes: {},
    events: [],
    ...overrides,
  };
}

describe('buildGraphSnapshot', () => {
  it('returns empty snapshot for empty spans', () => {
    const snapshot = buildGraphSnapshot([], 'm1');
    expect(snapshot.mission_id).toBe('m1');
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.edges).toEqual([]);
  });

  // -- agent nodes --
  it('creates agent nodes from spans', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: {
          'agent.id': 'agent-1',
          'agent.name': 'Researcher',
          'agent.role': 'researcher',
          'agent.team': 'research-team',
          'agent.goal': 'Find relevant papers',
          'agent.confidence': '0.85',
          'agent.framework': 'langgraph',
        },
      }),
    ], 'm1');

    const agentNode = snapshot.nodes.find((n) => n.id === 'agent-1');
    expect(agentNode!.type).toBe('agent');
    expect(agentNode!.label).toBe('Researcher');
    expect(agentNode!.agent_role).toBe('researcher');
    expect(agentNode!.agent_team).toBe('research-team');
    expect(agentNode!.confidence).toBe(0.85);
    expect(agentNode!.summary).toBe('Find relevant papers');
    expect(agentNode!.metadata).toEqual({ framework: 'langgraph' });
  });

  it('defaults agent label to id when name missing', () => {
    const snapshot = buildGraphSnapshot([
      span({ attributes: { 'agent.id': 'bot-1' } }),
    ], 'm1');

    // When agent.id is provided as the label, it uses agentId as label
    expect(snapshot.nodes[0].label).toBe('bot-1');
  });

  // -- task nodes --
  it('creates task nodes and dependency edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: {
          'agent.id': 'writer',
          'agent.span.kind': 'agent.task',
          'agent.task': 'Draft the executive summary',
        },
      }),
    ], 'm1');

    const taskNodes = snapshot.nodes.filter((n) => n.type === 'task');
    expect(taskNodes).toHaveLength(1);
    expect(taskNodes[0].label).toBe('Draft the executive summary');
    expect(taskNodes[0].status).toBe('completed');

    const edge = snapshot.edges.find((e) => e.type === 'dependency');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('writer');
    expect(edge!.target).toBe(taskNodes[0].id);
  });

  it('marks task as failed on ERROR status', () => {
    const snapshot = buildGraphSnapshot([
      span({
        span_id: 'span-err',
        status_code: 'ERROR',
        attributes: {
          'agent.id': 'bot',
          'agent.span.kind': 'agent.task',
          'agent.task': 'Failed work',
        },
      }),
    ], 'm1');

    const taskNode = snapshot.nodes.find((n) => n.type === 'task');
    expect(taskNode!.status).toBe('failed');
  });

  // -- tool nodes --
  it('creates tool nodes and uses edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: {
          'agent.id': 'researcher',
          'agent.span.kind': 'agent.tool.call',
          'agent.tool.name': 'web_search',
        },
      }),
    ], 'm1');

    const toolNode = snapshot.nodes.find((n) => n.type === 'tool');
    expect(toolNode!.label).toBe('web_search');

    const edge = snapshot.edges.find((e) => e.type === 'uses');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('researcher');
    expect(edge!.animated).toBe(true);
  });

  it('deduplicates tool nodes by name', () => {
    const snapshot = buildGraphSnapshot([
      span({
        span_id: 's1',
        attributes: { 'agent.id': 'r', 'agent.span.kind': 'agent.tool.call', 'agent.tool.name': 'web_search' },
      }),
      span({
        span_id: 's2',
        attributes: { 'agent.id': 'r', 'agent.span.kind': 'agent.tool.call', 'agent.tool.name': 'web_search' },
      }),
    ], 'm1');

    const toolNodes = snapshot.nodes.filter((n) => n.type === 'tool');
    expect(toolNodes).toHaveLength(1);
  });

  // -- delegation / handoff --
  it('creates delegation edges from span events', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'planner' },
        events: [{
          name: 'agent.delegation',
          timestamp: 1_500_000_000,
          attributes: {
            'agent.delegation.target': 'researcher',
            'agent.delegation.reason': 'Gather data',
          },
        }],
      }),
    ], 'm1');

    const edge = snapshot.edges.find((e) => e.type === 'delegation');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('planner');
    expect(edge!.target).toBe('researcher');
    expect(edge!.label).toBe('delegates');
    expect(edge!.metadata).toEqual({ reason: 'Gather data' });
  });

  it('creates handoff edges with pending status', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'a' },
        events: [{
          name: 'agent.handoff.requested',
          timestamp: 1_500_000_000,
          attributes: {
            'agent.handoff.target': 'b',
            'agent.handoff.reason': 'Continue',
          },
        }],
      }),
    ], 'm1');

    const edge = snapshot.edges.find((e) => e.type === 'delegation' && e.label === 'handoff');
    expect(edge!.status).toBe('pending');
  });

  // -- critique --
  it('creates critique edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'critic' },
        events: [{
          name: 'agent.critique',
          timestamp: 1_500_000_000,
          attributes: {
            'agent.critique.target': 'writer',
            'agent.critique.result': 'Needs more evidence',
          },
        }],
      }),
    ], 'm1');

    const edge = snapshot.edges.find((e) => e.type === 'critique');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('critic');
    expect(edge!.target).toBe('writer');
    expect(edge!.label).toBe('critique: Needs more evidence');
  });

  // -- review --
  it('creates review edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'reviewer' },
        events: [{
          name: 'agent.review',
          timestamp: 1_500_000_000,
          attributes: {
            'agent.review.target': 'writer',
            'agent.review.result': 'approved',
          },
        }],
      }),
    ], 'm1');

    const edge = snapshot.edges.find((e) => e.type === 'review');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('reviewer');
    expect(edge!.label).toBe('review: approved');
  });

  // -- escalation --
  it('creates human nodes and escalation edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'bot' },
        events: [{
          name: 'agent.escalation',
          timestamp: 1_500_000_000,
          attributes: {
            'agent.escalation.target': 'human_ops',
            'agent.escalation.reason': 'Urgent issue',
          },
        }],
      }),
    ], 'm1');

    const humanNode = snapshot.nodes.find((n) => n.type === 'human');
    expect(humanNode).toBeDefined();
    expect(humanNode!.id).toBe('human_ops');
    expect(humanNode!.status).toBe('waiting');

    const edge = snapshot.edges.find((e) => e.type === 'escalation');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('bot');
    expect(edge!.target).toBe('human_ops');
    expect(edge!.animated).toBe(true);
  });

  // -- memory --
  it('creates memory nodes and data_flow edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'writer' },
        events: [{
          name: 'agent.memory.write',
          timestamp: 1_500_000_000,
          attributes: { 'agent.memory.key': 'draft_v1' },
        }],
      }),
    ], 'm1');

    const memNode = snapshot.nodes.find((n) => n.type === 'memory');
    expect(memNode).toBeDefined();
    expect(memNode!.label).toBe('draft_v1');

    const edge = snapshot.edges.find((e) => e.type === 'data_flow');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe('writer');
    expect(edge!.label).toBe('writes');
  });

  // -- artifacts --
  it('creates artifact nodes and produces edges', () => {
    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'writer' },
        events: [{
          name: 'agent.artifact.created',
          timestamp: 1_500_000_000,
          attributes: {
            'artifact.name': 'report.pdf',
            'artifact.type': 'pdf',
          },
        }],
      }),
    ], 'm1');

    const artNode = snapshot.nodes.find((n) => n.type === 'artifact');
    expect(artNode).toBeDefined();
    expect(artNode!.label).toBe('report.pdf');
    expect(artNode!.metadata).toEqual({ artifact_type: 'pdf' });

    const edge = snapshot.edges.find((e) => e.type === 'produces');
    expect(edge).toBeDefined();
  });

  // -- base snapshot --
  it('preserves nodes from a base snapshot', () => {
    const base: GraphSnapshot = {
      id: 'snap-base',
      mission_id: 'm1',
      sequence_num: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [{ id: 'existing-agent', type: 'agent', label: 'Existing', status: 'idle', position: { x: 100, y: 200 } }],
      edges: [{ id: 'existing-edge', type: 'delegation', source: 'a', target: 'b', label: 'old', status: 'completed' }],
    };

    const snapshot = buildGraphSnapshot([
      span({
        attributes: { 'agent.id': 'new-agent', 'agent.name': 'New' },
      }),
    ], 'm1', base);

    expect(snapshot.nodes.some((n) => n.id === 'existing-agent')).toBe(true);
    expect(snapshot.nodes.some((n) => n.id === 'new-agent')).toBe(true);
    expect(snapshot.edges.some((e) => e.id === 'existing-edge')).toBe(true);
  });

  it('preserves existing agent positions from base snapshot', () => {
    const base: GraphSnapshot = {
      id: 'snap-base',
      mission_id: 'm1',
      sequence_num: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [{ id: 'agent-1', type: 'agent', label: 'Old', status: 'idle', position: { x: 500, y: 100 }, agent_id: 'agent-1' }],
      edges: [],
    };

    const snapshot = buildGraphSnapshot([
      span({ attributes: { 'agent.id': 'agent-1', 'agent.name': 'Renamed' } }),
    ], 'm1', base);

    const agentNode = snapshot.nodes.find((n) => n.id === 'agent-1');
    // Agent already exists in base snapshot, label is not updated from new spans
    expect(agentNode!.label).toBe('Old');
    expect(agentNode!.position).toEqual({ x: 500, y: 100 });
  });
});
