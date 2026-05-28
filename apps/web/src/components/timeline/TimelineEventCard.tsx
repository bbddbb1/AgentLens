import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, GitCommit, CheckCircle2, FileText, XCircle, AlertTriangle, GitBranch, ChevronDown, ChevronUp } from 'lucide-react';
import { EventEnvelope } from '@agentlens/protocol';
import { AgentAvatar } from '@/components/common/AgentAvatar';

export function eventTone(eventType: string): string {
  if (eventType.includes('interrupt')) return 'text-[#fbbf24]';
  if (eventType.includes('failed') || eventType.includes('rejected')) return 'text-[#f87171]';
  if (eventType.includes('review')) return 'text-[#34d399]';
  if (eventType.includes('delegation') || eventType.includes('handoff')) return 'text-[#818cf8]';
  return 'text-[#67e8f9]';
}

export function humanizeEvent(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

export function eventIconConfig(eventType: string): { icon: React.ReactNode; color: string; bg: string } {
  if (eventType.includes('delegation') || eventType.includes('handoff')) {
    return { icon: <GitCommit size={12} />, color: 'text-[#818cf8]', bg: 'bg-[rgba(129,140,248,0.16)]' };
  }
  if (eventType.includes('review') || eventType.includes('approved')) {
    return { icon: <CheckCircle2 size={12} />, color: 'text-[#34d399]', bg: 'bg-[rgba(52,211,153,0.16)]' };
  }
  if (eventType.includes('artifact')) {
    return { icon: <FileText size={12} />, color: 'text-[#fbbf24]', bg: 'bg-[rgba(251,191,36,0.16)]' };
  }
  if (eventType.includes('failed') || eventType.includes('rejected')) {
    return { icon: <XCircle size={12} />, color: 'text-[#f87171]', bg: 'bg-[rgba(248,113,113,0.16)]' };
  }
  if (eventType.includes('interrupt')) {
    return { icon: <AlertTriangle size={12} />, color: 'text-[#fbbf24]', bg: 'bg-[rgba(251,191,36,0.16)]' };
  }
  return { icon: <GitBranch size={12} />, color: 'text-[#67e8f9]', bg: 'bg-[rgba(103,232,249,0.16)]' };
}

interface TimelineEventCardProps {
  event: EventEnvelope;
  isCurrent: boolean;
  onSelect: () => void;
  description?: string;
}

export function TimelineEventCard({ event, isCurrent, onSelect, description }: TimelineEventCardProps) {
  const iconConfig = eventIconConfig(event.event_type);
  const payload = (event.payload as Record<string, unknown>) || {};
  const innerMonologue = typeof payload.inner_monologue === 'string' ? payload.inner_monologue : undefined;
  
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
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconConfig.bg} ${iconConfig.color}`}>
              {iconConfig.icon}
            </div>
            <div className="min-w-0">
              <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${eventTone(event.event_type)}`}>
                {humanizeEvent(event.event_type)}
              </div>
              <div className="mt-1 text-[12px] leading-snug text-[#d7dbeb]">
                {description ?? humanizeEvent(event.event_type)}
              </div>
            </div>
          </div>
          <div className="text-[9px] text-[#7c83a3] whitespace-nowrap">
            {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>

        <div className="w-full mt-2 flex items-center justify-between text-[10px] text-[#7b819f]">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] text-[#7c83a3]">
              #{event.sequence_num}
            </span>
            {event.agent_id && (
              <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded-full text-[#c4c7da]">
                <AgentAvatar agentId={event.agent_id} size="sm" className="!w-3 !h-3 !rounded-[3px]" />
                <span>{event.agent_id}</span>
              </div>
            )}
          </div>
        </div>
      </button>

      {/* Inner Monologue Expander */}
      {innerMonologue && (
        <div className="px-3 pb-2 w-full">
          <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 mt-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#9498b0] hover:text-[#e8eaf0] transition-colors"
            >
              <Bot size={12} />
              Inner Monologue
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
                    {innerMonologue}
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
