import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeSpansToFacts } from '../../src/services/runtime/normalization/index.js';
import { projectReplay, projectTraceSnapshot } from '../../src/services/runtime/projection.js';

type Fixture = {
  fixture_id: string;
  spans: any[];
};

type ExpectedFacts = {
  fixture_id: string;
  primary_oracle: 'native_facts';
  oracle: {
    activities?: Array<Record<string, any>>;
    relationships?: Array<Record<string, any>>;
    handoff_edges_expected?: number;
    safety?: Record<string, boolean>;
    intentional_legacy_corrections?: Array<{ id: string }>;
  };
  legacy_comparison: { authoritative: false };
};

const fixturesRoot = fileURLToPath(
  new URL('../../../../packages/sdk-langgraph/tests/fixtures/otlp/', import.meta.url),
);

async function loadFixtures(): Promise<Array<{ fixture: Fixture; expected: ExpectedFacts }>> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  return Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(async (id) => ({
    fixture: JSON.parse(await readFile(`${fixturesRoot}/${id}/spans.json`, 'utf8')) as Fixture,
    expected: JSON.parse(await readFile(`${fixturesRoot}/${id}/expected_native_facts.json`, 'utf8')) as ExpectedFacts,
  })));
}

function activityName(activity: any, spans: any[]): string | undefined {
  const span = spans.find((candidate) => candidate.span_id === activity.span_id);
  const source = activity.source_references.find((reference: any) => reference.event_name);
  const event = source?.event_index !== undefined
    ? span?.events?.[source.event_index]
    : span?.events?.find((candidate: any) => candidate.name === source?.event_name);
  const attrs = { ...(span?.attributes ?? {}), ...(event?.attributes ?? {}) };
  return activity.kind === 'agent'
    ? attrs['gen_ai.agent.name'] ?? activity.operation_name
    : attrs['gen_ai.tool.name'] ?? attrs['retrieval.backend'] ?? activity.operation_name;
}

function projectedIdentities(replay: ReturnType<typeof projectReplay>) {
  return replay.events
    .map((event) => (event.metadata as any)?.native_runtime_identity)
    .filter(Boolean);
}

function legacyComparisonReport(
  replay: ReturnType<typeof projectReplay>,
  expected: ExpectedFacts,
): { authoritative: false; differences: string[] } {
  const expectedHandoffs = expected.oracle.handoff_edges_expected;
  const actualHandoffs = replay.current_state.edges.filter((edge) => edge.type === 'delegation').length;
  return {
    authoritative: false,
    differences: expectedHandoffs === undefined || expectedHandoffs === actualHandoffs
      ? []
      : [`delegation edges: expected ${expectedHandoffs}, received ${actualHandoffs}`],
  };
}

describe('LangGraph native-fact conformance', async () => {
  const fixtures = await loadFixtures();

  it.each(fixtures)('$fixture.fixture_id satisfies its native-fact oracle', ({ fixture, expected }) => {
    expect(expected.fixture_id).toBe(fixture.fixture_id);
    expect(expected.primary_oracle).toBe('native_facts');
    expect(expected.legacy_comparison.authoritative).toBe(false);

    const facts = normalizeSpansToFacts(fixture.spans);
    const replay = projectReplay('fixture-mission', 'main', fixture.spans);
    const snapshot = projectTraceSnapshot('fixture-mission', 'main', fixture.spans);

    for (const expectedActivity of expected.oracle.activities ?? []) {
      const activity = facts.activities.find((candidate) =>
        candidate.kind === expectedActivity.kind
        && (!expectedActivity.run_id || candidate.native_runtime_identity?.run_id === expectedActivity.run_id)
        && (!expectedActivity.name || activityName(candidate, fixture.spans) === expectedActivity.name),
      );
      expect(activity, `${fixture.fixture_id} expected ${expectedActivity.kind} activity`).toBeDefined();
      expect(activity!.source_references.length).toBeGreaterThan(0);

      if (expectedActivity.outcome === 'failed') {
        expect(activity!.outcome).toBe('failure');
        expect(activity!.lifecycle).toBe('failed');
      } else if (expectedActivity.outcome) {
        expect(activity!.outcome).toBe(expectedActivity.outcome);
      }
      if (expectedActivity.never_success || expectedActivity.outcome === 'failed') {
        expect(activity!.outcome).not.toBe('success');
        expect(activity!.lifecycle).not.toBe('completed');
      }
      if (expectedActivity.framework) expect(activity!.native_runtime_identity?.framework).toBe(expectedActivity.framework);
      if (expectedActivity.thread_id) expect(activity!.native_runtime_identity?.thread_id).toBe(expectedActivity.thread_id);
      if (expectedActivity.parent_run_id) expect(activity!.native_runtime_identity?.parent_run_id).toBe(expectedActivity.parent_run_id);
      if (expectedActivity.activity_correlation_id) {
        expect(activity!.native_runtime_identity?.activity_correlation_id).toBe(expectedActivity.activity_correlation_id);
      }
      if (expectedActivity.interrupt_request_id) {
        expect(activity!.native_runtime_identity?.interrupt_request_id).toBe(expectedActivity.interrupt_request_id);
      }
      if (expectedActivity.resume_of_interrupt_id) {
        expect(activity!.native_runtime_identity?.resume_of_interrupt_id).toBe(expectedActivity.resume_of_interrupt_id);
      }
      if (expectedActivity.checkpoint_id) expect(activity!.native_runtime_identity?.checkpoint_id).toBe(expectedActivity.checkpoint_id);
      if ('checkpoint_ns' in expectedActivity) {
        expect(activity!.native_runtime_identity?.checkpoint_ns ?? '').toBe(expectedActivity.checkpoint_ns);
      }
      if (expectedActivity.checkpoint_payload_captured === false) {
        const identityJson = JSON.stringify(activity!.native_runtime_identity ?? {});
        expect(identityJson).not.toMatch(/payload|state_blob|checkpoint_state/i);
        for (const node of [...snapshot.nodes, ...replay.current_state.nodes]) {
          const meta = (node.metadata as any)?.native_runtime_identity;
          if (meta?.checkpoint_id === expectedActivity.checkpoint_id) {
            expect(JSON.stringify(meta)).not.toMatch(/payload|state_blob|checkpoint_state/i);
          }
        }
      }
      if (expectedActivity.has_native_execution_key) expect(activity!.native_runtime_identity?.native_execution_key).toBeTruthy();
      if (expectedActivity.tokens_input !== undefined) expect(activity!.token_usage?.input_tokens).toBe(expectedActivity.tokens_input);
      if (expectedActivity.tokens_output !== undefined) expect(activity!.token_usage?.output_tokens).toBe(expectedActivity.tokens_output);
      if (expectedActivity.retrieval_marker) {
        const span = fixture.spans.find((candidate) => candidate.span_id === activity!.span_id);
        const hasMarker = (span?.events ?? []).some((event: any) =>
          event.attributes?.['agentlens.langgraph.retrieval'] === 'true'
          && (!expectedActivity.run_id || event.attributes?.['agentlens.langgraph.run_id'] === expectedActivity.run_id),
        );
        expect(hasMarker).toBe(true);
        expect(activity!.kind).toBe('retrieval');
      }
      if (expectedActivity.issues_control === false || expectedActivity.issues_resume_command === false) {
        for (const identity of projectedIdentities(replay)) {
          expect(identity).not.toHaveProperty('resume_url');
          expect(identity).not.toHaveProperty('resume_token');
          expect(identity).not.toHaveProperty('control_reference');
          expect(identity).not.toHaveProperty('approval_decision');
        }
      }

      const identity = activity!.native_runtime_identity;
      if (identity?.run_id) {
        const projected = projectedIdentities(replay);
        expect(
          projected.some((candidate) => candidate.run_id === identity.run_id),
          `${fixture.fixture_id} projected surfaces must retain run_id ${identity.run_id}`,
        ).toBe(true);
      }
    }

    for (const expectedRelationship of expected.oracle.relationships ?? []) {
      const relationship = facts.relationships.find((candidate) =>
        candidate.kind === expectedRelationship.kind
        && (!expectedRelationship.resolution || candidate.resolution === expectedRelationship.resolution)
        && (!expectedRelationship.target || candidate.target_reference === expectedRelationship.target),
      );
      expect(relationship, `${fixture.fixture_id} expected ${expectedRelationship.kind} relationship`).toBeDefined();
      if (expectedRelationship.fabricate_edge === false) {
        expect(relationship!.resolution).toBe('unresolved');
        expect(snapshot.edges.filter((edge) => edge.type === 'delegation')).toHaveLength(0);
        expect(replay.current_state.edges.filter((edge) => edge.type === 'delegation')).toHaveLength(0);
        expect(facts.diagnostics.some((diagnostic) => diagnostic.code === 'unresolved_relationship')).toBe(true);
      }
    }

    const handoffEdges = snapshot.edges.filter((edge) => edge.type === 'delegation');
    if (expected.oracle.handoff_edges_expected !== undefined) {
      expect(handoffEdges).toHaveLength(expected.oracle.handoff_edges_expected);
      expect(replay.current_state.edges.filter((edge) => edge.type === 'delegation'))
        .toHaveLength(expected.oracle.handoff_edges_expected);
    }
    if (expected.oracle.safety?.failure_never_success) {
      for (const activity of facts.activities.filter((candidate) => candidate.outcome === 'failure')) {
        expect(activity.lifecycle).toBe('failed');
        const projected = replay.events.filter((event) =>
          (event.metadata as any)?.native_runtime_identity?.run_id === activity.native_runtime_identity?.run_id
          && event.event_type === 'agent.tool.call',
        );
        for (const event of projected) {
          expect((event.payload as any)?.['gen_ai.tool.status']).not.toBe('success');
        }
      }
    }
    if (expected.oracle.safety?.no_fabricated_edge || expected.oracle.safety?.overlap_does_not_create_causality) {
      expect(handoffEdges).toHaveLength(0);
    }
    if (expected.oracle.safety?.unknown_degrades_safely) {
      expect(facts.diagnostics.some((diagnostic) => diagnostic.code === 'unknown_telemetry')).toBe(true);
      expect(() => projectReplay('fixture-mission', 'main', fixture.spans)).not.toThrow();
    }

    for (const correction of expected.oracle.intentional_legacy_corrections ?? []) {
      expect(correction.id).toBe('parent_child_not_handoff');
      expect(handoffEdges).toHaveLength(0);
      expect(facts.relationships.some((relationship) => relationship.kind === 'parent_child')).toBe(true);
      expect(facts.relationships.some((relationship) => relationship.kind === 'handoff')).toBe(false);
    }

    const legacyReport = legacyComparisonReport(replay, expected);
    expect(legacyReport.authoritative).toBe(false);
  });

  it('is deterministic when equivalent spans are permuted', async () => {
    const [{ fixture }] = (await loadFixtures()).filter(({ fixture }) => fixture.fixture_id === 'tool_success');
    const forwardFacts = normalizeSpansToFacts(fixture.spans);
    const reverseFacts = normalizeSpansToFacts([...fixture.spans].reverse());
    const forwardReplay = projectReplay('fixture-mission', 'main', fixture.spans);
    const reverseReplay = projectReplay('fixture-mission', 'main', [...fixture.spans].reverse());

    expect(reverseFacts).toEqual(forwardFacts);
    expect(reverseReplay.events.map((event) => [event.id, event.event_type, event.metadata]))
      .toEqual(forwardReplay.events.map((event) => [event.id, event.event_type, event.metadata]));
    expect(reverseReplay.current_state.nodes.map((node) => [node.id, node.status, node.metadata]))
      .toEqual(forwardReplay.current_state.nodes.map((node) => [node.id, node.status, node.metadata]));
  });

  it('preserves distinct native identity for two same-name tool invocations on one span', () => {
    const spans = [{
      span_id: 'agent-span',
      trace_id: 'trace-1',
      name: 'agent:researcher',
      start_time_unix_nano: '100',
      end_time_unix_nano: '400',
      status_code: 'OK',
      attributes: {
        'gen_ai.agent.id': 'researcher',
        'gen_ai.agent.name': 'researcher',
        'gen_ai.agent.framework': 'langgraph',
        'agentlens.langgraph.run_id': 'agent-run',
      },
      events: [
        {
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'web_search',
            'gen_ai.tool.status': 'success',
            'agentlens.langgraph.run_id': 'tool-run-1',
            'agentlens.langgraph.activity_correlation_id': 'tool-run-1',
          },
        },
        {
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'web_search',
            'gen_ai.tool.status': 'success',
            'agentlens.langgraph.run_id': 'tool-run-2',
            'agentlens.langgraph.activity_correlation_id': 'tool-run-2',
          },
        },
      ],
    }];

    const facts = normalizeSpansToFacts(spans);
    const tools = facts.activities.filter((activity) => activity.kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools.map((activity) => activity.native_runtime_identity?.run_id).sort()).toEqual(['tool-run-1', 'tool-run-2']);

    const replay = projectReplay('mission', 'main', spans);
    const toolEvents = replay.events.filter((event) => event.event_type === 'agent.tool.call');
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents.map((event) => (event.metadata as any)?.native_runtime_identity?.run_id).sort())
      .toEqual(['tool-run-1', 'tool-run-2']);
  });

  it('does not mark incomplete tool start as successful even when parent span is OK', () => {
    const spans = [{
      span_id: 'agent-span',
      trace_id: 'trace-1',
      name: 'agent:researcher',
      start_time_unix_nano: '100',
      end_time_unix_nano: '400',
      status_code: 'OK',
      attributes: {
        'gen_ai.agent.framework': 'langgraph',
        'agentlens.langgraph.run_id': 'agent-run',
      },
      events: [{
        name: 'agent.tool.call',
        attributes: {
          'gen_ai.tool.name': 'web_search',
          'gen_ai.tool.status': 'active',
          'agentlens.langgraph.run_id': 'tool-run-open',
        },
      }],
    }];

    const facts = normalizeSpansToFacts(spans);
    const tool = facts.activities.find((activity) => activity.kind === 'tool');
    expect(tool).toMatchObject({ outcome: 'unknown', lifecycle: 'started' });
    expect(tool!.outcome).not.toBe('success');
    expect(tool!.lifecycle).not.toBe('completed');
  });

  it('marks tool start plus explicit error as failed and never successful', () => {
    const spans = [{
      span_id: 'agent-span',
      trace_id: 'trace-1',
      name: 'agent:researcher',
      start_time_unix_nano: '100',
      end_time_unix_nano: '400',
      status_code: 'OK',
      attributes: { 'gen_ai.agent.framework': 'langgraph' },
      events: [
        {
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'web_search',
            'gen_ai.tool.status': 'active',
            'agentlens.langgraph.run_id': 'tool-run-err',
          },
        },
        {
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'web_search',
            'gen_ai.tool.status': 'error',
            'agentlens.langgraph.run_id': 'tool-run-err',
          },
        },
      ],
    }];

    const facts = normalizeSpansToFacts(spans);
    const tool = facts.activities.find((activity) => activity.native_runtime_identity?.run_id === 'tool-run-err');
    expect(tool).toMatchObject({ outcome: 'failure', lifecycle: 'failed' });
    expect(tool!.outcome).not.toBe('success');
  });

  it('does not treat parent-child nesting as handoff', async () => {
    const [{ fixture }] = (await loadFixtures()).filter(({ fixture }) => fixture.fixture_id === 'parent_child_correlation');
    const facts = normalizeSpansToFacts(fixture.spans);
    const replay = projectReplay('mission', 'main', fixture.spans);
    expect(facts.relationships.some((relationship) => relationship.kind === 'parent_child')).toBe(true);
    expect(facts.relationships.some((relationship) => relationship.kind === 'handoff')).toBe(false);
    expect(replay.current_state.edges.filter((edge) => edge.type === 'delegation')).toHaveLength(0);
  });

  it('preserves unresolved explicit handoff diagnostics without fabricating edges', async () => {
    const [{ fixture }] = (await loadFixtures()).filter(({ fixture }) => fixture.fixture_id === 'unresolved_target');
    const facts = normalizeSpansToFacts(fixture.spans);
    const replay = projectReplay('mission', 'main', fixture.spans);
    expect(facts.relationships.some((relationship) =>
      relationship.kind === 'handoff' && relationship.resolution === 'unresolved',
    )).toBe(true);
    expect(facts.diagnostics.some((diagnostic) => diagnostic.code === 'unresolved_relationship')).toBe(true);
    expect(replay.current_state.edges.filter((edge) => edge.type === 'delegation')).toHaveLength(0);
    expect(replay.current_state.nodes.some((node) => node.label === 'missing_agent')).toBe(false);
  });
});
