import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function stringLiterals(path: string): string[] {
  const source = read(path);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

const universalProjectionFiles = [
  'packages/protocol/src/projections/explanationProjection.ts',
  'packages/protocol/src/projections/summaryProjection.ts',
  'packages/protocol/src/projections/activityProjection.ts',
  'packages/protocol/src/projections/projectionScratch.ts',
];

const downstreamAuthorityFiles = [
  'apps/web/src/components/graph/MissionGraph.tsx',
  'apps/web/src/components/timeline/MissionTimeline.tsx',
  'apps/web/src/components/rops/RopsInspector.tsx',
  'apps/web/src/lib/runtimeAuthority.ts',
  'apps/web/src/lib/runtimeActivityPresentation.ts',
  'apps/web/src/lib/runtimeRelationshipPresentation.ts',
];

const frameworkPrivateVocabulary = [
  'agentlens.langgraph.',
  'agentlens.maf.',
  'langgraph',
  'ms_agent_framework',
  'crewai',
  'autogen',
  'a2a',
];

describe('R0 Runtime architecture guards', () => {
  it('keeps framework-private vocabulary out of universal projection', () => {
    for (const path of universalProjectionFiles) {
      const literals = stringLiterals(path).map((value) => value.toLowerCase());
      for (const forbidden of frameworkPrivateVocabulary) {
        expect(literals.some((value) => value.includes(forbidden)), `${path} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it('keeps downstream surfaces from becoming framework semantic authorities', () => {
    for (const path of downstreamAuthorityFiles) {
      const literals = stringLiterals(path).map((value) => value.toLowerCase());
      for (const forbidden of frameworkPrivateVocabulary) {
        expect(literals.some((value) => value.includes(forbidden)), `${path} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it('exports implementation only from the explicitly internal package subpath', () => {
    const publicIndex = read('packages/protocol/src/index.ts');
    const internalIndex = read('packages/protocol/src/internal.ts');
    expect(publicIndex).not.toContain('./projections/');
    expect(internalIndex).toContain('./projections/explanationProjection.js');
    expect(internalIndex).toContain('./projections/summaryProjection.js');
  });

  it('keeps overlap, chronology, and generic dependency out of causal authority', () => {
    const contract = read('packages/protocol/src/runtimeContract.ts');
    expect(contract).not.toContain("z.literal('parent_overlap')");
    expect(contract).not.toContain("z.literal('timing_overlap')");
    expect(contract).not.toContain("z.literal('chronology')");
    expect(contract).not.toContain("z.literal('dependency')");
  });

  it('runs CI on the actual default branch', () => {
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toContain('branches: [master]');
    expect(workflow).not.toContain('branches: [main]');
  });
});
