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
});
