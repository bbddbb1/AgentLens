import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useGraphStore } from '../../src/stores/graphStore.js';
import { projectNodeState } from '@agentlens/protocol';
import type { GraphSnapshot, MissionEventRecord } from '@agentlens/protocol';

describe('Runtime UX Fidelity Refinement - Adversarial Stress Tests', () => {
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

  describe('Adversarial Graph Highlights (R3)', () => {
    it('handles rapid sequential snapshot applications (debouncing/clearing timers)', () => {
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

      const snap2: GraphSnapshot = {
        id: 'snap-2',
        mission_id: 'm1',
        sequence_num: 2,
        timestamp: '2026-01-01T00:00:02.000Z',
        nodes: [
          { id: 'node-1', type: 'agent', label: 'Planner', status: 'completed', position: { x: 0, y: 0 } },
          { id: 'node-2', type: 'agent', label: 'Researcher', status: 'completed', position: { x: 0, y: 0 } },
          { id: 'node-3', type: 'agent', label: 'Writer', status: 'active', position: { x: 0, y: 0 } },
        ],
        edges: [],
      };

      const store = useGraphStore.getState();
      useGraphStore.setState({ snapshots: [snap0, snap1, snap2] });

      // Apply snap1 at t=0
      store.applySnapshot(snap1);
      expect(useGraphStore.getState().highlightedNodeIds).toContain('node-1');
      expect(useGraphStore.getState().highlightedNodeIds).toContain('node-2');

      // Fast-forward 1 second
      vi.advanceTimersByTime(1000);

      // Apply snap2 at t=1s
      store.applySnapshot(snap2);
      // Highlights should now update to reflect snap2 (changes to node-2 status and new node-3)
      expect(useGraphStore.getState().highlightedNodeIds).toContain('node-2');
      expect(useGraphStore.getState().highlightedNodeIds).toContain('node-3');
      expect(useGraphStore.getState().highlightedNodeIds).not.toContain('node-1');

      // Fast-forward another 1 second (total 2 seconds from start, but only 1 second from snap2 application)
      vi.advanceTimersByTime(1000);
      // Highlights should still be active for snap2 since they last 2 seconds from application (t=3s)
      expect(useGraphStore.getState().highlightedNodeIds.length).toBeGreaterThan(0);

      // Fast-forward another 1 second (total 3 seconds from start, 2 seconds from snap2 application)
      vi.advanceTimersByTime(1000);
      // Now highlights should be cleared
      expect(useGraphStore.getState().highlightedNodeIds).toEqual([]);
    });

    it('gracefully handles missing snapshots or mismatch IDs without throwing', () => {
      const snap0: GraphSnapshot = {
        id: 'snap-0',
        mission_id: 'm1',
        sequence_num: 0,
        timestamp: '2026-01-01T00:00:00.000Z',
        nodes: [{ id: 'node-1', type: 'agent', label: 'Planner', status: 'active', position: { x: 0, y: 0 } }],
        edges: [],
      };

      const store = useGraphStore.getState();
      // Snapshots array is empty, but we apply snap0
      expect(() => store.applySnapshot(snap0)).not.toThrow();
      expect(useGraphStore.getState().highlightedNodeIds).toEqual([]);
    });
  });

  describe('Adversarial Event-backed Confidence (R2)', () => {
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

    it('checks behavior when confidence is non-numeric/string representation', () => {
      const events = [
        makeEvent('agent.registered', { agent_id: 'test_agent', name: 'Test Agent' }, 0),
        makeEvent('task.started', { 
          agent_id: 'test_agent', 
          'gen_ai.agent.confidence': '0.75' // String representation of a float
        }, 1),
      ];

      const projection = projectNodeState({
        mission_id: 'm1',
        branch_id: 'main',
        agent_id: 'test_agent',
        events,
      });

      expect(projection).toBeDefined();
      expect(projection!.facts.confidence).toBe(0.75); // parsed correctly as a number
    });

    it('checks behavior when confidence is completely invalid string', () => {
      const events = [
        makeEvent('agent.registered', { agent_id: 'test_agent', name: 'Test Agent' }, 0),
        makeEvent('task.started', { 
          agent_id: 'test_agent', 
          'gen_ai.agent.confidence': 'invalid-confidence-score' 
        }, 1),
      ];

      const projection = projectNodeState({
        mission_id: 'm1',
        branch_id: 'main',
        agent_id: 'test_agent',
        events,
      });

      expect(projection).toBeDefined();
      // Should result in NaN because Number('invalid-confidence-score') is NaN
      expect(projection!.facts.confidence).toBeNaN();
    });
  });
});
