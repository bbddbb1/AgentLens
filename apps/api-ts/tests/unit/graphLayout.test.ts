import { describe, expect, it } from 'vitest';
import { applyHierarchicalLayout } from '../../src/services/graphLayout.js';
import type { GraphSnapshot } from '@agentlens/protocol';

describe('applyHierarchicalLayout', () => {
  it('positions delegation roots above delegated agents', () => {
    const snapshot: GraphSnapshot = {
      id: 'snap-1',
      mission_id: 'm1',
      sequence_num: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [
        { id: 'planner', type: 'agent', label: 'Planner', status: 'active', position: { x: 0, y: 0 } },
        { id: 'researcher', type: 'agent', label: 'Researcher', status: 'active', position: { x: 0, y: 0 } },
        { id: 'search', type: 'tool', label: 'search', status: 'active', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'e1', type: 'delegation', source: 'planner', target: 'researcher', status: 'active' },
        { id: 'e2', type: 'uses', source: 'researcher', target: 'search', status: 'active' },
      ],
    };

    const laidOut = applyHierarchicalLayout(snapshot);
    const planner = laidOut.nodes.find((node) => node.id === 'planner');
    const researcher = laidOut.nodes.find((node) => node.id === 'researcher');
    const search = laidOut.nodes.find((node) => node.id === 'search');

    expect(planner?.position.y).toBeLessThan(researcher?.position.y ?? 0);
    expect(search?.position.y).toBeGreaterThan(researcher?.position.y ?? 0);
    expect(search?.position.y - researcher!.position.y).toBeGreaterThanOrEqual(160);
  });
});
