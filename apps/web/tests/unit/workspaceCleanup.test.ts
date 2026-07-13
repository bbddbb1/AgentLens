import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@agentlens/protocol';
import { RopsEvidence } from '@/components/rops/RopsEvidence';

const workspaceFile = (relativePath: string) => readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8');

describe('runtime workspace cleanup', () => {
  it('has no demo fallback or unsupported workspace controls', () => {
    const page = workspaceFile('app/missions/[id]/page.tsx');
    expect(page).not.toContain('buildDemoReplay');
    expect(page).not.toContain('E2E Encrypted');
    expect(page).not.toContain('Share');
    expect(page).not.toContain('Export');
    expect(page).not.toContain('AiAssistant');
    expect(page).toContain('aria-label="Workspace branch"');
  });

  it('keeps selected span evidence while omitting cryptographic-chain presentation', () => {
    const evidence = {
      id: 'event-1', mission_id: 'mission-1', branch_id: 'main', sequence_num: 4,
      branch_sequence_num: 4, event_type: 'tool.completed', timestamp: '2026-07-13T00:00:00.000Z',
      span_id: 'span-1', trace_id: 'trace-1', origin_framework: 'langgraph', payload: {}, metadata: {},
      content_hash: 'hash-value', previous_hash: 'previous-hash',
    } as EventEnvelope;
    const html = renderToStaticMarkup(createElement(RopsEvidence, { envelope: evidence }));
    expect(html).toContain('span_id');
    expect(html).toContain('origin_framework');
    expect(html).not.toContain('Cryptographic Linkage');
    expect(html).not.toContain('content_hash');
    expect(html).not.toContain('previous_hash');
  });

  it('constrains the sidebar to Inspect and Govern', () => {
    const sidebar = workspaceFile('components/layout/RightSidebar.tsx');
    expect(sidebar).toContain("'inspect' | 'govern'");
    expect(sidebar).not.toContain("'audit'");
    expect(sidebar).not.toContain('Verifying ledger hash integrity');
    expect(sidebar).not.toContain('Timeline Event Context');
  });
});
