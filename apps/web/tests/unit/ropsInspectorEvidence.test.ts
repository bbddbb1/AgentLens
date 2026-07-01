import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GraphNode, RuntimeActivity, RuntimeOperatorActivityRecord } from '@agentlens/protocol';
import { RopsInspector } from '@/components/rops/RopsInspector';
import { formatTimelineOutputBadge } from '@/lib/rops/fieldCondition';
import { TimelineEventCard } from '@/components/timeline/TimelineEventCard';

function operatorRecord(
  overrides: Partial<RuntimeOperatorActivityRecord> = {},
): RuntimeOperatorActivityRecord {
  return {
    primary_label: 'LLM | model',
    actor: { condition: 'recorded', value: 'agent', evidence_refs: [] },
    action: { condition: 'recorded', value: 'LLM generated', evidence_refs: [] },
    target: { condition: 'recorded', value: 'model', evidence_refs: [] },
    status_or_outcome: { condition: 'recorded', value: 'Completed', evidence_refs: [] },
    trigger: { condition: 'recorded', value: 'llm.call', evidence_refs: [] },
    input: { condition: 'not_recorded', evidence_refs: [] },
    output: { condition: 'not_recorded', evidence_refs: [] },
    downstream_effect: { condition: 'not_recorded', evidence_refs: [] },
    artifacts: { condition: 'not_recorded', evidence_refs: [] },
    evidence_condition: { condition: 'recorded', value: 'recorded', evidence_refs: [] },
    story_critical_sufficient: true,
    ...overrides,
  };
}

function graphNode(activity: RuntimeActivity): GraphNode {
  return {
    id: 'node-1',
    type: 'task',
    label: 'llm.call',
    status: 'completed',
    position: { x: 0, y: 0 },
    projection_profile: 'llm',
    metadata: {
      'basestation.aiops.llm.output.summary': '{"hypothesis":"secret-private-output"}',
      'gen_ai.request.model': 'test-model',
    },
    activity,
  };
}

describe('ropsInspectorEvidence', () => {
  it('shows scoped absence in summary without private payload text', () => {
    const activity: RuntimeActivity = {
      id: 'llm:req-1',
      kind: 'llm',
      label: 'LLM | test-model',
      action: 'LLM generated',
      outcome: 'Completed',
      status: 'completed',
      provenance: 'projection',
      operator_facing_record: operatorRecord(),
    };
    const node = graphNode(activity);
    const html = renderToString(createElement(RopsInspector, {
      node,
      agentProjection: null,
      edges: [],
      nodes: [node],
      mission: null,
      eventEnvelope: null,
      eventEnvelopes: [],
      runtimeAgentState: null,
      interrupt: null,
      branch: null,
      snapshot: null,
    }));

    expect(html).toContain('no normalized output in activity record');
    const outputsRow = html.split('outputs</span>')[1]?.split('error_or_wait_reason')[0] ?? '';
    expect(outputsRow).not.toContain('secret-private-output');
    expect(html).toContain('basestation.aiops.llm.output.summary');
    expect(html).toContain('secret-private-output');
    expect(html).toContain('story_sufficiency');
    expect(html).not.toContain('evidence_condition');
  });

  it('safe-previews long normalized output in summary', () => {
    const longOutput = 'y'.repeat(200);
    const activity: RuntimeActivity = {
      id: 'llm:req-2',
      kind: 'llm',
      label: 'LLM | test-model',
      action: 'LLM generated',
      outcome: 'Completed',
      status: 'completed',
      provenance: 'projection',
      operator_facing_record: operatorRecord({
        output: { condition: 'recorded', value: longOutput, evidence_refs: [] },
      }),
    };
    const node = graphNode(activity);
    const html = renderToString(createElement(RopsInspector, {
      node,
      agentProjection: null,
      edges: [],
      nodes: [node],
      mission: null,
      eventEnvelope: null,
      eventEnvelopes: [],
      runtimeAgentState: null,
      interrupt: null,
      branch: null,
      snapshot: null,
    }));

    expect(html).not.toContain(longOutput);
    expect(html).toContain('y'.repeat(20));
  });
});

describe('TimelineEventCard normalized output badge', () => {
  it('uses the same normalized output label as inspector', () => {
    const record = operatorRecord();
    const badge = formatTimelineOutputBadge(record.output);
    const html = renderToString(createElement(TimelineEventCard, {
      activity: {
        id: 'llm:req-1',
        kind: 'llm',
        title: 'LLM | test',
        action: 'LLM generated',
        status: 'completed',
        actor: 'agent',
        evidence_refs: [],
        operator_facing_record: record,
      },
      isCurrent: false,
      onSelect: () => {},
    }));
    expect(badge).toBe('no normalized output in activity record');
    expect(html).toContain('no normalized output in activity record');
  });
});
