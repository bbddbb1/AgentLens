import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('MAF normalization architecture', () => {
  it('uses the existing span projection and keeps MAF keys out of projection code', () => {
    const projectionSource = readFileSync(resolve(root, 'src/services/runtime/projection.ts'), 'utf8');

    expect(projectionSource).not.toContain('agentlens.maf.');
    expect(readFileSync(resolve(root, '../../packages/protocol/src/types.ts'), 'utf8')).toContain(
      "SPAN_PROJECTION_VERSION = 'span_projection.v1'",
    );
  });

  it('has no public RuntimeEvidence projection model', () => {
    const exports = readFileSync(resolve(root, '../../packages/protocol/src/index.ts'), 'utf8');
    expect(exports).not.toContain('RuntimeEvidence');
  });

  it('keeps framework route policies explicit without a registry or adapter factory', () => {
    const mafRoute = readFileSync(resolve(root, 'src/routes/mafBridge.ts'), 'utf8');
    const langGraphRoute = readFileSync(resolve(root, 'src/routes/langgraphBridge.ts'), 'utf8');
    const normalization = readFileSync(resolve(root, 'src/services/runtime/normalization/normalize.ts'), 'utf8');

    expect(mafRoute).toContain('MAF_IDENTITY_POLICY');
    expect(langGraphRoute).toContain('LANGGRAPH_IDENTITY_POLICY');
    expect(langGraphRoute).not.toContain('ms_agent_framework');
    expect(normalization).not.toMatch(/registry|adapter factory|dynamic dispatch/i);
    expect(mafRoute).not.toMatch(/registry|strategy|factory|discovery/i);
  });

  it('keeps framework-specific SDK code out of the LangGraph package', () => {
    const langGraphBridge = readFileSync(resolve(root, '../../packages/sdk-langgraph/agentlens_langgraph/governance_bridge.py'), 'utf8');
    expect(langGraphBridge).not.toContain('MafGovernanceBridge');
    expect(langGraphBridge).not.toContain('ms_agent_framework');
  });
});
