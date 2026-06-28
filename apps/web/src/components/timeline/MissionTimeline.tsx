'use client';

import { useMemo } from 'react';
import { TIMELINE_SUPPRESSED_EVENT_TYPES } from '@agentlens/protocol';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
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

import { TimelineEventCard } from './TimelineEventCard';

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
    const list = events.filter((event) => !TIMELINE_SUPPRESSED_EVENT_TYPES.has(event.event_type));
    if (!selectedNodeId) return list;
    return list.filter((event) => {
      const payload = (event.payload || {}) as Record<string, unknown>;
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
    <div className="w-full h-full flex flex-col bg-[#12131a]">
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[#e8eaf0] flex items-center gap-2">
            <Clock size={14} className="text-[#818cf8]" />
            Event Timeline
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (events.length > 0) {
                  const latestSnapshotIdx = Math.max(0, snapshots.length - 1);
                  handleFrameSelect(latestSnapshotIdx);
                }
              }}
              className="px-2 py-0.5 rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] text-[9px] uppercase tracking-wider text-[#9498b0] transition-colors"
              title="Jump to latest"
            >
              Latest
            </button>
            <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#7c83a3]">
              {currentBranchId ?? 'main'}
            </span>
          </div>
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

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-2">
          {filteredEvents.length > 0 ? filteredEvents.map((event) => {
            const snapshotIndex = snapshots.findIndex((snapshot) => snapshot.source_event_id === event.id);
            const isCurrent = snapshotIndex === currentFrame;
            return (
              <TimelineEventCard
                key={event.id}
                event={event}
                isCurrent={isCurrent}
                onSelect={() => handleFrameSelect(snapshotIndex >= 0 ? snapshotIndex : currentFrame)}
                description={snapshots[snapshotIndex]?.event_description}
              />
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
