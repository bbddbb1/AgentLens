import { describe, expect, it } from 'vitest';
import {
  formatNormalizedIoAbsence,
  formatTimelineOutputBadge,
  isRedactionValue,
  resolveNormalizedIoDisplay,
} from '@/lib/rops/fieldCondition';
import type { RuntimeActivityField } from '@agentlens/protocol';

describe('fieldCondition', () => {
  it('maps not_recorded to scoped activity-record absence labels', () => {
    expect(formatNormalizedIoAbsence('output')).toBe('no normalized output in activity record');
    expect(formatNormalizedIoAbsence('input')).toBe('no normalized input in activity record');
  });

  it('resolveNormalizedIoDisplay uses only operator_facing_record fields', () => {
    const absent: RuntimeActivityField = { condition: 'not_recorded', evidence_refs: [] };
    expect(resolveNormalizedIoDisplay(absent, 'output').text).toBe(
      'no normalized output in activity record',
    );

    const recorded: RuntimeActivityField = {
      condition: 'recorded',
      value: 'short output',
      evidence_refs: [],
    };
    expect(resolveNormalizedIoDisplay(recorded, 'output').text).toBe('short output');
  });

  it('safe-previews long recorded normalized output', () => {
    const long = 'x'.repeat(200);
    const recorded: RuntimeActivityField = {
      condition: 'recorded',
      value: long,
      evidence_refs: [],
    };
    const display = resolveNormalizedIoDisplay(recorded, 'output');
    expect(display.text.length).toBeLessThan(long.length);
    expect(display.text.endsWith('…')).toBe(true);
  });

  it('safe-previews structured recorded values', () => {
    const recorded: RuntimeActivityField = {
      condition: 'recorded',
      value: { hypothesis: { description: 'test', confidence: 0.9 } },
      evidence_refs: [],
    };
    const display = resolveNormalizedIoDisplay(recorded, 'output');
    expect(display.text).toContain('hypothesis');
    expect(display.text).not.toContain('\n');
  });

  it('timeline badge matches inspector normalized output display', () => {
    const absent: RuntimeActivityField = { condition: 'not_recorded', evidence_refs: [] };
    expect(formatTimelineOutputBadge(absent)).toBe(
      resolveNormalizedIoDisplay(absent, 'output').text,
    );
  });

  it('detects redaction values', () => {
    expect(isRedactionValue({ kind: 'redaction', policy_decision: 'redact' })).toBe(true);
    expect(isRedactionValue('plain')).toBe(false);
  });

  it.each([
    ['unavailable', 'unavailable'],
    ['encrypted', 'encrypted'],
    ['permission_denied', 'permission denied'],
    ['oversized', 'oversized'],
    ['absent', 'absent'],
    ['recorded_empty', 'recorded empty'],
    ['inconsistent', 'inconsistent'],
  ] as const)('preserves the %s evidence condition in presentation', (condition, expected) => {
    expect(resolveNormalizedIoDisplay({ condition, basis: 'unknown', evidence_refs: [] }, 'output').text)
      .toBe(expected);
  });
});
