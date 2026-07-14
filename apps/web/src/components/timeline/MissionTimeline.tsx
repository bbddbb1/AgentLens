'use client';

import { useMemo } from 'react';
import type { RuntimeActivity, RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';
import { AlertTriangle, Clock } from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';
import { focusRuntimeActivity, resolveSelectedActivity } from '@/lib/runtimeFocus';
import { TimelineEventCard } from './TimelineEventCard';

interface MissionTimelineProps {
  explanation?: RuntimeExplanationProjection | null;
  summary?: RuntimeSummary | null;
}

export function MissionTimeline({ explanation = null, summary = null }: MissionTimelineProps) {
  const { snapshots, selectedNodeId, setSelectedNodeId } = useGraphStore();
  const {
    currentFrame,
    setCurrentFrame,
    setIsPlaying,
    setSelectedEventId,
    selectedActivityId,
    setSelectedActivityId,
    events,
  } = useReplayStore();

  const storyActivities = summary?.story_activities ?? [];
  const focusedActivityId = useMemo(() => resolveSelectedActivity(
    explanation,
    snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null,
    selectedActivityId,
    selectedNodeId,
    null,
  )?.id ?? null, [currentFrame, explanation, selectedActivityId, selectedNodeId, snapshots]);

  const handleFrameSelect = (index: number) => {
    setCurrentFrame(index);
    setIsPlaying(false);
  };

  const handleActivitySelect = (activity: RuntimeActivity) => {
    const authoritativeActivity = explanation?.activities.find((candidate) => candidate.id === activity.id);
    if (!authoritativeActivity) return;
    focusRuntimeActivity(authoritativeActivity, snapshots, events, {
      setSelectedEventId,
      setSelectedActivityId,
      setSelectedNodeId,
      setCurrentFrame,
    });
  };

  return (
    <section aria-label="Timeline" className="w-full h-full flex flex-col bg-[#12131a]">
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-[#e8eaf0] flex items-center gap-2">
            <Clock size={14} className="text-[#818cf8]" />
            Timeline
          </h2>
          <button
            type="button"
            onClick={() => snapshots.length > 0 && handleFrameSelect(snapshots.length - 1)}
            className="px-2 py-0.5 rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] text-[9px] uppercase tracking-wider text-[#9498b0] transition-colors"
            title="Jump to latest frame"
          >
            Latest
          </button>
        </div>
        {summary ? (
          <>
            <p className="mt-2 text-[13px] font-medium leading-snug text-[#eef1fa]">{summary.headline}</p>
            <p className="mt-1 text-[10px] text-[#8f95b2]">
              {summary.runtime_phase?.label ?? summary.phase}
              {summary.runtime_phase?.basis ? ` · ${summary.runtime_phase.basis}` : ''}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[10px] text-[#5d6180]">Runtime story unavailable for this frame.</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-2">
          {!summary || !explanation ? (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle size={28} className="text-[#2d2f44] mb-3" />
              <p className="text-[11px] text-[#5d6180]">Timeline unavailable</p>
              <p className="mt-1 text-[10px] text-[#3a3d54]">No authoritative story was produced for this frame.</p>
            </div>
          ) : storyActivities.length > 0 ? (
            storyActivities.map((activity) => (
              <TimelineEventCard
                key={activity.id}
                activity={activity}
                isCurrent={activity.id === focusedActivityId}
                onSelect={() => handleActivitySelect(activity)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle size={28} className="text-[#2d2f44] mb-3" />
              <p className="text-[11px] text-[#5d6180]">No story activities at this frame</p>
              <p className="mt-1 text-[10px] text-[#3a3d54]">Recorded evidence remains available through Graph and Inspect.</p>
            </div>
          )}
          {summary?.background_work?.collapsed && (
            <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] px-3 py-2 text-[10px] text-[#7c83a3]">
              {summary.background_work.disclosure}. Use Graph or Inspect for recorded background activity.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
