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
  const { currentFrame, setCurrentFrame, setIsPlaying, setSelectedEventId, selectedActivityId, setSelectedActivityId, events } = useReplayStore();

  const storyActivities = summary?.story_activities ?? [];
  const focusedActivityId = useMemo(() => resolveSelectedActivity(explanation, snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null, selectedActivityId, selectedNodeId, null)?.id ?? null, [currentFrame, explanation, selectedActivityId, selectedNodeId, snapshots]);

  const handleFrameSelect = (index: number) => {
    setCurrentFrame(index);
    setSelectedNodeId(null);
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
    <section aria-label="Timeline" className="flex h-full w-full flex-col bg-bg-secondary">
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
            <Clock size={14} className="text-text-secondary" />
            Timeline
          </h2>
          <button type="button" onClick={() => snapshots.length > 0 && handleFrameSelect(snapshots.length - 1)} disabled={snapshots.length === 0 || currentFrame === snapshots.length - 1} aria-label="Jump to latest frame" className="rounded-sm border border-border-default bg-bg-tertiary px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40">
            Latest
          </button>
        </div>
        {summary ? (
          <>
            <p className="mt-2 text-[13px] font-medium leading-snug text-text-primary">{summary.headline}</p>
            <p className="mt-1 text-[11px] text-text-muted">
              {summary.runtime_phase?.label ?? summary.phase}
              {summary.runtime_phase?.basis ? ` · ${summary.runtime_phase.basis}` : ''}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[11px] text-text-muted">Runtime story unavailable for this frame.</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-2">
          {!summary || !explanation ? (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle size={24} className="mb-3 text-text-faint" />
              <p className="text-[12px] text-text-secondary">Timeline unavailable</p>
              <p className="mt-1 text-[11px] text-text-muted">No authoritative story was produced for this frame.</p>
            </div>
          ) : storyActivities.length > 0 ? (
            storyActivities.map((activity) => <TimelineEventCard key={activity.id} activity={activity} isCurrent={activity.id === focusedActivityId} onSelect={() => handleActivitySelect(activity)} />)
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle size={24} className="mb-3 text-text-faint" />
              <p className="text-[12px] text-text-secondary">No story activities at this frame</p>
              <p className="mt-1 text-[11px] text-text-muted">Recorded evidence remains available through Graph and Inspect.</p>
            </div>
          )}
          {summary?.background_work?.collapsed && <div className="rounded-sm border border-border-subtle bg-bg-tertiary px-3 py-2 text-[11px] text-text-muted">{summary.background_work.disclosure}. Use Graph or Inspect for recorded background activity.</div>}
        </div>
      </div>
    </section>
  );
}
