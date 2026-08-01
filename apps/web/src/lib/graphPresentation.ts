import type { EdgeType } from '@agentlens/protocol';

export interface EdgePresentation {
  label: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

/**
 * Stable, low-saturation edge treatment. Direction and line pattern carry
 * meaning alongside color so edge semantics are not color-only.
 */
export const EDGE_PRESENTATION: Record<EdgeType, EdgePresentation> = {
  delegation: {
    label: 'Delegation',
    stroke: 'var(--color-edge-delegation)',
    strokeWidth: 1.9,
  },
  critique: {
    label: 'Critique',
    stroke: 'var(--color-edge-critique)',
    strokeWidth: 1.7,
    strokeDasharray: '6 4',
  },
  review: {
    label: 'Review',
    stroke: 'var(--color-edge-review)',
    strokeWidth: 1.8,
    strokeDasharray: '2 3',
  },
  escalation: {
    label: 'Escalation',
    stroke: 'var(--color-edge-escalation)',
    strokeWidth: 1.9,
    strokeDasharray: '8 4 2 4',
  },
  dependency: {
    label: 'Dependency',
    stroke: 'var(--color-edge-dependency)',
    strokeWidth: 1.4,
  },
  uses: {
    label: 'Uses',
    stroke: 'var(--color-node-tool)',
    strokeWidth: 1.5,
    strokeDasharray: '5 4',
  },
  data_flow: {
    label: 'Data flow',
    stroke: 'var(--color-edge-dataflow)',
    strokeWidth: 1.5,
    strokeDasharray: '2 4',
  },
  approval: {
    label: 'Approval',
    stroke: 'var(--color-success)',
    strokeWidth: 1.8,
    strokeDasharray: '9 3',
  },
  member_of: {
    label: 'Member of',
    stroke: 'var(--color-node-team)',
    strokeWidth: 1.4,
    strokeDasharray: '3 4',
  },
  produces: {
    label: 'Produces',
    stroke: 'var(--color-node-artifact)',
    strokeWidth: 1.5,
    strokeDasharray: '1 3 6 3',
  },
};
