import { Activity, CheckCircle2, Circle, Eye, PauseCircle, XCircle } from 'lucide-react';
import type { RuntimeActivity } from '@agentlens/protocol';

function statusTone(status: RuntimeActivity['status']): string {
  if (status === 'completed') return 'text-status-completed';
  if (status === 'failed') return 'text-status-failed';
  if (status === 'waiting') return 'text-status-waiting';
  if (status === 'active') return 'text-status-active';
  if (status === 'reviewing') return 'text-status-reviewing';
  return 'text-text-muted';
}

function statusIcon(status: RuntimeActivity['status']): React.ReactNode {
  if (status === 'completed') return <CheckCircle2 size={14} />;
  if (status === 'failed') return <XCircle size={14} />;
  if (status === 'waiting') return <PauseCircle size={14} />;
  if (status === 'active') return <Activity size={14} />;
  if (status === 'reviewing') return <Eye size={14} />;
  return <Circle size={14} />;
}

function statusLabel(status: RuntimeActivity['status']): string {
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'waiting') return 'Waiting';
  if (status === 'active') return 'Active';
  if (status === 'reviewing') return 'Reviewing';
  if (status === 'idle') return 'Idle';
  return 'Unknown';
}

function activityTime(activity: RuntimeActivity): string {
  if (!activity.timestamp) return 'Time unavailable';
  return new Date(activity.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface TimelineEventCardProps {
  activity: RuntimeActivity;
  isCurrent: boolean;
  onSelect: () => void;
}

export function TimelineEventCard({ activity, isCurrent, onSelect }: TimelineEventCardProps) {
  const record = activity.operator_facing_record;
  const primaryLabel = record?.primary_label ?? activity.title ?? activity.label ?? activity.action;
  const actor = record?.actor.value ?? activity.actor;
  const secondary = [activity.kind.replace(/_/g, ' '), actor].filter(Boolean).join(' · ');

  return (
    <button type="button" onClick={onSelect} aria-current={isCurrent ? 'step' : undefined} className={`w-full rounded-sm border px-3 py-2.5 text-left transition-colors ${isCurrent ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-bg-secondary hover:border-border-default hover:bg-bg-hover'}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 shrink-0 ${statusTone(activity.status)}`} aria-hidden="true">
          {statusIcon(activity.status)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium leading-snug text-text-primary">{primaryLabel}</span>
          {secondary && <span className="mt-1 block truncate text-[11px] capitalize text-text-muted">{secondary}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className={`block text-[10px] font-medium ${statusTone(activity.status)}`}>{statusLabel(activity.status)}</span>
          <time dateTime={activity.timestamp} className="mt-1 block text-[10px] tabular-nums text-text-muted">
            {activityTime(activity)}
          </time>
        </span>
      </div>
    </button>
  );
}
