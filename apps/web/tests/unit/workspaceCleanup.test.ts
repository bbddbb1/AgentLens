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
    expect(page).toContain('Frame authority mismatch:');
    expect(page).not.toContain('const missionStatus = mission?.status');
    expect(page).not.toContain('CanvasToolbar');
    expect(page).not.toContain('hasPendingInterrupt');
    expect(page).not.toContain('currentState');
    expect(dashboard).not.toContain('DEMO_MISSIONS');
    expect(dashboard).not.toContain("id: 'demo-");
    expect(dashboard).not.toContain('E2E');
    expect(dashboard).toContain('Missions unavailable:');
  });

  it('uses the concise story and background-work contract as the Timeline source', () => {
    const timeline = workspaceFile('components/timeline/MissionTimeline.tsx');
    expect(timeline).toContain('summary?.story_activities');
    expect(timeline).toContain('summary?.background_work?.collapsed');
    expect(timeline).not.toContain('explanation?.activities ?? []');
    expect(timeline).not.toContain('recorded snapshot metadata');
  });

  it('keeps selected span evidence and optional integrity linkage in L4', () => {
    const evidence = {
      id: 'event-1',
      mission_id: 'mission-1',
      branch_id: 'main',
      sequence_num: 4,
      branch_sequence_num: 4,
      event_type: 'tool.completed',
      timestamp: '2026-07-13T00:00:00.000Z',
      span_id: 'span-1',
      trace_id: 'trace-1',
      origin_framework: 'langgraph',
      payload: { 'basestation.aiops.private': 'verbatim-l4-only' },
      metadata: {},
      content_hash: 'hash-value',
      previous_hash: 'previous-hash',
    } as EventEnvelope;
    const html = renderToStaticMarkup(createElement(RopsEvidence, { envelope: evidence }));
    expect(html).toContain('span_id');
    expect(html).toContain('origin_framework');
    expect(html).toContain('Integrity linkage');
    expect(html).toContain('content_hash');
    expect(html).toContain('hash-value');
    expect(html).toContain('previous_hash');
    expect(html).toContain('previous-hash');
    expect(html).toContain('Payload (verbatim / unrecognized)');
    expect(html).toContain('basestation.aiops.private');
    expect(html).toContain('verbatim-l4-only');
  });

  it('constrains the sidebar to Inspect and Govern', () => {
    const sidebar = workspaceFile('components/layout/RightSidebar.tsx');
    expect(sidebar).toMatch(/useState<["']inspect["'] \| ["']govern["']>/);
    expect(sidebar).not.toMatch(/["']audit["']/);
    expect(sidebar).not.toContain('Verifying ledger hash integrity');
    expect(sidebar).not.toContain('Timeline Event Context');
    expect(sidebar).toContain('hasFrameScopedCurrentState');
    expect(sidebar).toContain('Historical replay never exposes later actionable requests');
    expect(sidebar).toContain('No actionable interaction');
  });

  it('gives replay and responsive panels one accessible owner', () => {
    const replay = workspaceFile('components/replay/ReplayControls.tsx');
    const shell = workspaceFile('components/layout/WorkspaceShell.tsx');
    expect(replay).not.toContain('applySnapshot');
    expect(replay).not.toContain('currentBranchId');
    expect(replay).not.toContain('framer-motion');
    expect(replay).toContain('const canPlay = totalFrames > 1');
    expect(replay).toContain('frameLabel: hasFrames ?');
    expect(shell).toMatch(/matchMedia\(["']\(max-width: 1279px\)["']\)/);
    expect(shell).toContain('HTMLSelectElement');
    expect(shell).toContain('isContentEditable');
    expect(shell).toContain('aria-expanded={!isLeftCollapsed}');
    expect(shell).toContain('aria-expanded={!isRightCollapsed}');
  });

  it('removes abandoned workspace implementations and state', () => {
    const removed = ['components/review/ReviewPanel.tsx', 'components/runtime/RuntimeSummaryPanel.tsx', 'components/runtime/AgentNodeProjectionPanel.tsx', 'components/layout/PanelHeader.tsx', 'components/state/AgentStateCard.tsx', 'components/state/InterruptBadge.tsx', 'components/ui/CollapsibleSection.tsx', 'components/ui/GlassPanel.tsx', 'hooks/useRuntimeExplanation.ts', 'hooks/useRuntimeSummary.ts', 'stores/reviewStore.ts', 'lib/ai.ts', 'lib/crypto.ts', 'app/api/why-this-state/route.ts'];
    for (const path of removed) expect(existsSync(resolve(process.cwd(), 'src', path))).toBe(false);
    const layoutStore = workspaceFile('stores/layoutStore.ts');
    expect(layoutStore).not.toContain('activeRightTab');
    expect(layoutStore).not.toContain('isGraphFullscreen');
  });
});
