'use client';

import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { STATUS_COLORS, type NodeCardView } from './nodePresentation';

interface NodeCardProps {
  view: NodeCardView;
  icon: ReactNode;
  selected: boolean;
  highlighted: boolean;
  size: 'agent' | 'task' | 'tool';
}

const SIZE_CLASSES = {
  agent: 'min-w-[176px] max-w-[216px]',
  task: 'min-w-[156px] max-w-[200px]',
  tool: 'min-w-[132px] max-w-[184px]',
};

export function NodeCard({ view, icon, selected, highlighted, size }: NodeCardProps) {
  const borderClass = selected ? 'border-accent' : highlighted ? 'border-border-strong ring-1 ring-border-strong/30' : 'border-border-subtle';

  return (
    <div aria-label={`${view.label}, ${view.statusLabel}`} title={view.label} className={`relative rounded-md border bg-bg-tertiary px-3 py-2.5 text-left ${SIZE_CLASSES[size]} ${borderClass}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="!h-1.5 !w-1.5 !rounded-full !border !border-border-strong !bg-bg-tertiary" />

      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold leading-5 text-text-primary">{view.label}</div>
          {view.secondary && <div className="mt-0.5 truncate text-[11px] leading-4 text-text-muted">{view.secondary}</div>}
          {view.limitation && <div className="mt-1 text-[10px] leading-4 text-warning">{view.limitation}</div>}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-subtle pt-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[view.status] }} aria-hidden="true" />
          {view.statusLabel}
          {view.outcomeLabel && <span className="text-text-muted">· {view.outcomeLabel}</span>}
        </span>
        {view.metric && (
          <span className="text-[11px] tabular-nums text-text-muted" title={view.metric.provenance === 'projection' ? 'Deterministic runtime projection' : 'Recorded runtime evidence'}>
            {view.metric.display}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!h-1.5 !w-1.5 !rounded-full !border !border-border-strong !bg-bg-tertiary" />
    </div>
  );
}
