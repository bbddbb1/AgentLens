import { describe, expect, it } from 'vitest';
import {
  buildAgentView,
  buildGraphNodeView,
  buildInterruptView,
  buildCheckpointView,
  classifyConfidence,
  classifySearch,
  deriveDurationMs,
  deriveRelationships,
  envelopeProvenance,
  formatDurationMs,
  isAllowed,
  nodeStatusLabel,
  splitPayload,
  FORBIDDEN_FIELDS,
} from '../../src/lib/rops/provenance.js';
import type {
  EventEnvelope,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  InterruptRecord,
  RuntimeNodeProjection,
} from '@agentlens/protocol';

function makeProjection(overrides: Partial<RuntimeNodeProjection> = {}): RuntimeNodeProjection {
  return {
    projection_version: 1,
    mission_id: 'm1',
    branch_id: 'main',
    sequence_num: 1,
    generated_at: '2026-01-01T00:00:00.000Z',
    agent_id: 'a1',
    name: 'Researcher',
    node_type: 'agent',
    facts: {
      role: 'researcher',
      status: 'active',
      status_label: 'Active',
      produced_outputs: [],
      warnings: [],
      requires_human: false,
    },
    recent_runtime_events: [],
    ...overrides,
  } as RuntimeNodeProjection;
}

describe('ROPS provenance — forbidden fields', () => {
  it('marks every P4-forbidden field as not allowed', () => {
    for (const key of FORBIDDEN_FIELDS) {
      expect(isAllowed(key)).toBe(false);
    }
    expect(isAllowed('agent_id')).toBe(true);
    expect(isAllowed('duration_ms')).toBe(true);
  });

  it('buildAgentView never reads projection.generated', () => {
    const projection = makeProjection({
      generated: {
        projection_version: 1,
        source: 'llm',
        generated_at: '2026-01-01T00:00:00.000Z',
        current_understanding: 'SHOULD NOT APPEAR',
        highlights: ['SHOULD NOT APPEAR'],
        suggested_title: 'SHOULD NOT APPEAR',
        llm_warnings: ['SHOULD NOT APPEAR'],
      } as unknown as RuntimeNodeProjection['generated'],
    });
    const view = buildAgentView(projection);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('SHOULD NOT APPEAR');
    expect(serialized).not.toContain('current_understanding');
    expect(serialized).not.toContain('suggested_title');
    expect(serialized).not.toContain('llm_warnings');
    expect(serialized).not.toContain('highlights');
  });
});

describe('ROPS provenance — confidence classification (P0 / 10.3 / P8)', () => {
  it('classifies a present (emitter-set) confidence as evidence', () => {
    const f = classifyConfidence(0.85);
    expect(f.provenance).toBe('evidence');
    expect(f.value).toBe(0.85);
    expect(f.absent).toBe(false);
  });

  it('never fabricates confidence: absence renders as not-recorded evidence', () => {
    // The projection no longer synthesizes a fallback formula, so a missing
    // confidence is absent Evidence ("not recorded"), not a heuristic value.
    const f = classifyConfidence(undefined);
    expect(f.absent).toBe(true);
    expect(f.provenance).toBe('evidence');
    expect(f.value).toBeUndefined();
  });

  it('treats every present confidence as evidence (no heuristic path)', () => {
    // After P0 there is no formula-reproduction branch: any value reaching
    // facts.confidence was emitted by the runtime, so it is Evidence regardless
    // of error/warning counts.
    const f = classifyConfidence(0.6);
    expect(f.provenance).toBe('evidence');
    expect(f.value).toBe(0.6);
    expect(f.absent).toBe(false);
  });
});

describe('ROPS provenance — status vocabulary (7.1)', () => {
  it('maps every NodeStatus to a label and refuses synonyms', () => {
    expect(nodeStatusLabel('idle')).toBe('Idle');
    expect(nodeStatusLabel('active')).toBe('Active');
    expect(nodeStatusLabel('completed')).toBe('Completed');
    expect(nodeStatusLabel('failed')).toBe('Failed');
    expect(nodeStatusLabel('waiting')).toBe('Waiting');
    expect(nodeStatusLabel('reviewing')).toBe('Reviewing');
    expect(nodeStatusLabel('running')).toBe('running'); // not invented, passed through
    expect(nodeStatusLabel(undefined)).toBeUndefined();
  });
});

describe('ROPS provenance — duration projection (6.2)', () => {
  it('derives duration_ms from end_time - start_time', () => {
    expect(deriveDurationMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.500Z')).toBe(1500);
  });
  it('returns undefined when either timestamp is missing', () => {
    expect(deriveDurationMs(undefined, '2026-01-01T00:00:01.500Z')).toBeUndefined();
    expect(deriveDurationMs('2026-01-01T00:00:00.000Z', undefined)).toBeUndefined();
  });
  it('formats durations deterministically (7.7)', () => {
    expect(formatDurationMs(500)).toBe('500 ms');
    expect(formatDurationMs(1500)).toBe('1.50 s');
    expect(formatDurationMs(125_000)).toBe('2m 5s');
    expect(formatDurationMs(undefined)).toBe('—');
  });
});

describe('ROPS provenance — relationship derivation (6.4)', () => {
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'a1', target: 't1', type: 'dependency', status: 'active' },
    { id: 'e2', source: 'a1', target: 'tool1', type: 'uses', status: 'active' },
    { id: 'e3', source: 'agent2', target: 'a1', type: 'produces', status: 'active' },
    { id: 'e4', source: 'a1', target: 'art1', type: 'produces', status: 'active' },
  ];
  it('derives direction-aware neutral relation labels with evidence anchors', () => {
    const rels = deriveRelationships('a1', edges);
    expect(rels).toEqual([
      expect.objectContaining({ kind: 'incoming', label: 'Produced by', evidenceAnchors: ['e3'] }),
      expect.objectContaining({ kind: 'outgoing', label: 'Dependency', evidenceAnchors: ['e1'] }),
      expect.objectContaining({ kind: 'outgoing', label: 'Produces', evidenceAnchors: ['e4'] }),
      expect.objectContaining({ kind: 'outgoing', label: 'Uses', evidenceAnchors: ['e2'] }),
    ]);
    for (const relation of rels) {
      expect(relation.provenance).toBe('projection');
    }
  });
  it('returns empty for an isolated node', () => {
    expect(deriveRelationships('lonely', edges)).toEqual([]);
  });
});

describe('ROPS provenance — payload whitelist (8.1/8.2)', () => {
  it('splits recognized vs unrecognized payload keys', () => {
    const { recognized, unrecognized } = splitPayload({
      tool_name: 'web_search',
      tool_input: { q: 'agentlens' },
      some_custom_field: 'x',
      'basestation.aiops.region': 'us-east',
    });
    const recognizedKeys = recognized.map(([k]) => k);
    expect(recognizedKeys).toContain('tool_name');
    expect(recognizedKeys).toContain('tool_input');
    expect(recognizedKeys).not.toContain('some_custom_field');
    expect(unrecognized.map(([k]) => k)).toEqual(['some_custom_field', 'basestation.aiops.region']);
  });
  it('handles absent payload', () => {
    const r = splitPayload(undefined);
    expect(r.recognized).toEqual([]);
    expect(r.unrecognized).toEqual([]);
  });
});

describe('ROPS provenance — search heuristic (3.6)', () => {
  it('classifies by explicit search.* payload as evidence', () => {
    const r = classifySearch('anything', { 'search.query': 'q' });
    expect(r.isSearch).toBe(true);
    if (r.isSearch) expect(r.provenance).toBe('evidence');
  });
  it('classifies by tool-name pattern as heuristic', () => {
    const r = classifySearch('vector_search', undefined);
    expect(r.isSearch).toBe(true);
    if (r.isSearch) expect(r.provenance).toBe('heuristic');
  });
  it('returns false for non-search tools', () => {
    expect(classifySearch('calculator', undefined).isSearch).toBe(false);
  });
});

describe('ROPS provenance — envelope provenance block (9.4)', () => {
  it('packs all EventEnvelope provenance fields as evidence', () => {
    const env: EventEnvelope = {
      id: 'e1',
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 1,
      branch_sequence_num: 1,
      event_type: 'tool.completed',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {},
      actor_type: 'agent',
      actor_id: 'a1',
      origin_framework: 'langgraph',
      model: { provider: 'openai', model_name: 'gpt-4o', tokens_input: 10, tokens_output: 5, temperature: 0.2, stop_reason: 'stop' },
      policy: { rule_id: 'r1', decision: 'allow', reason: 'ok' },
      error: { source: 'tool', cause: 'timeout', severity: 'high' },
      causal: { parent_span_id: 'p1', tool_call_id: 'tc1', triggered_by_event_id: 'e0' },
      content_hash: 'abc',
      previous_hash: 'def',
    };
    const p = envelopeProvenance(env)!;
    expect(p.actorType.value).toBe('agent');
    expect(p.model?.modelName.value).toBe('gpt-4o');
    expect(p.policy?.decision.value).toBe('allow');
    expect(p.error?.severity.value).toBe('high');
    expect(p.causal?.parentSpanId.value).toBe('p1');
    expect(p.contentHash.value).toBe('abc');
    expect(p.previousHash.value).toBe('def');
    // all evidence
    expect(p.actorType.provenance).toBe('evidence');
    expect(p.model?.tokensInput.provenance).toBe('evidence');
  });
  it('returns null for absent envelope', () => {
    expect(envelopeProvenance(null)).toBeNull();
    expect(envelopeProvenance(undefined)).toBeNull();
  });
});

describe('ROPS provenance — view-model builders', () => {
  it('buildGraphNodeView maps node.type to object type', () => {
    const task: GraphNode = { id: 't1', type: 'task', label: 'Find papers', status: 'active', position: { x: 0, y: 0 } };
    const tool: GraphNode = { id: 'tool1', type: 'tool', label: 'web_search', status: 'active', position: { x: 0, y: 0 } };
    const mem: GraphNode = { id: 'm1', type: 'memory', label: 'shared', status: 'active', position: { x: 0, y: 0 } };
    const art: GraphNode = { id: 'a1', type: 'artifact', label: 'report.pdf', status: 'active', position: { x: 0, y: 0 } };
    expect(buildGraphNodeView(task).objectType).toBe('WorkflowStep');
    expect(buildGraphNodeView(tool).objectType).toBe('ToolInvocation');
    expect(buildGraphNodeView(mem).objectType).toBe('Memory');
    expect(buildGraphNodeView(art).objectType).toBe('Artifact');
  });

  it('buildInterruptView packs InterruptRecord evidence', () => {
    const rec: InterruptRecord = {
      id: 'i1', mission_id: 'm1', interrupt_id: 'int-1', status: 'pending',
      reason: 'need approval', payload: {}, created_at: '', updated_at: '',
    };
    const v = buildInterruptView(rec);
    expect(v.interruptId.value).toBe('int-1');
    expect(v.status.value).toBe('pending');
    expect(v.reason.value).toBe('need approval');
    expect(v.interruptId.provenance).toBe('evidence');
  });

  it('buildCheckpointView derives node/edge counts as projection', () => {
    const snap: GraphSnapshot = {
      id: 's1', mission_id: 'm1', sequence_num: 3, timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [{ id: 'n1' }, { id: 'n2' }] as unknown as GraphNode[],
      edges: [{ id: 'e1' }] as unknown as GraphEdge[],
    };
    const v = buildCheckpointView(snap);
    expect(v.sequenceNum.value).toBe(3);
    expect(v.nodeCount.value).toBe(2);
    expect(v.edgeCount.value).toBe(1);
    expect(v.nodeCount.provenance).toBe('projection');
  });
});
