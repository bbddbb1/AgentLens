import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRuntimeExplanation, type EventEnvelope } from '@agentlens/protocol';
import { normalizeSpansToFacts } from '../../src/services/runtime/normalization/index.js';
import { projectReplay, projectTraceSnapshot } from '../../src/services/runtime/projection.js';

const langGraphFixtures = resolve(import.meta.dirname, '../../../../packages/sdk-langgraph/tests/fixtures/otlp');
const mafFixtures = resolve(import.meta.dirname, '../../../../packages/sdk-maf/tests/fixtures/otlp');

function langGraphFixture(name: string): any[] {
  return JSON.parse(readFileSync(resolve(langGraphFixtures, name, 'spans.json'), 'utf8')).spans;
}

function mafFixture(name: string): any[] {
  return JSON.parse(readFileSync(resolve(mafFixtures, name, 'captured_telemetry.json'), 'utf8')).spans;
}

function explanationFor(spans: any[], cutoff?: number) {
  const replay = projectReplay('canonical-mission', 'main', spans);
  return {
    replay,
    explanation: projectRuntimeExplanation({
      mission_id: replay.mission_id,
      branch_id: replay.branch_id,
      events: replay.events as EventEnvelope[],
      as_of_sequence_num: cutoff,
    }),
  };
}

function span(overrides: Record<string, any> = {}) {
  return {
    span_id: 'span-1',
    trace_id: 'trace-1',
    operation_name: 'execute_tool',
    start_time_unix_nano: '100',
    end_time_unix_nano: '200',
    status_code: 'OK',
    attributes: { 'gen_ai.tool.name': 'search' },
    events: [],
    ...overrides,
  };
}

describe('canonical runtime meaning', () => {
  it('uses normalized LangGraph tool terminal meaning in RuntimeExplanation', () => {
    const success = explanationFor(langGraphFixture('tool_success')).explanation.activities.find(
      activity => activity.kind === 'tool',
    );
    const failure = explanationFor(langGraphFixture('tool_failed')).explanation.activities.find(
      activity => activity.kind === 'tool',
    );

    expect(success).toMatchObject({ status: 'completed', outcome: 'Success' });
    expect(failure).toMatchObject({ status: 'failed', outcome: 'Failure' });
    expect(success?.semantic_provenance).toMatchObject({
      lifecycle: { basis: 'derived', condition: 'recorded' },
      outcome: { basis: 'derived', condition: 'recorded' },
    });
    expect(failure?.semantic_provenance).toMatchObject({
      lifecycle: { basis: 'derived', condition: 'recorded' },
      outcome: { basis: 'derived', condition: 'recorded' },
    });
    expect(success?.semantic_provenance?.outcome.evidence_refs.length).toBeGreaterThan(0);
    expect(failure?.semantic_provenance?.outcome.evidence_refs.length).toBeGreaterThan(0);
    expect(success?.id).toBe(`tool:${success?.invocation_id}`);
    expect(failure?.id).toBe(`tool:${failure?.invocation_id}`);
  });

  it('treats a generic ended UNSET span as completed with unknown outcome everywhere', () => {
    const ended = span({
      status_code: 'UNSET',
      attributes: {
        'gen_ai.agent.id': 'agent-1',
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.call.id': 'call-ended',
      },
      events: [
        {
          name: 'agent.tool.call',
          timestamp: '120',
          attributes: {
            'gen_ai.tool.name': 'search',
            'gen_ai.tool.call.id': 'call-ended',
            'gen_ai.tool.status': 'active',
          },
        },
      ],
    });
    const facts = normalizeSpansToFacts([ended]);
    const { explanation } = explanationFor([ended]);
    const snapshot = projectTraceSnapshot('canonical-mission', 'main', [ended]);

    expect(facts.activities).toContainEqual(
      expect.objectContaining({
        kind: 'tool',
        lifecycle: 'completed',
        outcome: 'unknown',
      }),
    );
    const explainedTool = explanation.activities.find(activity => activity.kind === 'tool');
    expect(explainedTool).toMatchObject({
      status: 'completed',
      outcome: 'Unknown',
      semantic_provenance: {
        lifecycle: { basis: 'derived', condition: 'recorded' },
        outcome: { basis: 'derived', condition: 'recorded' },
      },
    });
    expect(explainedTool?.semantic_provenance?.lifecycle.evidence_refs).toHaveLength(1);
    expect(explainedTool?.semantic_provenance?.outcome.evidence_refs)
      .toEqual(explainedTool?.semantic_provenance?.lifecycle.evidence_refs);
    expect(snapshot.nodes.find(node => node.source_span_id === 'span-1')).toMatchObject({ status: 'completed' });
  });

  it('keeps multiple explicit LLM invocations on one span distinct', () => {
    const shared = span({
      operation_name: 'agent.invoke',
      status_code: 'UNSET',
      events: [
        {
          name: 'gen_ai.call',
          timestamp: '120',
          attributes: {
            'gen_ai.request.id': 'request-a',
            'gen_ai.usage.output_tokens': 1,
          },
        },
        {
          name: 'gen_ai.call',
          timestamp: '140',
          attributes: {
            'gen_ai.request.id': 'request-b',
            'gen_ai.usage.output_tokens': 1,
          },
        },
      ],
      attributes: {},
    });

    const facts = normalizeSpansToFacts([shared]);
    const { explanation } = explanationFor([shared]);
    expect(facts.activities.filter(activity => activity.kind === 'llm').map(activity => activity.id)).toEqual([
      'llm:request-a',
      'llm:request-b',
    ]);
    expect(explanation.activities.filter(activity => activity.kind === 'llm').map(activity => activity.id)).toEqual([
      'llm:request-a',
      'llm:request-b',
    ]);
  });

  it('routes existing neutral tool lifecycle events through the same authority', () => {
    const generic = span({
      operation_name: 'agent.invoke',
      status_code: 'UNSET',
      attributes: {},
      events: [
        {
          name: 'tool.called',
          timestamp: '120',
          attributes: { tool_call_id: 'neutral-call', tool_name: 'search' },
        },
        {
          name: 'tool.failed',
          timestamp: '140',
          attributes: { tool_call_id: 'neutral-call', tool_name: 'search' },
        },
      ],
    });
    const facts = normalizeSpansToFacts([generic]);
    const { replay, explanation } = explanationFor([generic]);

    expect(facts.activities.find(activity => activity.id === 'tool:neutral-call')).toMatchObject({
      lifecycle: 'failed',
      outcome: 'failure',
    });
    expect(JSON.stringify(replay.events)).not.toContain('runtime_activity');
    expect(explanation.activities.find(activity => activity.id === 'tool:neutral-call')).toMatchObject({
      status: 'failed',
      outcome: 'Failure',
    });
  });

  it('does not let an unsupported production event bypass normalization', () => {
    const unsupported = span({
      operation_name: 'agent.invoke',
      status_code: 'UNSET',
      attributes: {},
      events: [{ name: 'tool.started', attributes: { tool_call_id: 'unsupported-call' } }],
    });
    const { replay, explanation } = explanationFor([unsupported]);

    expect(JSON.stringify(replay.events)).not.toContain('runtime_activity');
    expect(explanation.activities.filter(activity => activity.kind === 'tool')).toHaveLength(0);
  });

  it('normalizes persisted interrupt activity without exposing the internal annotation', () => {
    const replay = projectReplay('canonical-mission', 'main', [], [{
      interrupt_id: 'interrupt-1',
      branch_id: 'main',
      created_at: '2026-01-01T00:00:00.000Z',
      reason: 'Approval required',
      status: 'pending',
      requested_admission_seq: 1,
    }]);
    const explanation = projectRuntimeExplanation({
      mission_id: replay.mission_id,
      branch_id: replay.branch_id,
      events: replay.events as EventEnvelope[],
    });

    expect(explanation.activities).toContainEqual(expect.objectContaining({
      id: 'human:interrupt-1',
      kind: 'human',
      status: 'waiting',
      outcome: 'Unknown',
    }));
    expect(JSON.stringify(replay.events)).not.toContain('runtime_activity');
  });

  it('uses a span fallback only once and diagnoses unsafe missing identity', () => {
    const one = span({
      operation_name: 'agent.invoke',
      attributes: {},
      events: [
        {
          name: 'gen_ai.call',
          attributes: { 'gen_ai.usage.output_tokens': 1 },
        },
      ],
    });
    const ambiguous = span({
      operation_name: 'agent.invoke',
      attributes: {},
      events: [
        {
          name: 'gen_ai.call',
          attributes: { 'gen_ai.usage.output_tokens': 1 },
        },
        {
          name: 'gen_ai.call',
          attributes: { 'gen_ai.usage.output_tokens': 2 },
        },
      ],
    });

    const oneFacts = normalizeSpansToFacts([one]);
    expect(oneFacts.activities.filter(activity => activity.kind === 'llm')).toContainEqual(
      expect.objectContaining({
        id: 'llm:span:span-1',
        invocation_id: undefined,
        identity_basis: 'span_fallback',
      }),
    );

    const ambiguousFacts = normalizeSpansToFacts([ambiguous]);
    expect(ambiguousFacts.activities.filter(activity => activity.kind === 'llm')).toHaveLength(0);
    expect(ambiguousFacts.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'ambiguous_activity_identity',
        ambiguous_activity_identity: true,
      }),
    );
    const ambiguity = ambiguousFacts.diagnostics.find(
      diagnostic => diagnostic.code === 'ambiguous_activity_identity' && diagnostic.related_sources?.length === 2,
    );
    expect(ambiguity?.related_sources?.map(source => source.event_index)).toEqual([0, 1]);
    const { explanation } = explanationFor([ambiguous]);
    expect(explanation.activities.filter(activity => activity.kind === 'llm')).toHaveLength(0);
    expect(explanation.consistency_flags).toContainEqual(
      expect.objectContaining({
        code: 'shared_span_multiple_invocations',
      }),
    );
  });

  it('produces equivalent neutral tool meaning across generic, LangGraph, and MAF evidence', () => {
    const generic = span({
      attributes: {
        'gen_ai.agent.id': 'parent-agent',
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.call.id': 'call-1',
      },
    });
    const langGraph = span({
      operation_name: 'invoke_agent',
      attributes: {
        'agent.span.kind': 'invoke_agent',
        'agentlens.langgraph.run_id': 'agent-run',
      },
      events: [
        {
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'search',
            'gen_ai.tool.status': 'success',
            'agentlens.langgraph.run_id': 'native-tool-run',
            'agentlens.langgraph.activity_correlation_id': 'call-1',
          },
        },
      ],
    });
    const maf = span({
      attributes: {
        'workflow.id': 'native-workflow',
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.call.id': 'call-1',
      },
    });

    const neutral = (spans: any[]) => {
      const activity = normalizeSpansToFacts(spans).activities.find(candidate => candidate.kind === 'tool');
      return (
        activity && {
          id: activity.id,
          kind: activity.kind,
          lifecycle: activity.lifecycle,
          outcome: activity.outcome,
          invocation_id: activity.invocation_id,
          identity_basis: activity.identity_basis,
        }
      );
    };
    expect(neutral([langGraph])).toEqual(neutral([generic]));
    expect(neutral([maf])).toEqual(neutral([generic]));

    const neutralProvenance = (spans: any[]) => {
      const activity = explanationFor(spans).explanation.activities.find(candidate => candidate.kind === 'tool');
      return activity && {
        lifecycle: {
          value: activity.status,
          basis: activity.semantic_provenance?.lifecycle.basis,
          condition: activity.semantic_provenance?.lifecycle.condition,
        },
        outcome: {
          value: activity.outcome,
          basis: activity.semantic_provenance?.outcome.basis,
          condition: activity.semantic_provenance?.outcome.condition,
        },
        action: {
          basis: activity.operator_facing_record?.action.basis,
          condition: activity.operator_facing_record?.action.condition,
        },
        target: {
          value: activity.operator_facing_record?.target.value,
          basis: activity.operator_facing_record?.target.basis,
          condition: activity.operator_facing_record?.target.condition,
        },
      };
    };
    const genericProvenance = neutralProvenance([generic])!;
    const langGraphProvenance = neutralProvenance([langGraph])!;
    const mafProvenance = neutralProvenance([maf])!;
    expect(langGraphProvenance).toEqual(genericProvenance);
    expect({ ...mafProvenance, target: genericProvenance.target }).toEqual(genericProvenance);
    expect(mafProvenance.target).toEqual({
      value: undefined,
      basis: 'unknown',
      condition: 'not_recorded',
    });
  });

  it('keeps sparse captured MAF tool evidence partial instead of forcing success', () => {
    const captured = mafFixture('agent_tool');
    const facts = normalizeSpansToFacts(captured);
    const tool = facts.activities.find(activity => activity.kind === 'tool');
    expect(tool).toMatchObject({
      lifecycle: 'completed',
      outcome: 'unknown',
      invocation_id: undefined,
      identity_basis: 'span_fallback',
    });
    const explained = explanationFor(captured).explanation.activities.find(activity => activity.kind === 'tool');
    expect(explained).toMatchObject({
      status: 'completed',
      outcome: 'Unknown',
      semantic_provenance: {
        lifecycle: { basis: 'derived', condition: 'recorded' },
        outcome: { basis: 'derived', condition: 'recorded' },
      },
      operator_facing_record: {
        target: { basis: 'recorded', condition: 'recorded' },
      },
    });
  });

  it('does not promote a typed MAF request to human activity without human evidence', () => {
    const facts = normalizeSpansToFacts(mafFixture('request'));
    const { explanation } = explanationFor(mafFixture('request'));

    expect(facts.activities.some(activity => activity.kind === 'human')).toBe(false);
    expect(explanation.activities.some(activity => activity.kind === 'human')).toBe(false);
    expect(facts.activities).toContainEqual(expect.objectContaining({
      kind: 'unknown',
      native_runtime_identity: expect.objectContaining({
        framework: 'ms_agent_framework',
        request_id: 'agentlens-reference-review-request',
      }),
    }));
  });

  it('does not let a later corrected revision change historical canonical meaning', () => {
    const revisionA = span({
      branch_id: 'main',
      admission_seq: 1,
      revision_num: 1,
      end_time_unix_nano: '0',
      status_code: 'UNSET',
      attributes: {
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.call.id': 'call-1',
      },
      events: [
        {
          name: 'agent.tool.call',
          timestamp: '120',
          attributes: {
            'gen_ai.tool.name': 'search',
            'gen_ai.tool.call.id': 'call-1',
            'gen_ai.tool.status': 'active',
          },
        },
      ],
    });
    const revisionB = span({
      ...revisionA,
      admission_seq: 2,
      revision_num: 2,
      end_time_unix_nano: '200',
      attributes: { ...revisionA.attributes, corrected: true },
      events: [
        ...revisionA.events,
        {
          name: 'agent.tool.call',
          timestamp: '180',
          attributes: {
            'gen_ai.tool.name': 'search',
            'gen_ai.tool.call.id': 'call-1',
            'gen_ai.tool.status': 'success',
          },
        },
      ],
    });

    const { replay, explanation: historical } = explanationFor([revisionA, revisionB], 1);
    const current = projectRuntimeExplanation({
      mission_id: replay.mission_id,
      branch_id: replay.branch_id,
      events: replay.events as EventEnvelope[],
      as_of_sequence_num: 2,
    });
    expect(historical.activities.find(activity => activity.kind === 'tool')).toMatchObject({
      id: 'tool:call-1',
      status: 'active',
    });
    expect(current.activities.find(activity => activity.kind === 'tool')).toMatchObject({
      id: 'tool:call-1',
      status: 'completed',
    });
    expect(historical.activities.find(activity => activity.kind === 'tool')
      ?.semantic_provenance?.lifecycle.evidence_refs.every(ref => ref.sequence_num === 1)).toBe(true);
    expect(current.activities.find(activity => activity.kind === 'tool')
      ?.semantic_provenance?.lifecycle.evidence_refs.every(ref => ref.sequence_num === 2)).toBe(true);
    expect(replay.snapshots.find(snapshot => snapshot.sequence_num === 1)?.nodes[0]?.status).toBe('active');
    expect(replay.snapshots.find(snapshot => snapshot.sequence_num === 2)?.nodes[0]?.status).toBe('completed');

    const repeated = explanationFor([revisionA, revisionB], 1);
    expect(repeated.replay).toEqual(replay);
    expect(repeated.explanation).toEqual(historical);
  });
});
