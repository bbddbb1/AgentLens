'use client';

import { AlertTriangle, Clock } from 'lucide-react';
import type { RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';
import { authoritativeRuntimeStatus } from '@/lib/runtimeAuthority';

interface RuntimeSummaryPanelProps {
  serverSummary?: RuntimeSummary | null;
  serverExplanation?: RuntimeExplanationProjection | null;
}

function frameLabel(summary: RuntimeSummary, explanation: RuntimeExplanationProjection): string {
  const frame = summary.frame;
  const timestamp = frame?.as_of_timestamp ?? explanation.as_of_timestamp;
  return [
    `branch ${frame?.branch_id ?? summary.branch_id}`,
    `seq #${frame?.sequence_num ?? summary.sequence_num}`,
    timestamp ? new Date(timestamp).toISOString() : null,
    frame?.projection_version ?? explanation.projection_version,
  ].filter(Boolean).join(' | ');
}

export function RuntimeSummaryPanel({
  serverSummary = null,
  serverExplanation = null,
}: RuntimeSummaryPanelProps) {
  if (!serverSummary || !serverExplanation) {
    return (
      <div className="border-b border-[rgba(255,255,255,0.05)] px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-[#5d6180]">
          <AlertTriangle size={12} />
          <span>Run overview unavailable for this frame.</span>
        </div>
      </div>
    );
  }

  const phase = serverSummary.runtime_phase ?? serverSummary.current_phase;
  const context = serverSummary.selected_activity_state?.kind === 'selected'
    ? serverSummary.selected_activity_state.selection_basis
      ? `selected (${serverSummary.selected_activity_state.selection_basis})`
      : 'selected'
    : serverSummary.selected_activity_state?.kind === 'no_activity'
      ? 'no selectable activity'
      : 'frame overview';

  return (
    <section aria-label="Run overview" className="border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.6)] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9498b0]">
        <Clock size={13} className="text-[#818cf8]" />
        Run overview
      </div>
      <p className="mt-2 text-[13px] font-medium leading-snug text-[#eef1fa]">{serverSummary.headline}</p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#8f95b2]">
        <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">status: {authoritativeRuntimeStatus(serverSummary) ?? 'Unknown'}</span>
        <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">phase: {phase?.label ?? serverSummary.phase}</span>
        <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">context: {context}</span>
      </div>
      <p className="mt-2 text-[9px] font-mono text-[#68708f]">{frameLabel(serverSummary, serverExplanation)}</p>
    </section>
  );
}
