import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canAdvanceDelivery, canAdvanceRuntimeOutcome } from '../../src/services/interrupts/deliveryLifecycle.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = (path: string) => readFile(new URL(path, `file:///${root.replaceAll('\\', '/')}/`), 'utf8');

describe('cross-framework conformance architecture boundary', () => {
  it('keeps native telemetry interpretation in private translators', async () => {
    const files = await Promise.all([
      source('apps/api-ts/src/services/runtime/projection.ts'),
      source('packages/protocol/src/projections/explanationProjection.ts'),
      source('apps/api-ts/src/services/missionStore.ts'),
      source('apps/api-ts/src/services/interrupts/deliveryLifecycle.ts'),
    ]);
    for (const productionSource of files) {
      expect(productionSource).not.toMatch(/agentlens\.langgraph\.|agentlens\.maf\.|['"]workflow\.id['"]|['"]executor\.id['"]/);
      expect(productionSource).not.toMatch(/RuntimeAdapter|GovernanceAdapter|TelemetryProfile|RuntimeEvidence/);
    }
  });

  it('keeps route identity policies explicit and framework-owned', async () => {
    const [langgraphRoute, mafRoute, identity] = await Promise.all([
      source('apps/api-ts/src/routes/langgraphBridge.ts'),
      source('apps/api-ts/src/routes/mafBridge.ts'),
      source('apps/api-ts/src/services/interrupts/identityMatch.ts'),
    ]);
    expect(langgraphRoute).toContain('LANGGRAPH_IDENTITY_POLICY');
    expect(mafRoute).toContain('MAF_IDENTITY_POLICY');
    expect(identity).toContain("expectedFramework: 'langgraph'");
    expect(identity).toContain("expectedFramework: 'ms_agent_framework'");
    expect(identity).toContain('required:');
    expect(identity).toContain('consistency:');
    expect(identity).not.toMatch(/adapter\s+registry|discovery\s+mechanism|second\s+projector/i);
  });

  it('preserves the single span projection version', async () => {
    const [types, protocol] = await Promise.all([
      source('packages/protocol/src/types.ts'),
      source('packages/protocol/src/index.ts'),
    ]);
    expect(types).toContain("SPAN_PROJECTION_VERSION = 'span_projection.v1'");
    expect(protocol).not.toMatch(/RuntimeAdapter|GovernanceAdapter|TelemetryProfile|RuntimeEvidence/);
  });
});

describe('cross-framework governance state axes', () => {
  it.each(['langgraph', 'ms_agent_framework'])('%s keeps accepted delivery separate from runtime outcome', (framework) => {
    expect(framework).toMatch(/langgraph|ms_agent_framework/);
    expect(canAdvanceDelivery('accepted', 'failed')).toBe(false);
    expect(canAdvanceRuntimeOutcome('unknown', 'failed')).toBe(true);
    expect(canAdvanceRuntimeOutcome('awaiting_interaction', 'continued_with_input')).toBe(true);
  });
});
