import { describe, expect, it } from 'vitest';
import type { RuntimeActivity, RuntimeOperatorActivityRecord } from '@agentlens/protocol';
import { buildNodeCardView } from '../../src/components/graph/nodePresentation.js';
import { EDGE_PRESENTATION } from '../../src/lib/graphPresentation.js';

const recorded = (value?: string) => ({
  value,
  condition: value === undefined ? ('not_recorded' as const) : ('recorded' as const),
});

function runtimeActivity(record?: RuntimeOperatorActivityRecord): RuntimeActivity {
  return {
    id: 'activity-1',
    kind: 'tool',
    label: 'generic label',
    title: 'generic title',
    action: 'generic action',
    outcome: 'Active',
    status: 'active',
    operator_facing_record: record,
    provenance: 'projection',
  };
}

function operatorRecord(): RuntimeOperatorActivityRecord {
  return {
    primary_label: 'Researcher queried the incident index',
    actor: recorded('Researcher'),
    action: recorded('Query incident index'),
    target: recorded('incident index'),
    status_or_outcome: recorded('Active'),
    trigger: recorded(),
    input: recorded(),
    output: recorded(),
    downstream_effect: recorded(),
    artifacts: recorded(),
    evidence_condition: recorded('recorded'),
    story_critical_sufficient: true,
  };
}

describe('graph node card presentation', () => {
  it('does not fabricate a missing agent role', () => {
    const view = buildNodeCardView('agent', {
      label: 'Researcher',
      status: 'idle',
    });
    expect(view.label).toBe('Researcher');
    expect(view.secondary).toBeUndefined();
    expect(view.statusLabel).toBe('Idle');
  });

  it('prefers the shared operator-facing activity record', () => {
    const view = buildNodeCardView('tool', {
      label: 'span.execute',
      status: 'active',
      activity: runtimeActivity(operatorRecord()),
    });
    expect(view.label).toBe('Researcher queried the incident index');
    expect(view.secondary).toBe('Query incident index · incident index');
    expect(view.statusLabel).toBe('Active');
  });

  it('selects exactly one deterministic agent headline metric', () => {
    const completed = buildNodeCardView('agent', {
      label: 'Agent',
      status: 'completed',
      durationMs: 1250,
      errorCount: 3,
      summary: 'Inspector-only detail',
    });
    expect(completed.metric).toEqual({
      display: '1.25 s',
      provenance: 'projection',
    });
    expect(completed).not.toHaveProperty('summary');

    const failed = buildNodeCardView('agent', {
      label: 'Agent',
      status: 'failed',
      errorCount: 1,
    });
    expect(failed.metric).toEqual({
      display: '1 error',
      provenance: 'evidence',
    });
  });

  it('uses recorded task progress only when a stronger metric is unavailable', () => {
    const view = buildNodeCardView('task', {
      label: 'Index evidence',
      status: 'active',
      metadata: { progress: 62.4 },
    });
    expect(view.metric).toEqual({ display: '62%', provenance: 'evidence' });
  });

  it('keeps transient tool cards metric-free while exposing lifecycle text', () => {
    const view = buildNodeCardView('tool', {
      label: 'Search',
      status: 'waiting',
      metadata: { invocationCount: 9 },
      durationMs: 500,
    });
    expect(view.statusLabel).toBe('Waiting');
    expect(view.metric).toBeNull();
  });
});

describe('graph edge presentation', () => {
  it('gives each edge type a non-color visual signature', () => {
    const signatures = Object.values(EDGE_PRESENTATION).map(({ strokeWidth, strokeDasharray }) => `${strokeWidth}:${strokeDasharray ?? 'solid'}`);

    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
