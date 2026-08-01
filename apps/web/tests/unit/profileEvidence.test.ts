import { describe, expect, it } from 'vitest';
import {
  buildProfileEvidenceRows,
  packEvidence,
  type EnvelopeProvenance,
} from '@/lib/rops/provenance';
import type { NodeCorrelatedEvidence } from '@/lib/rops/nodeEvidence';

/** Build a minimal `EnvelopeProvenance` with only the model block populated. */
function mkProv(model?: EnvelopeProvenance['model']): EnvelopeProvenance {
  return {
    actorType: packEvidence<string>('actor_type', undefined),
    actorId: packEvidence<string>('actor_id', undefined),
    originFramework: packEvidence<string>('origin_framework', undefined),
    model: model ?? null,
    policy: null,
    error: null,
    causal: null,
    contentHash: packEvidence<string>('content_hash', undefined),
    previousHash: packEvidence<string>('previous_hash', undefined),
  };
}

const MODEL = {
  provider: packEvidence('model.provider', 'openai'),
  modelName: packEvidence('model.model_name', 'gpt-4o'),
  modelVersion: packEvidence<string>('model.model_version', undefined),
  tokensInput: packEvidence('model.tokens_input', 100),
  tokensOutput: packEvidence('model.tokens_output', 50),
  temperature: packEvidence('model.temperature', 0.2),
  stopReason: packEvidence('model.stop_reason', 'stop'),
};

function mkEvidence(partial: Partial<NodeCorrelatedEvidence> = {}): NodeCorrelatedEvidence {
  return {
    envelopes: [],
    toolCallEnvelope: null,
    failureEnvelope: null,
    ...partial,
  };
}

function rowValue(rows: ReturnType<typeof buildProfileEvidenceRows>['rows'], label: string) {
  const r = rows.find((x) => x.label === label);
  if (!r) throw new Error(`no row for ${label}`);
  return r.field;
}

describe('buildProfileEvidenceRows — llm profile', () => {
  it('promotes verbatim gen_ai.* attributes as Evidence', () => {
    const payload = {
      'gen_ai.system': 'openai',
      'gen_ai.request.model': 'diagnosis-v1',
      'gen_ai.usage.input_tokens': 1324,
      'gen_ai.response.finish_reason': 'stop',
      'gen_ai.agent.id': 'diagnosis',
    };
    const { rows } = buildProfileEvidenceRows('llm', payload, undefined, mkProv(MODEL));
    expect(rowValue(rows, 'gen_ai.system').value).toBe('openai');
    expect(rowValue(rows, 'gen_ai.request.model').value).toBe('diagnosis-v1');
    expect(rowValue(rows, 'gen_ai.usage.input_tokens').value).toBe(1324);
    expect(rowValue(rows, 'gen_ai.agent.id').value).toBe('diagnosis');
    // All promoted rows are Evidence (never fabricated).
    for (const r of rows) expect(r.field.provenance).toBe('evidence');
  });

  it('falls back to envelope model provenance only when the span omitted the attribute', () => {
    const payload = { 'gen_ai.system': 'openai' };
    const { rows } = buildProfileEvidenceRows('llm', payload, undefined, mkProv(MODEL));
    // Span wins:
    expect(rowValue(rows, 'gen_ai.system').value).toBe('openai');
    // Envelope fallback used (span did not emit these):
    expect(rowValue(rows, 'gen_ai.request.model').value).toBe('gpt-4o');
    expect(rowValue(rows, 'gen_ai.usage.input_tokens').value).toBe(100);
    expect(rowValue(rows, 'gen_ai.usage.output_tokens').value).toBe(50);
  });

  it('renders absent attributes as absent Evidence (not fabricated)', () => {
    const { rows } = buildProfileEvidenceRows('llm', {}, undefined, null);
    expect(rowValue(rows, 'gen_ai.system').absent).toBe(true);
    expect(rowValue(rows, 'gen_ai.system').value).toBeUndefined();
    expect(rowValue(rows, 'gen_ai.system').provenance).toBe('evidence');
  });

  it('removes consumed gen_ai.* keys from leftoverPayload (no duplication) and keeps basestation.* raw', () => {
    const payload = {
      'gen_ai.system': 'openai',
      'basestation.aiops.mission.id': 'mission-1',
      'basestation.aiops.workflow.step_name': 'diagnose',
    };
    const { leftoverPayload } = buildProfileEvidenceRows('llm', payload, undefined, null);
    expect(leftoverPayload).not.toHaveProperty('gen_ai.system');
    expect(leftoverPayload).toHaveProperty('basestation.aiops.mission.id', 'mission-1');
    expect(leftoverPayload).toHaveProperty('basestation.aiops.workflow.step_name', 'diagnose');
  });
});
describe('buildProfileEvidenceRows — tool profile', () => {
  it('surfaces tool I/O + failure from correlated evidence', () => {
    const ev = mkEvidence({
      toolName: 'execute_cmd',
      toolInput: { cmd: 'ls' },
      toolOutput: 'file.txt',
      toolStatus: 'ok',
      failureReason: undefined,
    });
    const { rows } = buildProfileEvidenceRows('tool', {}, ev, null);
    expect(rowValue(rows, 'tool_name').value).toBe('execute_cmd');
    expect(rowValue(rows, 'tool_input').value).toEqual({ cmd: 'ls' });
    expect(rowValue(rows, 'tool_output').value).toBe('file.txt');
    expect(rowValue(rows, 'tool_status').value).toBe('ok');
  });

  it('removes tool alias keys from leftoverPayload', () => {
    const payload = {
      'gen_ai.tool.name': 'execute_cmd',
      'gen_ai.tool.input': { cmd: 'ls' },
      'basestation.aiops.tool.custom': 'keep-me',
    };
    const { leftoverPayload } = buildProfileEvidenceRows('tool', payload, mkEvidence(), null);
    expect(leftoverPayload).not.toHaveProperty('gen_ai.tool.name');
    expect(leftoverPayload).not.toHaveProperty('gen_ai.tool.input');
    expect(leftoverPayload).toHaveProperty('basestation.aiops.tool.custom', 'keep-me');
  });
});

describe('buildProfileEvidenceRows — retrieval profile', () => {
  it('surfaces retrieval backend, query, result count as first-class Evidence', () => {
    const ev = mkEvidence({
      retrievalBackend: 'lancedb',
      searchQuery: 'CELL_OUT_OF_SERVICE root cause',
      resultCount: 7,
      toolInput: { raw: 'query' },
    });
    const { rows } = buildProfileEvidenceRows('retrieval', {}, ev, null);
    expect(rowValue(rows, 'retrieval.backend').value).toBe('lancedb');
    expect(rowValue(rows, 'search.query').value).toBe('CELL_OUT_OF_SERVICE root cause');
    expect(rowValue(rows, 'search.result_count').value).toBe(7);
    // Absent fields render as absent Evidence (not omitted/fabricated).
    expect(rowValue(rows, 'failure_reason').absent).toBe(true);
  });

  it('keeps basestation.aiops.retrieval.* raw (not promoted, not consumed)', () => {
    const payload = {
      'search.query': 'q',
      'basestation.aiops.retrieval.provider': 'lancedb',
      'basestation.aiops.retrieval.query': 'q',
    };
    const ev = mkEvidence({ searchQuery: 'q' });
    const { leftoverPayload } = buildProfileEvidenceRows('retrieval', payload, ev, null);
    expect(leftoverPayload).not.toHaveProperty('search.query');
    expect(leftoverPayload).toHaveProperty('basestation.aiops.retrieval.provider', 'lancedb');
    expect(leftoverPayload).toHaveProperty('basestation.aiops.retrieval.query', 'q');
  });
});

describe('buildProfileEvidenceRows — memory profile', () => {
  it('resolves memory_key/value/operation from alias keys', () => {
    const payload = {
      'gen_ai.agent.memory.key': 'cell-001',
      'gen_ai.agent.memory.value': { status: 'out_of_service' },
      'gen_ai.agent.memory.operation': 'read',
    };
    const { rows, leftoverPayload } = buildProfileEvidenceRows('memory', payload, undefined, null);
    expect(rowValue(rows, 'memory_key').value).toBe('cell-001');
    expect(rowValue(rows, 'memory_value').value).toEqual({ status: 'out_of_service' });
    expect(rowValue(rows, 'operation').value).toBe('read');
    expect(leftoverPayload).not.toHaveProperty('gen_ai.agent.memory.key');
  });

  it('falls back to short aliases when canonical keys absent', () => {
    const { rows } = buildProfileEvidenceRows('memory', { key: 'k', value: 'v' }, undefined, null);
    expect(rowValue(rows, 'memory_key').value).toBe('k');
    expect(rowValue(rows, 'memory_value').value).toBe('v');
  });
});

describe('buildProfileEvidenceRows — artifact profile', () => {
  it('resolves artifact_name/type/value from alias keys', () => {
    const payload = { artifact_name: 'report.md', artifact_type: 'markdown', value: '...' };
    const { rows, leftoverPayload } = buildProfileEvidenceRows('artifact', payload, undefined, null);
    expect(rowValue(rows, 'artifact_name').value).toBe('report.md');
    expect(rowValue(rows, 'artifact_type').value).toBe('markdown');
    expect(rowValue(rows, 'value').value).toBe('...');
    expect(leftoverPayload).not.toHaveProperty('artifact_name');
  });
});

describe('buildProfileEvidenceRows — workflow_step profile', () => {
  it('surfaces step identity from payload and failure from evidence', () => {
    const payload = {
      task: 'diagnose',
      'gen_ai.workflow.step_id': 'step-1',
      'gen_ai.agent.task.description': 'Diagnose cell outage',
      'basestation.aiops.workflow.step_name': 'diagnose',
    };
    const ev = mkEvidence({ failureReason: 'tool timeout', failureCause: 'timeout' });
    const { rows, leftoverPayload } = buildProfileEvidenceRows(
      'workflow_step',
      payload,
      ev,
      null,
    );
    expect(rowValue(rows, 'task').value).toBe('diagnose');
    expect(rowValue(rows, 'gen_ai.workflow.step_id').value).toBe('step-1');
    expect(rowValue(rows, 'gen_ai.agent.task.description').value).toBe('Diagnose cell outage');
    expect(rowValue(rows, 'failure_reason').value).toBe('tool timeout');
    expect(rowValue(rows, 'failure_cause').value).toBe('timeout');
    // basestation.* stays raw.
    expect(leftoverPayload).toHaveProperty('basestation.aiops.workflow.step_name', 'diagnose');
    expect(leftoverPayload).not.toHaveProperty('task');
  });
});

describe('buildProfileEvidenceRows — non-promoting profiles', () => {
  it.each(['mission', 'checkpoint', 'human', 'generic', 'agent'] as const)(
    'returns no rows and leaves payload untouched for profile=%s',
    (profile) => {
      const payload = { 'basestation.aiops.mission.id': 'm-1', custom: 'x' };
      const { rows, leftoverPayload } = buildProfileEvidenceRows(profile, payload, undefined, null);
      expect(rows).toEqual([]);
      expect(leftoverPayload).toEqual(payload);
    },
  );

  it('handles undefined payload without throwing', () => {
    const { rows, leftoverPayload } = buildProfileEvidenceRows('llm', undefined, undefined, null);
    expect(rows.length).toBe(8);
    expect(leftoverPayload).toBeUndefined();
  });
});
