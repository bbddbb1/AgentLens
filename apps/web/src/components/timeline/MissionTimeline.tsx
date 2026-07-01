'use client';

import { useMemo } from 'react';
import { type GraphNode, type RuntimeExplanationProjection } from '@agentlens/protocol';
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
import { focusRuntimeActivity, resolveSelectedActivity } from '@/lib/runtimeFocus';
import { TimelineEventCard } from './TimelineEventCard';

const phaseConfig: Record<string, { icon: React.ReactNode; color: string }> = {
  planning: { icon: <Target size={12} />, color: '#818cf8' },
  executing: { icon: <PlayIcon size={12} />, color: '#67e8f9' },
  reviewing: { icon: <Shield size={12} />, color: '#a78bfa' },
  waiting_for_human: { icon: <PauseCircle size={12} />, color: '#fbbf24' },
  completed: { icon: <CheckCircle2 size={12} />, color: '#34d399' },
  failed: { icon: <XCircle size={12} />, color: '#f87171' },
};

function selectedNodeForFrame(
  snapshots: readonly import('@agentlens/protocol').GraphSnapshot[],
  currentFrame: number,
  selectedNodeId: string | null,
): GraphNode | null {
  if (!selectedNodeId) return null;
  const snapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  return snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
}

function frameTuple(
  explanation: RuntimeExplanationProjection,
  currentBranchId: string | null,
): string {
  const asOfTimestamp = explanation.as_of_timestamp ? new Date(explanation.as_of_timestamp).toISOString() : 'unknown time';
  return [
    `branch ${currentBranchId ?? explanation.branch_id}`,
    `seq #${explanation.as_of_sequence_num}`,
    asOfTimestamp,
    explanation.projection_version,
  ].join(' · ');
}

export function MissionTimeline({ explanation = null }: { explanation?: RuntimeExplanationProjection | null }) {
  const { snapshots, selectedNodeId, setSelectedNodeId } = useGraphStore();
  const {
    currentFrame,
    setCurrentFrame,
    setIsPlaying,
    setSelectedEventId,
    selectedActivityId,
    setSelectedActivityId,
    events,
    currentBranchId,
  } = useReplayStore();

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

  const selectedNode = useMemo(
    () => selectedNodeForFrame(snapshots, currentFrame, selectedNodeId),
    [currentFrame, selectedNodeId, snapshots],
  );

  const activities = explanation?.activities ?? [];
  const focusedActivityId = useMemo(() => {
    return resolveSelectedActivity(
      explanation,
      snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null,
      selectedActivityId,
      selectedNodeId,
      null,
    )?.id ?? null;
  }, [currentFrame, explanation, selectedActivityId, selectedNodeId, snapshots]);

  const handleFrameSelect = (index: number) => {
    setCurrentFrame(index);
    setIsPlaying(false);
  };

  const handleActivitySelect = (activity: NonNullable<typeof activities>[number]) => {
    focusRuntimeActivity(activity, snapshots, events, {
      setSelectedEventId,
      setSelectedActivityId,
      setSelectedNodeId,
      setCurrentFrame,
    });
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#12131a]">
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[#e8eaf0] flex items-center gap-2">
            <Clock size={14} className="text-[#818cf8]" />
            Execution Timeline
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (snapshots.length > 0) {
                  handleFrameSelect(Math.max(0, snapshots.length - 1));
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
          {selectedNode
            ? `Focused on ${selectedNode.label}; the full frame context remains visible`
            : explanation
              ? 'Authoritative runtime explanation for the selected frame'
              : 'Runtime explanation unavailable'}
        </p>
        {explanation && (
          <>
            <div className="mt-2 text-[9px] uppercase tracking-[0.16em] text-[#68708f]">
              {frameTuple(explanation, currentBranchId)}
            </div>
            {explanation.runtime_phase && (
              <div className="mt-1 text-[10px] text-[#8f95b2]">
                Authoritative phase: {explanation.runtime_phase.label} ({explanation.runtime_phase.basis})
              </div>
            )}
            <div className="mt-1 text-[10px] text-[#8f95b2]">
              Activity context: {explanation.selected_activity_state?.kind === 'selected'
                ? explanation.selected_activity_state.selection_basis
                  ? `selected (${explanation.selected_activity_state.selection_basis})`
                  : 'selected'
                : explanation.selected_activity_state?.kind === 'no_activity'
                  ? 'no selectable activity'
                  : 'frame overview'}
            </div>
          </>
        )}
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
                  <div className="text-[11px] font-medium text-[#eef1fa]">
                    Frames {startIdx + 1}{endIdx > startIdx ? `-${endIdx + 1}` : ''}
                  </div>
                  <div className="text-[9px] text-[#68708f]">
                    {count} frames{phase ? ` · recorded snapshot metadata: ${phase}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-2">
          {!explanation ? (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle size={28} className="text-[#2d2f44] mb-3" />
              <p className="text-[11px] text-[#5d6180]">Runtime explanation unavailable</p>
              <p className="mt-1 text-[10px] text-[#3a3d54]">
                This frame has permitted recorded evidence only. No authoritative L1 projection was provided.
              </p>
            </div>
          ) : activities.length > 0 ? (
            activities.map((activity) => (
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
              <p className="text-[11px] text-[#5d6180]">No explanation activities at this frame</p>
              <p className="mt-1 text-[10px] text-[#3a3d54]">
                Execution meaning is absent rather than reconstructed from recorded events.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
