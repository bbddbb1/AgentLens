import type { RuntimeActivity, NodeStatus } from '@agentlens/protocol';
import { formatDurationMs } from '@/lib/rops/provenance';

export interface NodeHeadlineMetric {
  display: string;
  provenance: 'evidence' | 'projection';
}

export interface NodeCardView {
  label: string;
  secondary?: string;
  status: NodeStatus;
  statusLabel: string;
  metric: NodeHeadlineMetric | null;
}

const STATUS_LABELS: Record<NodeStatus, string> = {
  idle: 'Idle',
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
  waiting: 'Waiting',
  reviewing: 'Reviewing',
  unknown: 'Unknown',
};

export const STATUS_COLORS: Record<NodeStatus, string> = {
  idle: 'var(--color-status-idle)',
  active: 'var(--color-status-active)',
  completed: 'var(--color-status-completed)',
  failed: 'var(--color-status-failed)',
  waiting: 'var(--color-status-waiting)',
  reviewing: 'var(--color-status-reviewing)',
  unknown: 'var(--color-status-idle)',
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function statusFrom(value: unknown): NodeStatus {
  return typeof value === 'string' && value in STATUS_LABELS ? (value as NodeStatus) : 'unknown';
}

function activityFrom(data: Record<string, unknown>): RuntimeActivity | undefined {
  return typeof data.activity === 'object' && data.activity !== null ? (data.activity as RuntimeActivity) : undefined;
}

function metricFor(kind: 'agent' | 'task' | 'tool', status: NodeStatus, data: Record<string, unknown>): NodeHeadlineMetric | null {
  if (kind === 'tool') return null;

  const durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? data.durationMs : undefined;
  const errorCount = typeof data.errorCount === 'number' && Number.isFinite(data.errorCount) ? data.errorCount : undefined;

  if (status === 'completed' && durationMs !== undefined) {
    return { display: formatDurationMs(durationMs), provenance: 'projection' };
  }
  if (errorCount !== undefined && errorCount > 0) {
    return {
      display: `${errorCount} error${errorCount === 1 ? '' : 's'}`,
      provenance: 'evidence',
    };
  }

  if (kind === 'task') {
    const metadata = typeof data.metadata === 'object' && data.metadata !== null ? (data.metadata as Record<string, unknown>) : {};
    const progress = typeof metadata.progress === 'number' && Number.isFinite(metadata.progress) ? Math.max(0, Math.min(100, metadata.progress)) : undefined;
    if (progress !== undefined) {
      return { display: `${Math.round(progress)}%`, provenance: 'evidence' };
    }
  }

  return null;
}

export function buildNodeCardView(kind: 'agent' | 'task' | 'tool', data: Record<string, unknown>): NodeCardView {
  const activity = activityFrom(data);
  const record = activity?.operator_facing_record;
  const fallbackLabel = nonEmptyString(data.label) ?? 'Not recorded';
  const label = nonEmptyString(record?.primary_label) ?? nonEmptyString(activity?.title) ?? fallbackLabel;
  const role = nonEmptyString(data.role);
  const action = nonEmptyString(record?.action.value) ?? nonEmptyString(activity?.action);
  const target = nonEmptyString(record?.target.value);
  const actionWithTarget = action && target ? `${action} · ${target}` : action;
  const secondary = kind === 'agent' ? (role ?? actionWithTarget) : actionWithTarget;
  const status = statusFrom(data.status ?? activity?.status);

  return {
    label,
    secondary,
    status,
    statusLabel: STATUS_LABELS[status],
    metric: metricFor(kind, status, data),
  };
}
