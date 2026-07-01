import type { RuntimeActivityField, RuntimeEvidenceFieldCondition } from '@agentlens/protocol';
import { safePreview, SUMMARY_IO_PREVIEW_MAX } from '@/lib/safePreview';

export function isRedactionValue(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'kind' in value &&
      (value as { kind: string }).kind === 'redaction',
  );
}

/** Human-readable evidence condition (underscores to spaces). */
export function formatEvidenceConditionLabel(condition: RuntimeEvidenceFieldCondition): string {
  return condition.replace(/_/g, ' ');
}

/** Scoped absence label for normalized activity I/O fields only. */
export function formatNormalizedIoAbsence(field: 'input' | 'output'): string {
  return field === 'input'
    ? 'no normalized input in activity record'
    : 'no normalized output in activity record';
}

export interface NormalizedIoDisplay {
  readonly text: string;
}

/**
 * Single source of truth for inspector I/O rows and timeline output badge.
 * Uses only operator_facing_record input/output — never raw metadata or envelopes.
 */
export function resolveNormalizedIoDisplay(
  recordField: RuntimeActivityField | undefined,
  field: 'input' | 'output',
): NormalizedIoDisplay {
  const condition = recordField?.condition ?? 'not_recorded';
  const value = recordField?.value;

  if (isRedactionValue(value) || condition === 'redacted') {
    return { text: 'redacted' };
  }
  if (condition === 'encrypted') return { text: 'encrypted' };
  if (condition === 'permission_denied') return { text: 'permission denied' };
  if (condition === 'oversized') return { text: 'oversized' };
  if (condition === 'recorded_empty') return { text: 'recorded empty' };

  if (value !== undefined && value !== null && condition === 'recorded') {
    return { text: safePreview(value, SUMMARY_IO_PREVIEW_MAX).text };
  }

  if (condition !== 'not_recorded') {
    return { text: formatEvidenceConditionLabel(condition) };
  }

  return { text: formatNormalizedIoAbsence(field) };
}

/** Timeline badge label for normalized output state (same authority as inspector). */
export function formatTimelineOutputBadge(recordField: RuntimeActivityField | undefined): string {
  return resolveNormalizedIoDisplay(recordField, 'output').text;
}
