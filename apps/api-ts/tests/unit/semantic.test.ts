import { describe, expect, it, vi } from 'vitest';

// Mock Pi Coding Agent to force fallback paths
vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: () => {
    throw new Error('AI not available');
  },
  SessionManager: { inMemory: () => ({}) },
}));

import { generateMissionSummary, generateWhyThisState, type WhyThisStateContext } from '../../src/services/semantic.js';
import type { MissionAggregate } from '../../src/types/mission.js';

// -- helpers --

function makeMissionAggregate(overrides: Partial<MissionAggregate> = {}): MissionAggregate {
  return {
    mission: {
      id: 'm1',
      objective: 'Research AI safety trends',
      status: 'active',
      phase: 'executing',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T01:00:00.000Z',
      metadata: {},
      is_encrypted: false,
      visibility: 'private',
    },
    agents: [
      { agent_id: 'planner', agent_name: 'Planner', agent_role: 'planner', agent_team: 'core' },
      { agent_id: 'researcher', agent_name: 'Researcher', agent_role: 'researcher' },
    ],
    snapshots: [],
    ...overrides,
  };
}

function makeWhyThisStateCtx(overrides: Partial<WhyThisStateContext> = {}): WhyThisStateContext {
  return {
    missionObjective: 'Research AI safety trends',
    eventDescription: 'Researcher completed task Gather data',
    eventType: 'task.completed',
    phase: 'executing',
    missionStatus: 'active',
    agentStates: [
      { agent_id: 'researcher', name: 'Researcher', role: 'researcher', status: 'completed', summary: 'Collected 10 papers' },
      { agent_id: 'writer', name: 'Writer', role: 'writer', status: 'active', summary: 'Drafting report' },
      { agent_id: 'reviewer', name: 'Reviewer', role: 'reviewer', status: 'waiting', summary: 'Awaiting draft' },
    ],
    agentCount: 3,
    activeAgentCount: 1,
    pendingInterruptCount: 0,
    nodeSummary: [
      { label: 'Researcher', type: 'agent', status: 'completed' },
      { label: 'Writer', type: 'agent', status: 'active' },
      { label: 'Collect data', type: 'task', status: 'completed' },
      { label: 'Draft report', type: 'task', status: 'active' },
    ],
    edgeSummary: [
      { source: 'researcher', target: 'writer', type: 'delegation', label: 'handoff' },
    ],
    recentEvents: [
      { event_type: 'task.started', description: 'Writer started Draft report', agent: 'writer' },
      { event_type: 'task.completed', description: 'Researcher completed Gather data', agent: 'researcher' },
    ],
    ...overrides,
  };
}

// ====================================================================
// generateMissionSummary — fallback path
// ====================================================================

describe('generateMissionSummary (fallback)', () => {
  it('returns a fallback summary when AI is unavailable', async () => {
    const result = await generateMissionSummary(makeMissionAggregate());
    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(10);
    expect(Array.isArray(result.conflicts)).toBe(true);
    expect(Array.isArray(result.anomalies)).toBe(true);
  });

  it('describes a completed mission', async () => {
    const result = await generateMissionSummary(makeMissionAggregate({
      mission: {
        id: 'm1', objective: 'Test', status: 'completed', phase: 'completed',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        metadata: {}, is_encrypted: false, visibility: 'private',
      },
    }));
    expect(result.summary).toContain('completed');
  });

  it('describes a failed mission', async () => {
    const result = await generateMissionSummary(makeMissionAggregate({
      mission: {
        id: 'm1', objective: 'Test', status: 'failed', phase: 'failed',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        metadata: {}, is_encrypted: false, visibility: 'private',
      },
    }));
    expect(result.summary).toContain('failure');
  });

  it('detects escalation anomalies', async () => {
    const result = await generateMissionSummary(makeMissionAggregate({
      snapshots: [{
        id: 'snap-1', mission_id: 'm1', sequence_num: 0,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [
          { id: 'bot', type: 'agent', label: 'Bot', status: 'waiting', position: { x: 0, y: 0 } },
          { id: 'human_reviewer', type: 'human', label: 'human_reviewer', status: 'waiting', position: { x: 0, y: -150 } },
        ],
        edges: [{
          id: 'e-esc', type: 'escalation', source: 'bot', target: 'human_reviewer',
          label: 'escalates', status: 'active',
        }],
      }],
    }));

    expect(result.anomalies.some((a) => a.type === 'escalation')).toBe(true);
  });

  it('detects excessive delegation', async () => {
    const snapshots = Array.from({ length: 10 }, (_, i) => ({
      id: `snap-${i}`, mission_id: 'm1', sequence_num: i,
      timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [
        { id: 'a1', type: 'agent', label: 'A1', status: 'active', position: { x: 0, y: 0 } },
        { id: 'a2', type: 'agent', label: 'A2', status: 'active', position: { x: 250, y: 0 } },
      ],
      edges: [{
        id: `e-del-${i}`, type: 'delegation', source: 'a1', target: 'a2',
        label: 'delegates', status: 'active',
      }],
    }));

    const result = await generateMissionSummary(makeMissionAggregate({ agents: [
      { agent_id: 'a1', agent_name: 'A1', agent_role: 'worker' },
      { agent_id: 'a2', agent_name: 'A2', agent_role: 'worker' },
    ], snapshots }));

    // 10 delegations for 2 agents: 10 > 2*3 → anomaly
    expect(result.anomalies.some((a) => a.type === 'recursive_loop')).toBe(true);
  });

  it('handles empty snapshots gracefully', async () => {
    const result = await generateMissionSummary(makeMissionAggregate({ snapshots: [] }));

    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ====================================================================
// generateWhyThisState — fallback path
// ====================================================================

describe('generateWhyThisState (fallback)', () => {
  it('returns a fallback explanation when AI is unavailable', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx());

    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(10);
    expect(Array.isArray(result.conflicts)).toBe(true);
    expect(Array.isArray(result.anomalies)).toBe(true);
  });

  it('recognizes human review phase', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      phase: 'human_review',
      pendingInterruptCount: 1,
    }));

    expect(result.summary).toContain('human review');
  });

  it('mentions blocked agents', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      agentStates: [
        { agent_id: 'a1', name: 'Worker', role: 'worker', status: 'waiting' },
      ],
      edgeSummary: [
        { source: 'planner', target: 'a1', type: 'delegation', label: 'handoff' },
      ],
    }));

    expect(result.summary).toContain('blocked');
  });

  it('mentions failed agents', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      agentStates: [
        { agent_id: 'a1', name: 'BrokenBot', role: 'worker', status: 'failed' },
      ],
    }));

    expect(result.summary).toContain('BrokenBot');
    expect(result.summary).toContain('failed');
  });

  it('detects escalation edges', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      edgeSummary: [
        { source: 'bot', target: 'human_ops', type: 'escalation', label: 'escalates' },
      ],
    }));

    expect(result.summary).toContain('Escalation');
  });

  it('mentions pending human decisions', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      pendingInterruptCount: 2,
    }));

    expect(result.summary).toContain('2 human decision');
  });

  it('handles interrupt-related snapshot transition', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      eventDescription: 'Writer requested interrupt',
      recentEvents: [
        { event_type: 'task.started', description: 'Started', agent: 'writer' },
        { event_type: 'interrupt.requested', description: 'Writer requested interrupt', agent: 'writer' },
      ],
    }));

    expect(result.summary).toContain('interrupt');
  });

  it('handles review-related snapshot transition', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      eventDescription: 'Reviewer approved the draft',
      recentEvents: [
        { event_type: 'review.approved', description: 'Reviewer approved', agent: 'reviewer' },
      ],
    }));

    expect(result.summary).toContain('review');
  });

  it('handles planning phase', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      phase: 'planning',
      agentStates: [],
      activeAgentCount: 0,
      agentCount: 0,
    }));

    expect(result.summary).toContain('planning');
  });

  it('detects review feedback edges', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      edgeSummary: [
        { source: 'reviewer', target: 'writer', type: 'review', label: 'review: needs work' },
      ],
    }));

    expect(result.summary).toContain('Review');
  });

  it('handles all agents completed', async () => {
    const result = await generateWhyThisState(makeWhyThisStateCtx({
      agentStates: [
        { agent_id: 'a1', name: 'A1', role: 'worker', status: 'completed' },
        { agent_id: 'a2', name: 'A2', role: 'worker', status: 'completed' },
      ],
      activeAgentCount: 0,
    }));

    expect(result.summary).toContain('completed');
  });
});
