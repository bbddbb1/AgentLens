import { Bot, CheckCircle2, ChevronDown, ChevronUp, FileText, PauseCircle, Sparkles, UserRound, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import type { RuntimeExplanationActivity } from '@agentlens/protocol';
import { formatTimelineOutputBadge, isRedactionValue, resolveNormalizedIoDisplay } from '@/lib/rops/fieldCondition';
import { safePreview, SUMMARY_IO_PREVIEW_MAX } from '@/lib/safePreview';
import { AgentAvatar } from '@/components/common/AgentAvatar';

function statusTone(status: RuntimeExplanationActivity['status']): string {
  if (status === 'completed') return 'text-[#34d399]';
  if (status === 'failed') return 'text-[#f87171]';
  if (status === 'waiting') return 'text-[#fbbf24]';
  return 'text-[#67e8f9]';
}

function statusIcon(status: RuntimeExplanationActivity['status']): React.ReactNode {
  if (status === 'completed') return <CheckCircle2 size={12} />;
  if (status === 'failed') return <XCircle size={12} />;
  if (status === 'waiting') return <PauseCircle size={12} />;
  return <Sparkles size={12} />;
}

function activityTime(activity: RuntimeExplanationActivity): string {
  const timestamp = activity.started_at ?? activity.ended_at ?? activity.evidence_refs[0]?.timestamp;
  if (!timestamp) return 'Unknown time';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function activityTypeBadge(kind: RuntimeExplanationActivity['kind']): string {
  switch (kind) {
    case 'agent':
      return 'AGENT';
    case 'workflow':
      return 'STEP';
    case 'tool':
      return 'TOOL';
    case 'llm':
      return 'LLM';
    case 'retrieval':
      return 'SEARCH';
    case 'memory':
      return 'MEM';
    case 'artifact':
      return 'ART';
    case 'human':
      return 'HITL';
    case 'checkpoint':
      return 'CHK';
  }
}

interface TimelineEventCardProps {
  activity: RuntimeExplanationActivity;
  isCurrent: boolean;
  onSelect: () => void;
}

export function TimelineEventCard({ activity, isCurrent, onSelect }: TimelineEventCardProps) {
  const record = activity.operator_facing_record;
  const outputDisplay =
    record?.output.condition === 'recorded' &&
    record.output.value !== undefined &&
    !isRedactionValue(record.output.value)
      ? resolveNormalizedIoDisplay(record.output, 'output').text
      : undefined;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={`w-full rounded-xl border transition-colors relative ${
        isCurrent
          ? 'border-[rgba(103,232,249,0.2)] border-l-[3px] border-l-[#67e8f9] bg-[rgba(103,232,249,0.08)]'
          : 'border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.04)]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full px-3 py-2.5 text-left flex flex-col items-start gap-2"
      >
        <div className="w-full flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,255,255,0.06)] ${statusTone(activity.status)}`}>
              {statusIcon(activity.status)}
            </div>
            <div className="min-w-0">
              <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(activity.status)}`}>
                {activityTypeBadge(activity.kind)}
              </div>
              <div className="mt-1 text-[12px] leading-snug text-[#d7dbeb]">
                {record?.primary_label ?? activity.title} | {record?.action.value ?? activity.action} | {record?.status_or_outcome.value ?? activity.outcome ?? activity.status}
              </div>
            </div>
          </div>
          <div className="text-[9px] text-[#7c83a3] whitespace-nowrap">
            {activityTime(activity)}
          </div>
        </div>

        <div className="w-full mt-2 flex items-center justify-between text-[10px] text-[#7b819f]">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] text-[#7c83a3]">
              #{activity.sequence_num ?? activity.evidence_refs[0]?.sequence_num ?? 0}
            </span>
            <span className="rounded-full bg-[rgba(129,140,248,0.12)] border border-[rgba(129,140,248,0.2)] px-1.5 py-0.5 text-[9px] text-[#a5b4fc] font-bold">
              {activityTypeBadge(activity.kind)}
            </span>
            {activity.actor && (
              <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded-full text-[#c4c7da]">
                <AgentAvatar agentId={activity.actor} size="sm" className="!w-3 !h-3 !rounded-[3px]" />
                <span>{activity.actor}</span>
              </div>
            )}
            {record && record.output.condition !== 'recorded' && (
              <span className="rounded-full bg-[rgba(251,191,36,0.12)] px-2 py-0.5 text-[9px] text-[#fbbf24]">
                output: {formatTimelineOutputBadge(record.output)}
              </span>
            )}
          </div>
        </div>
      </button>

      {outputDisplay && (
        <div className="px-3 pb-2 w-full">
          <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 mt-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#9498b0] hover:text-[#e8eaf0] transition-colors"
            >
              <Bot size={12} />
              Activity Output
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 p-2 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] text-[11px] text-[#cfd3e6] leading-relaxed font-mono whitespace-pre-wrap break-words">
                    {safePreview(record!.output.value, SUMMARY_IO_PREVIEW_MAX).text}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
