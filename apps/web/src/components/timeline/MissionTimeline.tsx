'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  GitCommit,
  PauseCircle,
  Play as PlayIcon,
  Shield,
  Target,
  XCircle,
} from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

const phaseConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  planning: { icon: <Target size={12} />, color: '#818cf8', label: 'Planning' },
  executing: { icon: <PlayIcon size={12} />, color: '#67e8f9', label: 'Executing' },
  reviewing: { icon: <Shield size={12} />, color: '#a78bfa', label: 'Reviewing' },
  waiting_for_human: { icon: <PauseCircle size={12} />, color: '#fbbf24', label: 'Waiting for Human' },
  completed: { icon: <CheckCircle2 size={12} />, color: '#34d399', label: 'Completed' },
  failed: { icon: <XCircle size={12} />, color: '#f87171', label: 'Failed' },
};

function eventTone(eventType: string): string {
  if (eventType.includes('interrupt')) return 'text-[#fbbf24]';
  if (eventType.includes('failed') || eventType.includes('rejected')) return 'text-[#f87171]';
  if (eventType.includes('review')) return 'text-[#34d399]';
  if (eventType.includes('delegation') || eventType.includes('handoff')) return 'text-[#818cf8]';
  return 'text-[#67e8f9]';
}

function humanizeEvent(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

function eventIconConfig(eventType: string): { icon: React.ReactNode; color: string; bg: string } {
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

export function MissionTimeline() {
  const { snapshots, selectedNodeId } = useGraphStore();
  const { currentFrame, setCurrentFrame, setIsPlaying, events, currentBranchId } = useReplayStore();

  const phases = useMemo(
    () =>
      snapshots.reduce<{ phase: string; startIdx: number; endIdx: number; count: number }[]>(
        (acc, snap, idx) => {
          const phase = snap.phase || 'executing';
          const last = acc[acc.length - 1];
          if (last && last.phase === phase) {
            last.endIdx = idx;
            last.count += 1;
          } else {
            acc.push({ phase, startIdx: idx, endIdx: idx, count: 1 });
          }
          return acc;
        },
        [],
      ),
    [snapshots],
  );

  const filteredEvents = useMemo(() => {
    if (!selectedNodeId) return events;
    return events.filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return (
        event.agent_id === selectedNodeId ||
        event.span_id === selectedNodeId ||
        payload.agent_id === selectedNodeId ||
        payload.target_agent_id === selectedNodeId ||
        payload.task_id === selectedNodeId ||
        payload.tool_id === selectedNodeId ||
        payload.interrupt_id === selectedNodeId
      );
    });
  }, [events, selectedNodeId]);

  const handleFrameSelect = (index: number) => {
    setCurrentFrame(index);
    setIsPlaying(false);
  };

  return (
    <div className="w-[280px] h-full flex flex-col bg-[#12131a] border-r border-[rgba(255,255,255,0.05)]">
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[#e8eaf0] flex items-center gap-2">
            <Clock size={14} className="text-[#818cf8]" />
            Event Timeline
          </h3>
          <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#7c83a3]">
            {currentBranchId ?? 'main'}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[#5d6180]">
          {selectedNodeId ? `Filtered to ${selectedNodeId}` : 'Replaying reducer-driven mission events'}
        </p>
      </div>

      <div className="border-b border-[rgba(255,255,255,0.05)] px-3 py-3">
        <div className="grid gap-2">
          {phases.map(({ phase, startIdx, endIdx, count }) => {
            const config = phaseConfig[phase] || phaseConfig.executing;
            const isActive = currentFrame >= startIdx && currentFrame <= endIdx;
            return (
              <button
                type="button"
                key={`${phase}-${startIdx}`}
                onClick={() => handleFrameSelect(startIdx)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'border-[rgba(129,140,248,0.18)] bg-[rgba(99,102,241,0.08)]'
                    : 'border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: `${config.color}16`, color: config.color }}
                >
                  {config.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-[#eef1fa]">{config.label}</div>
                  <div className="text-[9px] text-[#68708f]">{count} events</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2">
          {filteredEvents.length > 0 ? filteredEvents.map((event) => {
            const snapshotIndex = snapshots.findIndex((snapshot) => snapshot.source_event_id === event.id);
            const isCurrent = snapshotIndex === currentFrame;
            const iconConfig = eventIconConfig(event.event_type);
            return (
              <button
                type="button"
                key={event.id}
                onClick={() => handleFrameSelect(snapshotIndex >= 0 ? snapshotIndex : currentFrame)}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isCurrent
                    ? 'border-[rgba(103,232,249,0.2)] border-l-[3px] border-l-[#67e8f9] bg-[rgba(103,232,249,0.08)]'
                    : 'border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconConfig.bg} ${iconConfig.color}`}>
                      {iconConfig.icon}
                    </div>
                    <div className="min-w-0">
                      <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${eventTone(event.event_type)}`}>
                        {humanizeEvent(event.event_type)}
                      </div>
                      <div className="mt-1 text-[12px] leading-snug text-[#d7dbeb]">
                        {snapshots[snapshotIndex]?.event_description ?? humanizeEvent(event.event_type)}
                      </div>
                    </div>
                  </div>
                  <div className="text-[9px] text-[#7c83a3] whitespace-nowrap">
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-[#7b819f]">
                  <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] text-[#7c83a3]">
                    #{event.sequence_num}
                  </span>
                  {event.agent_id && (
                    <>
                      <Bot size={10} />
                      <span>{event.agent_id}</span>
                    </>
                  )}
                </div>
              </button>
            );
          }) : (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle size={28} className="text-[#2d2f44] mb-3" />
              <p className="text-[11px] text-[#5d6180]">No matching events</p>
              <p className="mt-1 text-[10px] text-[#3a3d54]">
                Select a different node or branch to inspect more history.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
