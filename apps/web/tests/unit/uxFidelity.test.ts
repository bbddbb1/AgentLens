import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useGraphStore } from '../../src/stores/graphStore.js';
import { projectNodeState } from '@agentlens/protocol/internal';
import type { GraphSnapshot, MissionEventRecord } from '@agentlens/protocol';

describe('Runtime UX Fidelity Refinement', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      baseNodes: [],
      baseEdges: [],
      snapshots: [],
      selectedNodeId: null,
      zoomLevel: 1,
      highlightedNodeIds: [],
      highlightedEdgeIds: [],
    });
    vi.useFakeTimers();
  });

  describe('Graph Highlight Store Lists (R3)', () => {
    it('initializes highlightedNodeIds and highlightedEdgeIds to empty arrays', () => {
      const state = useGraphStore.getState();
      expect(state.highlightedNodeIds).toBeDefined();
      expect(state.highlightedEdgeIds).toBeDefined();
      expect(state.highlightedNodeIds).toEqual([]);
      expect(state.highlightedEdgeIds).toEqual([]);
    });

    it('populates highlights when applying a snapshot by comparing with the previous snapshot', () => {
      const snap0: GraphSnapshot = {
        id: 'snap-0',
        mission_id: 'm1',
        sequence_num: 0,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [
          { id: 'node-1', type: 'agent', label: 'Planner', status: 'active', position: { x: 0, y: 0 } },
          { id: 'node-2', type: 'agent', label: 'Researcher', status: 'idle', position: { x: 0, y: 0 } },
        ],
        edges: [
          { id: 'edge-1', type: 'delegation', source: 'node-1', target: 'node-2', label: 'delegates', status: 'active' },
        ],
      };

      const snap1: GraphSnapshot = {
        id: 'snap-1',
        mission_id: 'm1',
        sequence_num: 1,
        timestamp: '2026-01-01T00:00:01.000Z',
        nodes: [
          { id: 'node-1', type: 'agent', label: 'Planner', status: 'completed', position: { x: 0, y: 0 } }, // status changed
          { id: 'node-2', type: 'agent', label: 'Researcher', status: 'active', position: { x: 0, y: 0 } }, // status changed
          { id: 'node-3', type: 'tool', label: 'Search', status: 'active', position: { x: 0, y: 0 } }, // new node
        ],
        edges: [
          { id: 'edge-1', type: 'delegation', source: 'node-1', target: 'node-2', label: 'delegates', status: 'completed' }, // status changed
          { id: 'edge-2', type: 'uses', source: 'node-2', target: 'node-3', label: 'uses', status: 'active' }, // new edge
        ],
      };

      const store = useGraphStore.getState();
      useGraphStore.setState({ snapshots: [snap0, snap1] });

      // Apply snap1
      store.applySnapshot(snap1);

      const updatedState = useGraphStore.getState();
      expect(updatedState.highlightedNodeIds).toContain('node-1');
      expect(updatedState.highlightedNodeIds).toContain('node-2');
      expect(updatedState.highlightedNodeIds).toContain('node-3');
      expect(updatedState.highlightedEdgeIds).toContain('edge-1');
      expect(updatedState.highlightedEdgeIds).toContain('edge-2');
    });

    it('clears highlights after a 2-second timeout', () => {
      const snap0: GraphSnapshot = {
        id: 'snap-0',
        mission_id: 'm1',
        sequence_num: 0,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [{ id: 'node-1', type: 'agent', label: 'Planner', status: 'active', position: { x: 0, y: 0 } }],
        edges: [],
      };

      const snap1: GraphSnapshot = {
        id: 'snap-1',
        mission_id: 'm1',
        sequence_num: 1,
        timestamp: '2026-01-01T00:00:01.000Z',
        nodes: [
          { id: 'node-1', type: 'agent', label: 'Planner', status: 'completed', position: { x: 0, y: 0 } },
          { id: 'node-2', type: 'agent', label: 'Researcher', status: 'active', position: { x: 0, y: 0 } },
        ],
        edges: [],
      };

      const store = useGraphStore.getState();
      useGraphStore.setState({ snapshots: [snap0, snap1] });

      store.applySnapshot(snap1);
      
      let state = useGraphStore.getState();
      expect(state.highlightedNodeIds.length).toBeGreaterThan(0);

      // Fast-forward time
      vi.advanceTimersByTime(2000);

      state = useGraphStore.getState();
      expect(state.highlightedNodeIds).toEqual([]);
      expect(state.highlightedEdgeIds).toEqual([]);
    });
  });

  describe('Event-backed Confidence (R2)', () => {
    function makeEvent(type: string, payload: Record<string, unknown> = {}, seq = 0): MissionEventRecord {
      return {
        id: `e-${seq}`,
        mission_id: 'm1',
        branch_id: 'main',
        sequence_num: seq,
        branch_sequence_num: seq,
        event_type: type,
        timestamp: `2026-01-01T00:00:0${seq}.000Z`,
        agent_id: 'test_agent',
        payload,
        metadata: {},
      };
    }

    it('parses confidence and drift score from telemetry attributes if present', () => {
      const events = [
        makeEvent('agent.registered', { agent_id: 'test_agent', name: 'Test Agent' }, 0),
        makeEvent('task.started', { 
          agent_id: 'test_agent', 
          'gen_ai.agent.confidence': 0.85, 
          'gen_ai.agent.drift_score': 0.12 
        }, 1),
      ];

      const projection = projectNodeState({
        mission_id: 'm1',
        branch_id: 'main',
        agent_id: 'test_agent',
        events,
      });

      expect(projection).toBeDefined();
      expect(projection!.facts.confidence).toBe(0.85);
      expect(projection!.facts.drift_score).toBe(0.12);
    });

    it('does not fabricate confidence when the runtime did not emit it (passive observability, P0)', () => {
      const events = [
        makeEvent('agent.registered', { agent_id: 'test_agent', name: 'Test Agent' }, 0),
        makeEvent('task.failed', { agent_id: 'test_agent', task: 'some task' }, 1), // 1 error, adds warning
        makeEvent('tool.failed', { agent_id: 'test_agent', tool_name: 'some tool' }, 2), // 1 error (total 2), adds warning
      ];

      const projection = projectNodeState({
        mission_id: 'm1',
        branch_id: 'main',
        agent_id: 'test_agent',
        events,
      });

      expect(projection).toBeDefined();
      // No `gen_ai.agent.confidence` was emitted, so the projection must NOT
      // invent a fallback formula from error/warning counts. Confidence is
      // absent ("not recorded") regardless of error_count/warnings.
      expect(projection!.facts.confidence).toBeUndefined();
      expect(projection!.facts.error_count).toBe(2);
    });

    it('does not fabricate a minimum-confidence floor when absent (P0)', () => {
      const events = [
        makeEvent('agent.registered', { agent_id: 'test_agent', name: 'Test Agent' }, 0),
      ];
      // Push 10 errors
      for (let i = 1; i <= 10; i++) {
        events.push(makeEvent('task.failed', { agent_id: 'test_agent', task: `task-${i}` }, i));
      }

      const projection = projectNodeState({
        mission_id: 'm1',
        branch_id: 'main',
        agent_id: 'test_agent',
        events,
      });

      expect(projection).toBeDefined();
      // The previous 0.1 floor was fabricated; absence stays absent.
      expect(projection!.facts.confidence).toBeUndefined();
    });
  });
});
