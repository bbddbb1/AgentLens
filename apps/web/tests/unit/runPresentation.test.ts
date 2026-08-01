import { describe, expect, it } from 'vitest';
import type { Mission } from '@agentlens/protocol';
import { extractRunFramework, filterLoadedRuns, formatRunTimestamp, formatRunToken, presentRunStatus } from '@/lib/runPresentation';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'run-001',
    objective: 'Inspect recorded execution',
    status: 'active',
    phase: 'executing',
    created_at: '2026-07-31T12:00:00.000Z',
    updated_at: '2026-07-31T12:30:45.000Z',
    metadata: {},
    is_encrypted: false,
    visibility: 'private',
    ...overrides,
  };
}

describe('run presentation', () => {
  it.each([
    ['active', 'Active', 'active'],
    ['paused', 'Paused', 'warning'],
    ['completed', 'Completed', 'success'],
    ['failed', 'Failed', 'error'],
    ['cancelled', 'Cancelled', 'neutral'],
  ] as const)('presents the %s status without changing its meaning', (status, label, tone) => {
    expect(presentRunStatus(status)).toEqual({ label, tone });
  });

  it('preserves an unknown status instead of relabelling it as paused', () => {
    expect(presentRunStatus('waiting_external')).toEqual({
      label: 'Waiting external',
      tone: 'neutral',
    });
    expect(presentRunStatus('')).toEqual({ label: 'Unknown', tone: 'neutral' });
  });

  it('extracts only a recorded string workflow framework', () => {
    expect(
      extractRunFramework(
        mission({
          metadata: {
            resource_attributes: {
              'gen_ai.workflow.framework': 'langgraph',
            },
            framework: 'custom',
          },
        }),
      ),
    ).toBe('langgraph');
    expect(extractRunFramework(mission({ metadata: { framework: 'crewai' } }))).toBe('crewai');
  });

  it('does not infer framework from absent, non-string, or agent-only metadata', () => {
    expect(extractRunFramework(mission())).toBeNull();
    expect(extractRunFramework(mission({ metadata: { framework: { name: 'custom' } } }))).toBeNull();
    expect(
      extractRunFramework(
        mission({
          metadata: {
            resource_attributes: { 'gen_ai.agent.framework': 'langgraph' },
          },
        }),
      ),
    ).toBeNull();
  });

  it('filters loaded runs by objective or id without inventing other search fields', () => {
    const runs = [mission(), mission({ id: 'run-002', objective: 'Reconcile governance decision' })];

    expect(filterLoadedRuns(runs, 'RECORDED')).toEqual([runs[0]]);
    expect(filterLoadedRuns(runs, '  run-002  ')).toEqual([runs[1]]);
    expect(filterLoadedRuns(runs, 'langgraph')).toEqual([]);
    expect(filterLoadedRuns(runs, '   ')).toBe(runs);
  });

  it('formats full timestamps and phase tokens deterministically', () => {
    expect(formatRunTimestamp('2026-07-31T12:30:45.000Z')).toBe('2026-07-31 12:30:45 UTC');
    expect(formatRunTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatRunToken('waiting_for_human')).toBe('Waiting for human');
  });
});
