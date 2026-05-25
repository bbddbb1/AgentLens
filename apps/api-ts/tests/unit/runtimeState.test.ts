import { describe, expect, it } from 'vitest';
import type { MissionEventRecord, ReplayBranch, OtlpSpan, GraphNode, GraphEdge, RuntimeAgentState, RuntimeInterruptState } from '@agentlens/protocol';
import {
  ROOT_BRANCH_ID,
  applyMissionEvent,
  buildBranchLineage,
  createDefaultBranch,
  createEmptyRuntimeState,
  createMissionEventRecord,
  normalizeSpansToMissionEvents,
  replayMissionEvents,
  selectEventsForBranch,
} from '../../src/services/runtimeState.js';

// -- helpers --

interface InternalState {
  mission_id: string;
  branch_id: string;
  status: string;
  phase: string;
  sequence_num: number;
  last_event_id?: string;
  last_event_type?: string;
  last_updated_at?: string;
  agents: Record<string, RuntimeAgentState>;
  interrupts: Record<string, RuntimeInterruptState>;
  nodeMap: Map<string, GraphNode>;
  edgeMap: Map<string, GraphEdge>;
  agentOrder: string[];
}

function createInternalState(missionId = 'm1', branchId = ROOT_BRANCH_ID, status = 'active', phase = 'planning'): InternalState {
  return {
    mission_id: missionId,
    branch_id: branchId,
    status,
    phase,
    sequence_num: -1,
    agents: {},
    interrupts: {},
    nodeMap: new Map(),
    edgeMap: new Map(),
    agentOrder: [],
  };
}

// Simulate what replayMissionEvents does: apply events with increasing sequence nums
function replayInternal(events: MissionEventRecord[], overrides: Partial<InternalState> = {}): InternalState {
  const state = { ...createInternalState(), ...overrides };
  let seq = -1;
  for (const e of events) {
    seq++;
    const event: MissionEventRecord = { ...e, sequence_num: seq, branch_sequence_num: seq };
    applyMissionEvent(state, event);
  }
  return state;
}

function event(
  type: string,
  payload: Record<string, unknown> = {},
  extra: Partial<MissionEventRecord> = {},
): MissionEventRecord {
  return {
    id: `e-${type}`,
    mission_id: 'm1',
    branch_id: ROOT_BRANCH_ID,
    sequence_num: 0,
    branch_sequence_num: 0,
    event_type: type,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload,
    metadata: {},
    ...extra,
  };
}

// ====================================================================
// applyMissionEvent — core state machine
// ====================================================================

describe('applyMissionEvent', () => {
  // ---- agent.registered ----
  describe('agent.registered', () => {
    it('creates an agent node and agent state', () => {
      const state = replayInternal([
        event('agent.registered', {
          agent_id: 'planner',
          name: 'Planner',
          role: 'planner',
          team: 'core',
          confidence: 0.9,
          summary: 'Plans the work',
          framework: 'langgraph',
        }, { agent_id: 'planner', span_id: 'span-1', trace_id: 'trace-1' }),
      ]);

      const node = state.nodeMap.get('planner');
      expect(node).toBeDefined();
      expect(node!.type).toBe('agent');
      expect(node!.label).toBe('Planner');
      expect(node!.agent_role).toBe('planner');
      expect(node!.agent_team).toBe('core');
      expect(node!.status).toBe('idle');
      expect(node!.confidence).toBe(0.9);
      expect(node!.span_id).toBe('span-1');
      expect(node!.metadata).toEqual({ framework: 'langgraph' });

      const agent = state.agents.planner;
      expect(agent.name).toBe('Planner');
      expect(agent.role).toBe('planner');
      expect(agent.team).toBe('core');
      expect(agent.status).toBe('idle');
    });

    it('defaults agent name to agent_id when name is missing', () => {
      const state = replayInternal([event('agent.registered', { agent_id: 'bot-1' }, { agent_id: 'bot-1' })]);
      expect(state.nodeMap.get('bot-1')!.label).toBe('bot-1');
      expect(state.agents['bot-1'].name).toBe('bot-1');
    });
  });

  // ---- task.started ----
  describe('task.started', () => {
    it('creates a task node and dependency edge, activates the agent', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer', role: 'writer' }, { agent_id: 'w' }),
        event('task.started', { agent_id: 'w', task: 'Draft report', task_id: 'task-1' }, { agent_id: 'w', span_id: 'span-t1' }),
      ]);

      const taskNode = state.nodeMap.get('task-1');
      expect(taskNode!.type).toBe('task');
      expect(taskNode!.label).toBe('Draft report');
      expect(taskNode!.status).toBe('active');

      const edge = state.edgeMap.get('e-w-task-1');
      expect(edge!.type).toBe('dependency');
      expect(edge!.source).toBe('w');
      expect(edge!.target).toBe('task-1');
      expect(edge!.label).toBe('executes');
      expect(edge!.status).toBe('active');

      expect(state.agents.w.status).toBe('active');
      expect(state.agents.w.current_task_id).toBe('task-1');
    });
  });

  // ---- task.completed / task.failed ----
  describe('task.completed', () => {
    it('marks the task node and dependency edge as completed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('task.started', { agent_id: 'w', task: 'Write', task_id: 'task-1' }, { agent_id: 'w' }),
        event('task.completed', { agent_id: 'w', task: 'Write', task_id: 'task-1' }, { agent_id: 'w' }),
      ]);

      expect(state.nodeMap.get('task-1')!.status).toBe('completed');
      expect(state.agents.w.status).toBe('completed');
      expect(state.edgeMap.get('e-w-task-1')!.status).toBe('completed');
    });
  });

  describe('task.failed', () => {
    it('marks agent, task node, and edge as failed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('task.started', { agent_id: 'w', task: 'Write', task_id: 'task-1' }, { agent_id: 'w' }),
        event('task.failed', { agent_id: 'w', task: 'Write', task_id: 'task-1' }, { agent_id: 'w' }),
      ]);

      expect(state.nodeMap.get('task-1')!.status).toBe('failed');
      expect(state.agents.w.status).toBe('failed');
      expect(state.edgeMap.get('e-w-task-1')!.status).toBe('failed');
    });
  });

  // ---- tool.called ----
  describe('tool.called', () => {
    it('creates a tool node and uses edge', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r', name: 'Researcher' }, { agent_id: 'r' }),
        event('tool.called', { agent_id: 'r', tool_name: 'web_search', tool_id: 'tool-s1' }, { agent_id: 'r', span_id: 'span-tc' }),
      ]);

      const toolNode = state.nodeMap.get('tool-s1');
      expect(toolNode!.type).toBe('tool');
      expect(toolNode!.label).toBe('web_search');
      expect(toolNode!.status).toBe('active');

      const edge = state.edgeMap.get('e-r-tool-s1');
      expect(edge!.type).toBe('uses');
      expect(edge!.source).toBe('r');
      expect(edge!.target).toBe('tool-s1');
      expect(edge!.label).toBe('calls');
      expect(edge!.animated).toBe(true);
      expect(state.agents.r.status).toBe('active');
    });
  });

  // ---- tool.completed / tool.failed ----
  describe('tool.completed', () => {
    it('marks tool node and edge as completed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r', name: 'Researcher' }, { agent_id: 'r' }),
        event('tool.called', { agent_id: 'r', tool_name: 'web_search', tool_id: 'tool-s1' }, { agent_id: 'r' }),
        event('tool.completed', { agent_id: 'r', tool_id: 'tool-s1' }, { agent_id: 'r' }),
      ]);

      expect(state.nodeMap.get('tool-s1')!.status).toBe('completed');
      expect(state.edgeMap.get('e-r-tool-s1')!.status).toBe('completed');
      expect(state.edgeMap.get('e-r-tool-s1')!.animated).toBe(false);
    });
  });

  describe('tool.failed', () => {
    it('marks tool node and edge as failed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r' }, { agent_id: 'r' }),
        event('tool.called', { agent_id: 'r', tool_name: 'web_search', tool_id: 'tool-s1' }, { agent_id: 'r' }),
        event('tool.failed', { agent_id: 'r', tool_id: 'tool-s1' }, { agent_id: 'r' }),
      ]);

      expect(state.nodeMap.get('tool-s1')!.status).toBe('failed');
      expect(state.edgeMap.get('e-r-tool-s1')!.status).toBe('failed');
    });
  });

  // ---- delegation ----
  describe('delegation', () => {
    it('creates delegation edge between agents', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'planner', name: 'Planner' }, { agent_id: 'planner' }),
        event('agent.registered', { agent_id: 'researcher', name: 'Researcher' }, { agent_id: 'researcher' }),
        event('delegation', {
          agent_id: 'planner',
          target_agent_id: 'researcher',
          reason: 'Gather data',
        }, { agent_id: 'planner' }),
      ]);

      const edge = state.edgeMap.get('e-del-planner-researcher');
      expect(edge!.type).toBe('delegation');
      expect(edge!.source).toBe('planner');
      expect(edge!.target).toBe('researcher');
      expect(edge!.label).toBe('delegates');
      expect(edge!.status).toBe('active');
      expect(edge!.metadata).toEqual({ reason: 'Gather data' });
    });
  });

  // ---- handoff.requested ----
  describe('handoff.requested', () => {
    it('sets edge status to pending', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a', name: 'A' }, { agent_id: 'a' }),
        event('agent.registered', { agent_id: 'b', name: 'B' }, { agent_id: 'b' }),
        event('handoff.requested', { agent_id: 'a', target_agent_id: 'b', reason: 'Continue' }, { agent_id: 'a' }),
      ]);

      const edge = state.edgeMap.get('e-del-a-b');
      expect(edge!.status).toBe('pending');
      expect(edge!.label).toBe('handoff');
      expect(edge!.animated).toBe(true);
    });

    it('sets target agent to waiting', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a', name: 'A' }, { agent_id: 'a' }),
        event('agent.registered', { agent_id: 'b', name: 'B' }, { agent_id: 'b' }),
        event('handoff.requested', { agent_id: 'a', target_agent_id: 'b', reason: 'y' }, { agent_id: 'a' }),
      ]);
      expect(state.agents.b.status).toBe('waiting');
    });
  });

  // ---- handoff.accepted ----
  describe('handoff.accepted', () => {
    it('sets edge to completed and activates target agent', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a', name: 'A' }, { agent_id: 'a' }),
        event('agent.registered', { agent_id: 'b', name: 'B' }, { agent_id: 'b' }),
        event('handoff.requested', { agent_id: 'a', target_agent_id: 'b', reason: 'y' }, { agent_id: 'a' }),
        event('handoff.accepted', { agent_id: 'a', target_agent_id: 'b', reason: 'y' }, { agent_id: 'a' }),
      ]);

      expect(state.edgeMap.get('e-del-a-b')!.status).toBe('completed');
      expect(state.agents.b.status).toBe('active');
    });
  });

  // ---- handoff.rejected ----
  describe('handoff.rejected', () => {
    it('sets edge to failed and target agent to failed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a', name: 'A' }, { agent_id: 'a' }),
        event('agent.registered', { agent_id: 'b', name: 'B' }, { agent_id: 'b' }),
        event('handoff.requested', { agent_id: 'a', target_agent_id: 'b', reason: 'y' }, { agent_id: 'a' }),
        event('handoff.rejected', { agent_id: 'a', target_agent_id: 'b', reason: 'y' }, { agent_id: 'a' }),
      ]);

      expect(state.edgeMap.get('e-del-a-b')!.status).toBe('failed');
      expect(state.agents.b.status).toBe('failed');
    });
  });

  // ---- critique ----
  describe('critique', () => {
    it('creates a critique edge and sets reviewing status', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'critic', name: 'Critic' }, { agent_id: 'critic' }),
        event('agent.registered', { agent_id: 'writer', name: 'Writer' }, { agent_id: 'writer' }),
        event('critique', {
          agent_id: 'critic',
          target_agent_id: 'writer',
          result: 'coverage gaps',
        }, { agent_id: 'critic' }),
      ]);

      const edge = state.edgeMap.get('e-crit-critic-writer');
      expect(edge!.type).toBe('critique');
      expect(edge!.label).toBe('critique: coverage gaps');
      expect(state.agents.critic.status).toBe('reviewing');
      expect(state.agents.writer.status).toBe('active');
    });
  });

  // ---- review.started ----
  describe('review.started', () => {
    it('creates review edge', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r1', name: 'Reviewer' }, { agent_id: 'r1' }),
        event('agent.registered', { agent_id: 'w1', name: 'Writer' }, { agent_id: 'w1' }),
        event('review.started', { agent_id: 'r1', target_agent_id: 'w1', result: 'started' }, { agent_id: 'r1' }),
      ]);

      const edge = state.edgeMap.get('e-rev-r1-w1');
      expect(edge!.type).toBe('review');
      expect(edge!.label).toBe('review: started');
      expect(state.agents.r1.status).toBe('reviewing');
    });
  });

  // ---- review.approved ----
  describe('review.approved', () => {
    it('sets target agent to completed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r1', name: 'Reviewer' }, { agent_id: 'r1' }),
        event('agent.registered', { agent_id: 'w1', name: 'Writer' }, { agent_id: 'w1' }),
        event('review.started', { agent_id: 'r1', target_agent_id: 'w1' }, { agent_id: 'r1' }),
        event('review.approved', { agent_id: 'r1', target_agent_id: 'w1', result: 'approved' }, { agent_id: 'r1' }),
      ]);

      const edge = state.edgeMap.get('e-rev-r1-w1');
      expect(edge!.status).toBe('completed');
      expect(state.agents.w1.status).toBe('completed');
    });
  });

  // ---- review.rejected ----
  describe('review.rejected', () => {
    it('sets edge to failed and target agent to active for rework', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r1', name: 'Reviewer' }, { agent_id: 'r1' }),
        event('agent.registered', { agent_id: 'w1', name: 'Writer' }, { agent_id: 'w1' }),
        event('review.started', { agent_id: 'r1', target_agent_id: 'w1' }, { agent_id: 'r1' }),
        event('review.rejected', { agent_id: 'r1', target_agent_id: 'w1', result: 'rejected' }, { agent_id: 'r1' }),
      ]);

      expect(state.edgeMap.get('e-rev-r1-w1')!.status).toBe('failed');
      expect(state.agents.w1.status).toBe('active');
    });
  });

  // ---- review.changes_requested ----
  describe('review.changes_requested', () => {
    it('keeps target agent active for revisions', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'r1', name: 'Reviewer' }, { agent_id: 'r1' }),
        event('agent.registered', { agent_id: 'w1', name: 'Writer' }, { agent_id: 'w1' }),
        event('review.started', { agent_id: 'r1', target_agent_id: 'w1' }, { agent_id: 'r1' }),
        event('review.changes_requested', { agent_id: 'r1', target_agent_id: 'w1', result: 'revisions needed' }, { agent_id: 'r1' }),
      ]);

      expect(state.agents.w1.status).toBe('active');
    });
  });

  // ---- escalation ----
  describe('escalation', () => {
    it('creates a human node and escalation edge, sets agent to waiting', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'bot', name: 'Bot' }, { agent_id: 'bot' }),
        event('escalation', { agent_id: 'bot', target: 'human_reviewer', reason: 'Critical issue' }, { agent_id: 'bot' }),
      ]);

      const humanNode = state.nodeMap.get('human_reviewer');
      expect(humanNode!.type).toBe('human');
      expect(humanNode!.status).toBe('waiting');

      const edge = state.edgeMap.get('e-esc-bot-human_reviewer');
      expect(edge!.type).toBe('escalation');
      expect(edge!.label).toBe('escalates');
      expect(edge!.metadata).toEqual({ reason: 'Critical issue' });

      expect(state.agents.bot.status).toBe('waiting');
    });
  });

  // ---- memory.written ----
  describe('memory.written', () => {
    it('creates a memory node and data_flow edge', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('memory.written', { agent_id: 'w', memory_key: 'draft_v1' }, { agent_id: 'w' }),
      ]);

      const memNode = state.nodeMap.get('mem-draft_v1');
      expect(memNode!.type).toBe('memory');
      expect(memNode!.label).toBe('draft_v1');

      const edge = state.edgeMap.get('e-mem-w-mem-draft_v1');
      expect(edge!.type).toBe('data_flow');
      expect(edge!.label).toBe('writes');
    });
  });

  // ---- artifact.created ----
  describe('artifact.created', () => {
    it('creates an artifact node and produces edge', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('artifact.created', { agent_id: 'w', artifact_name: 'report.pdf', artifact_type: 'document' }, { agent_id: 'w' }),
      ]);

      const artNode = state.nodeMap.get('artifact-report.pdf');
      expect(artNode!.type).toBe('artifact');
      expect(artNode!.label).toBe('report.pdf');
      expect(artNode!.metadata).toEqual({ artifact_type: 'document' });

      const edge = state.edgeMap.get('e-art-w-artifact-report.pdf');
      expect(edge!.type).toBe('produces');
      expect(edge!.animated).toBe(true);
    });
  });

  // ---- artifact.updated ----
  describe('artifact.updated', () => {
    it('updates produces edge to completed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('artifact.created', { agent_id: 'w', artifact_name: 'report.pdf' }, { agent_id: 'w' }),
        event('artifact.updated', { agent_id: 'w', artifact_name: 'report.pdf' }, { agent_id: 'w' }),
      ]);

      const edge = state.edgeMap.get('e-art-w-artifact-report.pdf');
      expect(edge!.status).toBe('completed');
      expect(edge!.animated).toBe(false);
    });
  });

  // ---- interrupt.requested ----
  describe('interrupt.requested', () => {
    it('creates interrupt state and sets agent to waiting', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('interrupt.requested', {
          agent_id: 'w',
          interrupt_id: 'int-1',
          reason: 'Need approval',
          resume_url: 'http://example.com/resume',
        }, { agent_id: 'w', span_id: 'span-int' }),
      ]);

      const interrupt = state.interrupts['int-1'];
      expect(interrupt.status).toBe('pending');
      expect(interrupt.reason).toBe('Need approval');
      expect(interrupt.agent_id).toBe('w');
      expect(interrupt.span_id).toBe('span-int');
      expect(interrupt.resume_url).toBe('http://example.com/resume');

      expect(state.agents.w.status).toBe('waiting');
      expect(state.agents.w.pending_interrupt_id).toBe('int-1');
    });

    it('skips if interrupt_id is missing', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w' }, { agent_id: 'w' }),
        event('interrupt.requested', { agent_id: 'w', reason: 'Need approval' }, { agent_id: 'w' }),
      ]);
      expect(state.interrupts).toEqual({});
    });

    it('skips if reason is missing', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w' }, { agent_id: 'w' }),
        event('interrupt.requested', { agent_id: 'w', interrupt_id: 'int-1' }, { agent_id: 'w' }),
      ]);
      expect(state.interrupts).toEqual({});
    });
  });

  // ---- interrupt.decision ----
  describe('interrupt.decision', () => {
    it('updates interrupt to approved on approval', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('interrupt.requested', { agent_id: 'w', interrupt_id: 'int-1', reason: 'Need approval' }, { agent_id: 'w' }),
        event('interrupt.decision', { interrupt_id: 'int-1', decision: 'approve', comment: 'Looks good' }, { agent_id: 'w' }),
      ]);

      const interrupt = state.interrupts['int-1'];
      expect(interrupt.status).toBe('approved');
      expect(interrupt.decision).toBe('approve');
      expect(interrupt.decision_comment).toBe('Looks good');
    });

    it('sets agent to failed on reject', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('interrupt.requested', { agent_id: 'w', interrupt_id: 'int-1', reason: 'Need approval' }, { agent_id: 'w' }),
        event('interrupt.decision', { interrupt_id: 'int-1', decision: 'reject' }, { agent_id: 'w' }),
      ]);

      expect(state.interrupts['int-1'].status).toBe('rejected');
      expect(state.agents.w.status).toBe('failed');
    });

    it('sets interrupt to resumed on resume decision', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('interrupt.requested', { agent_id: 'w', interrupt_id: 'int-1', reason: 'Need approval' }, { agent_id: 'w' }),
        event('interrupt.decision', { interrupt_id: 'int-1', decision: 'resume' }, { agent_id: 'w' }),
      ]);

      expect(state.interrupts['int-1'].status).toBe('resumed');
    });

    it('ignores decision for unknown interrupt', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w' }, { agent_id: 'w' }),
        event('interrupt.decision', { interrupt_id: 'int-missing', decision: 'approve' }),
      ]);
      expect(state.interrupts['int-missing']).toBeUndefined();
    });
  });

  // ---- interrupt.resumed ----
  describe('interrupt.resumed', () => {
    it('clears pending interrupt and reactivates agent', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'w', name: 'Writer' }, { agent_id: 'w' }),
        event('interrupt.requested', { agent_id: 'w', interrupt_id: 'int-1', reason: 'Need approval' }, { agent_id: 'w' }),
        event('interrupt.decision', { interrupt_id: 'int-1', decision: 'approve' }, { agent_id: 'w' }),
        event('interrupt.resumed', { interrupt_id: 'int-1' }, { agent_id: 'w' }),
      ]);

      expect(state.interrupts['int-1'].status).toBe('resumed');
      expect(state.agents.w.status).toBe('active');
      expect(state.agents.w.pending_interrupt_id).toBeUndefined();
    });
  });

  // ---- mission phase/status changes ----
  describe('mission.phase_changed', () => {
    it('updates state phase', () => {
      const state = replayInternal([
        event('mission.phase_changed', { phase: 'reviewing' }),
      ]);
      expect(state.phase).toBe('reviewing');
    });
  });

  describe('mission.status_changed', () => {
    it('updates state status', () => {
      const state = replayInternal([
        event('mission.status_changed', { status: 'completed' }),
      ]);
      expect(state.status).toBe('completed');
    });
  });

  // ---- span.started ----
  describe('span.started', () => {
    it('activates agent and sets span_id', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a1', name: 'Agent' }, { agent_id: 'a1' }),
        event('span.started', {
          agent_id: 'a1',
          agent_name: 'Agent',
          agent_role: 'worker',
        }, { agent_id: 'a1', span_id: 'span-s1' }),
      ]);

      expect(state.agents.a1.status).toBe('active');
      expect(state.agents.a1.current_span_id).toBe('span-s1');
    });
  });

  // ---- span.completed ----
  describe('span.completed', () => {
    it('completes agent when no pending interrupt or task', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a1', name: 'Agent' }, { agent_id: 'a1' }),
        event('span.started', { agent_id: 'a1' }, { agent_id: 'a1', span_id: 'span-s1' }),
        event('span.completed', { agent_id: 'a1', status_code: 'OK' }, { agent_id: 'a1', span_id: 'span-s1' }),
      ]);

      expect(state.agents.a1.status).toBe('completed');
    });

    it('does not complete agent if it has a pending interrupt', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a1', name: 'Agent' }, { agent_id: 'a1' }),
        event('span.started', { agent_id: 'a1' }, { agent_id: 'a1' }),
        event('interrupt.requested', { agent_id: 'a1', interrupt_id: 'int-1', reason: 'Need approval' }, { agent_id: 'a1' }),
        event('span.completed', { agent_id: 'a1', status_code: 'OK' }, { agent_id: 'a1' }),
      ]);

      // Agent should remain waiting, not completed
      expect(state.agents.a1.status).toBe('waiting');
    });
  });

  // ---- span.failed ----
  describe('span.failed', () => {
    it('sets agent to failed', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'a1', name: 'Agent' }, { agent_id: 'a1' }),
        event('span.started', { agent_id: 'a1' }, { agent_id: 'a1' }),
        event('span.failed', { agent_id: 'a1', status_code: 'ERROR' }, { agent_id: 'a1' }),
      ]);

      expect(state.agents.a1.status).toBe('failed');
    });
  });

  // ---- edge cases ----
  describe('edge cases', () => {
    it('tracks metadata correctly in agent state', () => {
      const state = replayInternal([
        event('agent.registered', {
          agent_id: 'bot',
          name: 'Bot',
          role: 'worker',
          framework: 'custom',
        }, { agent_id: 'bot', span_id: 's1', trace_id: 't1' }),
        event('task.started', { agent_id: 'bot', task: 'Do work', task_id: 'task-1' }, { agent_id: 'bot' }),
        event('task.completed', { agent_id: 'bot', task: 'Do work', task_id: 'task-1' }, { agent_id: 'bot' }),
      ]);

      // agent.registered doesn't append history (it uses upsertAgentState directly)
      expect(state.agents.bot.history).toEqual([1, 2]);
    });

    it('preserves existing node positions when re-registering same agent', () => {
      const state = replayInternal([
        event('agent.registered', { agent_id: 'bot', name: 'Bot' }, { agent_id: 'bot' }),
      ]);

      const posBefore = { ...state.nodeMap.get('bot')!.position };

      replayInternal([
        event('agent.registered', { agent_id: 'bot', name: 'Bot Updated', role: 'new-role' }, { agent_id: 'bot' }),
      ], state);

      const node = state.nodeMap.get('bot');
      expect(node!.label).toBe('Bot Updated');
      expect(node!.agent_role).toBe('new-role');
      expect(node!.position).toEqual(posBefore);
    });
  });
});

// ====================================================================
// createEmptyRuntimeState
// ====================================================================

describe('createEmptyRuntimeState', () => {
  it('returns an empty state with defaults', () => {
    const state = createEmptyRuntimeState('m1');
    expect(state.mission_id).toBe('m1');
    expect(state.branch_id).toBe(ROOT_BRANCH_ID);
    expect(state.status).toBe('active');
    expect(state.phase).toBe('planning');
    expect(state.sequence_num).toBe(-1);
    expect(state.agents).toEqual({});
    expect(state.interrupts).toEqual({});
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
  });

  it('accepts custom status and phase', () => {
    const state = createEmptyRuntimeState('m1', 'branch-1', 'completed', 'reviewing');
    expect(state.branch_id).toBe('branch-1');
    expect(state.status).toBe('completed');
    expect(state.phase).toBe('reviewing');
  });
});

// ====================================================================
// buildBranchLineage
// ====================================================================

describe('buildBranchLineage', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const branches: ReplayBranch[] = [
    { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
    { id: 'main-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 5, status: 'active', metadata: {}, created_at: now, updated_at: now },
    { id: 'main-b1-c1', mission_id: 'm1', name: 'C1', parent_branch_id: 'main-b1', forked_from_sequence_num: 10, status: 'active', metadata: {}, created_at: now, updated_at: now },
    { id: 'orphan', mission_id: 'm1', name: 'Orphan', parent_branch_id: 'nonexistent', status: 'active', metadata: {}, created_at: now, updated_at: now },
  ];

  it('returns root-to-leaf lineage', () => {
    const lineage = buildBranchLineage(branches, 'main-b1-c1');
    expect(lineage.map((b) => b.id)).toEqual([ROOT_BRANCH_ID, 'main-b1', 'main-b1-c1']);
  });

  it('returns just root for main branch', () => {
    const lineage = buildBranchLineage(branches, ROOT_BRANCH_ID);
    expect(lineage.map((b) => b.id)).toEqual([ROOT_BRANCH_ID]);
  });

  it('returns empty if branch not found', () => {
    const lineage = buildBranchLineage(branches, 'nonexistent');
    expect(lineage).toEqual([]);
  });

  it('returns orphan branch only', () => {
    const lineage = buildBranchLineage(branches, 'orphan');
    expect(lineage.map((b) => b.id)).toEqual(['orphan']);
  });
});

// ====================================================================
// createDefaultBranch
// ====================================================================

describe('createDefaultBranch', () => {
  it('creates a main branch for the given mission', () => {
    const branch = createDefaultBranch('m1');
    expect(branch.id).toBe(ROOT_BRANCH_ID);
    expect(branch.mission_id).toBe('m1');
    expect(branch.name).toBe('Main');
    expect(branch.status).toBe('active');
    expect(branch.metadata).toEqual({});
  });
});

// ====================================================================
// createMissionEventRecord
// ====================================================================

describe('createMissionEventRecord', () => {
  it('assigns a UUID if no id provided', () => {
    const record = createMissionEventRecord({
      mission_id: 'm1',
      branch_id: ROOT_BRANCH_ID,
      event_type: 'task.started',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    expect(record.id).toBeDefined();
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses provided id', () => {
    const record = createMissionEventRecord({
      id: 'my-custom-id',
      mission_id: 'm1',
      branch_id: ROOT_BRANCH_ID,
      event_type: 'task.started',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { key: 'val' },
      metadata: { meta: 'data' },
    });
    expect(record.id).toBe('my-custom-id');
    expect(record.payload).toEqual({ key: 'val' });
    expect(record.metadata).toEqual({ meta: 'data' });
  });

  it('defaults empty payload and metadata', () => {
    const record = createMissionEventRecord({
      mission_id: 'm1',
      branch_id: ROOT_BRANCH_ID,
      event_type: 'task.started',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(record.payload).toEqual({});
    expect(record.metadata).toEqual({});
  });
});

// ====================================================================
// normalizeSpansToMissionEvents — expanded scenarios
// ====================================================================

describe('normalizeSpansToMissionEvents', () => {
  const baseSpan: OtlpSpan = {
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    operation_name: 'test-op',
    start_time_unix_nano: 1_000_000_000,
    end_time_unix_nano: 2_000_000_000,
    status_code: 'OK',
    attributes: {},
    events: [],
  };

  it('normalizes a tool-call span into tool events', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: {
        'agent.id': 'researcher',
        'agent.name': 'Researcher',
        'agent.role': 'researcher',
        'agent.span.kind': 'agent.tool.call',
        'agent.tool.name': 'web_search',
        'agent.tool.input': '{"query":"AI safety"}',
      },
    }]);

    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('agent.registered');
    expect(eventTypes).toContain('tool.called');
    expect(eventTypes).toContain('tool.completed');
  });

  it('normalizes tool errors', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      status_code: 'ERROR',
      attributes: {
        'agent.id': 'researcher',
        'agent.span.kind': 'agent.tool.call',
        'agent.tool.name': 'broken_tool',
      },
    }]);

    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('tool.failed');
  });

  it('normalizes delegation event on span', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'planner', 'agent.span.kind': 'agent.task' },
      events: [{
        name: 'agent.delegation',
        timestamp: 1_500_000_000,
        attributes: {
          'agent.delegation.target': 'researcher',
          'agent.delegation.reason': 'Gather data',
        },
      }],
    }]);

    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('delegation');
  });

  it('normalizes critique event', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'critic', 'agent.span.kind': 'agent.task' },
      events: [{
        name: 'agent.critique',
        timestamp: 1_500_000_000,
        attributes: {
          'agent.critique.target': 'writer',
          'agent.critique.result': 'needs more detail',
        },
      }],
    }]);

    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('critique');
  });

  it('normalizes review events', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'reviewer', 'agent.span.kind': 'agent.task' },
      events: [
        { name: 'agent.review', timestamp: 1_500_000_000, attributes: { 'agent.review.target': 'writer', 'agent.review.result': 'good' } },
        { name: 'agent.review.approved', timestamp: 1_600_000_000, attributes: { 'agent.review.target': 'writer' } },
      ],
    }]);

    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('review.started');
    expect(eventTypes).toContain('review.approved');
  });

  it('normalizes escalation event', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'bot', 'agent.span.kind': 'agent.task' },
      events: [{
        name: 'agent.escalation',
        timestamp: 1_500_000_000,
        attributes: { 'agent.escalation.target': 'human_ops', 'agent.escalation.reason': 'Critical bug' },
      }],
    }]);

    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('escalation');
  });

  it('normalizes memory.write event', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'writer', 'agent.span.kind': 'agent.task' },
      events: [{
        name: 'agent.memory.write',
        timestamp: 1_500_000_000,
        attributes: { 'agent.memory.key': 'draft_v1' },
      }],
    }]);

    expect(events.some((e) => e.event_type === 'memory.written')).toBe(true);
  });

  it('normalizes artifact events', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'writer', 'agent.span.kind': 'agent.task' },
      events: [
        { name: 'agent.artifact.created', timestamp: 1_500_000_000, attributes: { 'artifact.name': 'report.pdf', 'artifact.type': 'pdf' } },
      ],
    }]);

    expect(events.some((e) => e.event_type === 'artifact.created')).toBe(true);
  });

  it('normalizes interrupt events', () => {
    const events = normalizeSpansToMissionEvents('m1', [{
      ...baseSpan,
      attributes: { 'agent.id': 'writer', 'agent.span.kind': 'agent.task' },
      events: [
        {
          name: 'agent.interrupt.requested',
          timestamp: 1_500_000_000,
          attributes: {
            'agent.interrupt.id': 'int-1',
            'agent.interrupt.reason': 'Need approval',
            'agent.interrupt.resume_url': 'http://resume',
          },
        },
      ],
    }]);

    expect(events.some((e) => e.event_type === 'interrupt.requested')).toBe(true);
    const intEvent = events.find((e) => e.event_type === 'interrupt.requested')!;
    expect(intEvent.payload.interrupt_id).toBe('int-1');
  });

  it('sorts events by timestamp then priority', () => {
    const span1: OtlpSpan = {
      ...baseSpan,
      span_id: 'span-1',
      start_time_unix_nano: 1_000_000_000,
      end_time_unix_nano: 3_000_000_000,
      attributes: { 'agent.id': 'a1', 'agent.span.kind': 'agent.task', 'agent.task': 'Task 1' },
    };
    const span2: OtlpSpan = {
      ...baseSpan,
      span_id: 'span-2',
      start_time_unix_nano: 2_000_000_000,
      end_time_unix_nano: 4_000_000_000,
      attributes: { 'agent.id': 'a2', 'agent.span.kind': 'agent.task', 'agent.task': 'Task 2' },
    };

    const events = normalizeSpansToMissionEvents('m1', [span2, span1]);
    const timestamps = events.map((e) => e.timestamp);
    // Events are sorted; the first span (by time) comes first
    for (let i = 1; i < timestamps.length; i++) {
      expect(new Date(timestamps[i]).getTime()).toBeGreaterThanOrEqual(
        new Date(timestamps[i - 1]).getTime(),
      );
    }
  });

  it('deduplicates agent.registered events', () => {
    const events = normalizeSpansToMissionEvents('m1', [
      {
        ...baseSpan,
        span_id: 'span-1',
        attributes: { 'agent.id': 'a1', 'agent.name': 'Agent 1', 'agent.span.kind': 'agent.task', 'agent.task': 'Task 1' },
      },
      {
        ...baseSpan,
        span_id: 'span-2',
        attributes: { 'agent.id': 'a1', 'agent.name': 'Agent 1', 'agent.span.kind': 'agent.task', 'agent.task': 'Task 2' },
      },
    ]);

    const agentRegs = events.filter((e) => e.event_type === 'agent.registered');
    expect(agentRegs).toHaveLength(1);
  });
});

// ====================================================================
// selectEventsForBranch — expanded
// ====================================================================

describe('selectEventsForBranch', () => {
  it('includes events on the branch itself after fork', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: ROOT_BRANCH_ID + '-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 2, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];

    const events: MissionEventRecord[] = [
      event('task.started', { task: 'T1', task_id: 't1' }, { id: 'e0', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 0, branch_sequence_num: 0 }),
      event('task.completed', { task: 'T1', task_id: 't1' }, { id: 'e1', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 1, branch_sequence_num: 1 }),
      event('task.started', { task: 'T2', task_id: 't2' }, { id: 'e2', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 2, branch_sequence_num: 2 }),
      event('task.started', { task: 'TB1', task_id: 'tb1' }, { id: 'e3', agent_id: 'a1', branch_id: ROOT_BRANCH_ID + '-b1', sequence_num: 3, branch_sequence_num: 0 }),
    ];

    const selected = selectEventsForBranch(events, branches, ROOT_BRANCH_ID + '-b1');
    // Should include root events up to fork point (seq <= 2) plus branch events
    expect(selected.map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('includes only root events for root branch', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: ROOT_BRANCH_ID + '-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 1, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];

    const events: MissionEventRecord[] = [
      event('task.started', { task: 'T1', task_id: 't1' }, { id: 'e0', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 0, branch_sequence_num: 0 }),
      event('task.completed', { task: 'T1', task_id: 't1' }, { id: 'e1', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 1, branch_sequence_num: 1 }),
      event('task.started', { task: 'TB1', task_id: 'tb1' }, { id: 'e2', agent_id: 'a1', branch_id: ROOT_BRANCH_ID + '-b1', sequence_num: 2, branch_sequence_num: 0 }),
    ];

    const selected = selectEventsForBranch(events, branches, ROOT_BRANCH_ID);
    // Root branch events that are before the fork at seq 1
    expect(selected.map((e) => e.id)).toEqual(['e0', 'e1']);
  });
});

// ====================================================================
// replayMissionEvents — expanded
// ====================================================================

describe('replayMissionEvents', () => {
  it('returns empty state for no events', () => {
    const result = replayMissionEvents('m1', ROOT_BRANCH_ID, []);
    expect(result.snapshots).toHaveLength(0);
    expect(result.current_state!.sequence_num).toBe(-1);
    expect(result.current_state!.agents).toEqual({});
  });

  it('produces a snapshot per event', () => {
    const events: MissionEventRecord[] = [
      event('agent.registered', { agent_id: 'a1', name: 'Agent' }, { id: 'e0', agent_id: 'a1', sequence_num: 0, branch_sequence_num: 0 }),
      event('task.started', { agent_id: 'a1', task: 'Work', task_id: 't1' }, { id: 'e1', agent_id: 'a1', sequence_num: 1, branch_sequence_num: 1 }),
      event('task.completed', { agent_id: 'a1', task: 'Work', task_id: 't1' }, { id: 'e2', agent_id: 'a1', sequence_num: 2, branch_sequence_num: 2 }),
    ];

    const result = replayMissionEvents('m1', ROOT_BRANCH_ID, events);
    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots[0].sequence_num).toBe(0);
    expect(result.snapshots[2].sequence_num).toBe(2);
    expect(result.current_state!.sequence_num).toBe(2);
  });

  it('honours initial status and phase', () => {
    const result = replayMissionEvents('m1', ROOT_BRANCH_ID, [], 'paused', 'executing');
    expect(result.current_state!.status).toBe('paused');
    expect(result.current_state!.phase).toBe('executing');
  });

  it('preserves agent ordering in serialized state', () => {
    const events: MissionEventRecord[] = [
      event('agent.registered', { agent_id: 'zulu', name: 'Zulu' }, { id: 'e0', agent_id: 'zulu' }),
      event('agent.registered', { agent_id: 'alpha', name: 'Alpha' }, { id: 'e1', agent_id: 'alpha' }),
    ];

    const result = replayMissionEvents('m1', ROOT_BRANCH_ID, events);
    const agentIds = Object.keys(result.current_state!.agents);
    expect(agentIds).toEqual(['alpha', 'zulu']); // sorted alphabetically
  });

  it('sorts events by sequence_num before replaying', () => {
    const events: MissionEventRecord[] = [
      event('task.completed', { agent_id: 'a1', task: 'Work', task_id: 't1' }, { id: 'e2', agent_id: 'a1', sequence_num: 2, branch_sequence_num: 2 }),
      event('agent.registered', { agent_id: 'a1', name: 'Agent' }, { id: 'e0', agent_id: 'a1', sequence_num: 0, branch_sequence_num: 0 }),
      event('task.started', { agent_id: 'a1', task: 'Work', task_id: 't1' }, { id: 'e1', agent_id: 'a1', sequence_num: 1, branch_sequence_num: 1 }),
    ];

    const result = replayMissionEvents('m1', ROOT_BRANCH_ID, events);
    expect(result.snapshots[0].event_type).toBe('agent.registered');
    expect(result.snapshots[1].event_type).toBe('task.started');
    expect(result.snapshots[2].event_type).toBe('task.completed');
  });
});
