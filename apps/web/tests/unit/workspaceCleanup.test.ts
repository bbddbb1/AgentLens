import { existsSync, readFileSync } from 'node:fs';
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
    const dashboard = workspaceFile('app/page.tsx');
    expect(page).not.toContain('buildDemoReplay');
    expect(page).not.toContain('E2E Encrypted');
    expect(page).not.toContain('Share');
    expect(page).not.toContain('Export');
    expect(page).not.toContain('AiAssistant');
    expect(page).not.toContain('graph fullscreen');
    expect(page).toContain('aria-label="Workspace branch"');
    expect(page).toContain('aria-label="Workspace context"');
    expect(page).toContain('const runtimeStatus = authority.status?.toLowerCase()');
    expect(page).not.toContain('const missionStatus = mission?.status');
    expect(dashboard).not.toContain('DEMO_MISSIONS');
    expect(dashboard).not.toContain("id: 'demo-");
    expect(dashboard).not.toContain('E2E');
    expect(dashboard).toContain('Missions unavailable:');
  });

  it('uses the concise story and background-work contract as the Timeline source', () => {
    const timeline = workspaceFile('components/timeline/MissionTimeline.tsx');
    expect(timeline).toContain('summary?.story_activities');
    expect(timeline).toContain('summary?.background_work?.collapsed');
    expect(timeline).not.toContain("explanation?.activities ?? []");
    expect(timeline).not.toContain('recorded snapshot metadata');
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
    expect(sidebar).toContain('actionableInterrupts.length > 0 ? <><textarea');
    expect(sidebar).toContain('No actionable interaction');
  });

  it('removes abandoned workspace implementations and state', () => {
    const removed = [
      'components/review/ReviewPanel.tsx',
      'components/runtime/RuntimeSummaryPanel.tsx',
      'stores/reviewStore.ts',
      'lib/ai.ts',
      'lib/crypto.ts',
      'app/api/why-this-state/route.ts',
    ];
    for (const path of removed) expect(existsSync(resolve(process.cwd(), 'src', path))).toBe(false);
    const layoutStore = workspaceFile('stores/layoutStore.ts');
    expect(layoutStore).not.toContain('activeRightTab');
    expect(layoutStore).not.toContain('isGraphFullscreen');
  });
});
