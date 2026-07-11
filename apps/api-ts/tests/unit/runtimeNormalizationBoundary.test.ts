import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as protocol from '@agentlens/protocol';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fromRoot = (path: string) => new URL(path, `file:///${repositoryRoot.replaceAll('\\', '/')}/`);

async function source(path: string): Promise<string> {
  return readFile(fromRoot(path), 'utf8');
}

describe('runtime normalization boundary', () => {
  it('keeps normalized facts private to api-ts rather than protocol exports', async () => {
    const protocolIndex = await source('packages/protocol/src/index.ts');

    expect(protocol).not.toHaveProperty('normalizeSpansToFacts');
    expect(protocol).not.toHaveProperty('NormalizedRuntimeFacts');
    expect(protocolIndex).not.toContain('normalization');
    expect(protocolIndex).not.toContain('RuntimeEvidence');
  });

  it('derives normalized facts in memory without persistence writes', async () => {
    const missionStore = await source('apps/api-ts/src/services/missionStore.ts');

    expect(missionStore).not.toContain('NormalizedRuntimeFacts');
    expect(missionStore).not.toMatch(/INSERT INTO\s+(normalized_facts|runtime_evidence)/i);
    expect(missionStore).not.toMatch(/UPDATE\s+(normalized_facts|runtime_evidence)/i);
  });

  it('keeps LangGraph keys out of generic projection and explanation construction', async () => {
    const [projection, explanation] = await Promise.all([
      source('apps/api-ts/src/services/runtime/projection.ts'),
      source('packages/protocol/src/projections/explanationProjection.ts'),
    ]);

    expect(projection).toContain("normalizeSpansToFacts");
    expect(projection).not.toContain('agentlens.langgraph.');
    expect(explanation).not.toContain('agentlens.langgraph.');
  });

  it('retains one span projection without a public selector', async () => {
    const [projection, protocolIndex] = await Promise.all([
      source('apps/api-ts/src/services/runtime/projection.ts'),
      source('packages/protocol/src/index.ts'),
    ]);

    expect(projection).toContain('projectReplay');
    expect(projection).toContain('projectTraceSnapshot');
    expect(projection).not.toContain('evidence_projection.v1');
    expect(protocolIndex).not.toMatch(/projection.*selector/i);
  });
});
