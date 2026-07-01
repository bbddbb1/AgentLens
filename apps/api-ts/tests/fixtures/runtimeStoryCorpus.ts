import type { EventEnvelope } from '@agentlens/protocol';

export interface RuntimeStoryCorpusCase {
  id: 'corpus-a-bsops' | 'corpus-b-hitl' | 'corpus-c-sparse-conflict';
  label: string;
  workload: 'bsops' | 'generic-hitl' | 'sparse-conflict';
  description: string;
  expectedSignals: string[];
  events: EventEnvelope[];
}

function baseEvent(
  missionId: string,
  branchId: string,
  sequenceNum: number,
  eventType: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    id: overrides.id ?? `${missionId}-${branchId}-${sequenceNum}`,
    mission_id: missionId,
    branch_id: branchId,
    branch_sequence_num: sequenceNum,
    sequence_num: sequenceNum,
    event_type: eventType,
    timestamp: overrides.timestamp ?? `2026-06-29T00:00:${String(sequenceNum).padStart(2, '0')}.000Z`,
    payload,
    metadata: {},
    ...overrides,
  };
}

export const runtimeStoryCorpus: RuntimeStoryCorpusCase[] = [
  {
    id: 'corpus-a-bsops',
    label: 'Corpus A - BSOps update/diagnosis',
    workload: 'bsops',
    description: 'Agent run with retrieval, diagnosis tooling, and artifact output.',
    expectedSignals: ['major phases', 'tool activity', 'artifact creation', 'deterministic frame alignment'],
    events: [
      baseEvent('mission-bsops', 'main', 0, 'mission.created', { objective: 'Diagnose and update srsRAN deployment' }),
      baseEvent('mission-bsops', 'main', 1, 'agent.registered', { name: 'Planner', role: 'coordinator', 'gen_ai.agent.id': 'planner' }),
      baseEvent('mission-bsops', 'main', 2, 'task.started', { task: 'Inspect deployment state', 'gen_ai.workflow.step_id': 'inspect' }, { span_id: 'task-inspect' }),
      baseEvent('mission-bsops', 'main', 3, 'tool.called', { 'gen_ai.tool.name': 'search_logs', 'gen_ai.tool.input': 'srsran failures' }, { span_id: 'tool-search', causal: { tool_call_id: 'call-search', parent_span_id: 'task-inspect' } }),
      baseEvent('mission-bsops', 'main', 4, 'tool.completed', { 'gen_ai.tool.name': 'search_logs', 'gen_ai.tool.output': 'Found configuration drift' }, { span_id: 'tool-search', causal: { tool_call_id: 'call-search', parent_span_id: 'task-inspect' } }),
      baseEvent('mission-bsops', 'main', 5, 'artifact.created', { artifact_name: 'ops-report.md', artifact_type: 'report' }, { span_id: 'artifact-report' }),
      baseEvent('mission-bsops', 'main', 6, 'task.completed', { task: 'Inspect deployment state', 'gen_ai.workflow.step_id': 'inspect' }, { span_id: 'task-inspect' }),
    ],
  },
  {
    id: 'corpus-b-hitl',
    label: 'Corpus B - Generic HITL multi-agent',
    workload: 'generic-hitl',
    description: 'Generic run with wait/resume, memory usage, and human decision.',
    expectedSignals: ['human wait', 'resume', 'memory evidence', 'generic workload neutrality'],
    events: [
      baseEvent('mission-hitl', 'main', 0, 'mission.created', { objective: 'Prepare customer escalation response' }),
      baseEvent('mission-hitl', 'main', 1, 'agent.registered', { name: 'Responder', role: 'author', 'gen_ai.agent.id': 'responder' }),
      baseEvent('mission-hitl', 'main', 2, 'memory.written', { key: 'case-summary', value: 'Customer reports intermittent failures' }, { span_id: 'memory-1' }),
      baseEvent('mission-hitl', 'main', 3, 'interrupt.requested', { interrupt_id: 'int-1', reason: 'Need approval before sending response' }, { span_id: 'interrupt-1' }),
      baseEvent('mission-hitl', 'main', 4, 'interrupt.decision', { interrupt_id: 'int-1', decision: 'approve', comment: 'Proceed with draft' }, { span_id: 'interrupt-1' }),
      baseEvent('mission-hitl', 'main', 5, 'interrupt.resumed', { interrupt_id: 'int-1' }, { span_id: 'interrupt-1' }),
      baseEvent('mission-hitl', 'main', 6, 'artifact.created', { artifact_name: 'customer-response.md', artifact_type: 'document' }, { span_id: 'artifact-response' }),
    ],
  },
  {
    id: 'corpus-c-sparse-conflict',
    label: 'Corpus C - Sparse/conflict-heavy',
    workload: 'sparse-conflict',
    description: 'Sparse and contradictory evidence with redaction and missing lifecycle.',
    expectedSignals: ['orphan terminal', 'redaction', 'disconnected activity', 'surface incompatibility disclosure'],
    events: [
      baseEvent('mission-sparse', 'main', 0, 'mission.created', { objective: 'Investigate partial telemetry' }),
      baseEvent('mission-sparse', 'main', 1, 'tool.failed', { 'gen_ai.tool.name': 'fetch_config', reason: 'timeout' }, { span_id: 'tool-timeout', causal: { tool_call_id: 'call-timeout' } }),
      baseEvent('mission-sparse', 'main', 2, 'tool.called', { 'gen_ai.tool.name': 'fetch_secret', 'gen_ai.tool.input': 'secret-token' }, {
        span_id: 'tool-secret',
        causal: { tool_call_id: 'call-secret' },
        policy: { decision: 'redact', reason: 'credential' },
      }),
      baseEvent('mission-sparse', 'main', 3, 'artifact.created', { artifact_name: 'partial-findings.json', artifact_type: 'json' }, { id: 'artifact-disconnected' }),
    ],
  },
];

export const runtimeStoryCorpusById = new Map(runtimeStoryCorpus.map((entry) => [entry.id, entry]));
