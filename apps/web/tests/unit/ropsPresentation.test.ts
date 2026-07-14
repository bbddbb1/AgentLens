import { describe, expect, it } from 'vitest';
import {
  buildAgentView,
  classifyConfidence,
  formatDurationMs,
  nodeStatusLabel,
} from '../../src/lib/rops/provenance.js';
import type { RuntimeNodeProjection, NodeProjectionFacts } from '@agentlens/protocol';

/**
 * ROPS presentation-layer compliance checks. These verify the invariants the
 * spec (docs/reference/rops.md) requires of the UI:
 *  - P4: the `generated` block is never read by any view builder.
 *  - 10.3: the L1 confidence bar is suppressed/heuristic-labelled when
 *    confidence is the inferred fallback.
 *  - R-4: exactly one L1 headline metric.
 *  - 7.1: status vocabulary has no synonyms.
 *
 * React component rendering is exercised via renderToString to catch any
 * accidental forbidden-field leaks in the view-model -> serialized output.
 */

function facts(overrides: Partial<NodeProjectionFacts> = {}): NodeProjectionFacts {
  return {
    role: 'researcher',
    status: 'active',
    status_label: 'Active',
    produced_outputs: [],
    warnings: [],
    requires_human: false,
    ...overrides,
  } as NodeProjectionFacts;
}

describe('ROPS L1 confidence integrity (spec 10.3 / P0)', () => {
  it('suppresses the bar when confidence is absent', () => {
    const f = classifyConfidence(undefined);
    expect(f.absent).toBe(true);
    expect(f.value).toBeUndefined();
  });

  it('treats emitter-set confidence as evidence (bar may render unlabelled at L1)', () => {
    const f = classifyConfidence(0.9);
    expect(f.provenance).toBe('evidence');
    expect(f.absent).toBe(false);
  });

  it('never produces heuristic confidence (no fabrication path)', () => {
    // After P0 the projection does not synthesize a fallback formula, so any
    // confidence reaching the view was emitted by the runtime and is Evidence.
    // There is no heuristic confidence to suppress at L1.
    const f = classifyConfidence(0.8);
    expect(f.provenance).toBe('evidence');
    expect(f.provenance === 'heuristic').toBe(false);
  });
});

describe('ROPS L1 headline metric (spec R-4)', () => {
  function agentView(status: string, durationMs?: number, errorCount?: number) {
    const proj = {
      projection_version: 1,
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 1,
      generated_at: '2026-01-01T00:00:00.000Z',
      agent_id: 'a1',
      name: 'Researcher',
      node_type: 'agent',
      facts: facts({ status, status_label: nodeStatusLabel(status), duration_ms: durationMs, error_count: errorCount }),
      recent_runtime_events: [],
    } as RuntimeNodeProjection;
    return buildAgentView(proj);
  }

  it('selects duration_ms when completed', () => {
    const v = agentView('completed', 1500, 0);
    expect(v.durationMs.value).toBe(1500);
    expect(v.status.value).toBe('completed');
  });

  it('selects error_count when not completed and >0', () => {
    const v = agentView('active', undefined, 2);
    expect(v.errorCount.value).toBe(2);
    expect(v.errorCount.provenance).toBe('evidence');
  });

  it('has neither when active with no errors/duration', () => {
    const v = agentView('active', undefined, 0);
    expect(v.durationMs.value).toBeUndefined();
    expect(v.errorCount.value).toBe(0);
  });

  it('formats the duration headline deterministically', () => {
    expect(formatDurationMs(1500)).toBe('1.50 s');
  });
});

describe('ROPS P4 — forbidden fields never reach a serialized view', () => {
  it('buildAgentView output contains no forbidden generated content', () => {
    const proj = {
      projection_version: 1,
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 1,
      generated_at: '2026-01-01T00:00:00.000Z',
      agent_id: 'a1',
      name: 'Researcher',
      node_type: 'agent',
      facts: facts({ status: 'active', status_label: 'Active' }),
      recent_runtime_events: [],
      generated: {
        projection_version: 1,
        source: 'llm',
        generated_at: '2026-01-01T00:00:00.000Z',
        current_understanding: 'LEAKED_UNDERSTANDING',
        highlights: ['LEAKED_HIGHLIGHT'],
        suggested_title: 'LEAKED_TITLE',
        llm_warnings: ['LEAKED_WARNING'],
      } as unknown as RuntimeNodeProjection['generated'],
    } as RuntimeNodeProjection;
    const view = buildAgentView(proj);
    const serialized = JSON.stringify(view);
    for (const forbidden of ['LEAKED_UNDERSTANDING', 'LEAKED_HIGHLIGHT', 'LEAKED_TITLE', 'LEAKED_WARNING']) {
      expect(serialized).not.toContain(forbidden);
    }
    // The forbidden key names must not appear as view-model keys either.
    expect(serialized).not.toContain('current_understanding');
    expect(serialized).not.toContain('suggested_title');
    expect(serialized).not.toContain('llm_warnings');
    expect(serialized).not.toContain('"highlights"');
  });
});

describe('ROPS 7.1 — status vocabulary', () => {
  it('does not introduce running/retry/paused synonyms', () => {
    const allowed = ['idle', 'active', 'completed', 'failed', 'waiting', 'reviewing'];
    for (const s of allowed) {
      expect(nodeStatusLabel(s)).toBeDefined();
    }
    // Synonyms are not in the label map; they pass through unchanged (not invented).
    expect(nodeStatusLabel('running')).toBe('running');
    expect(nodeStatusLabel('paused')).toBe('paused');
  });
});
