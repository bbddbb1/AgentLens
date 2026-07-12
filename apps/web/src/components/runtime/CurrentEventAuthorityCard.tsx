'use client';

import { useMemo } from 'react';
import type { RuntimeExplanationActivity, RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';
import { resolveSelectedActivity } from '@/lib/runtimeFocus';
import { selectedFrameAuthority } from '@/lib/runtimeAuthority';
import { useGraphStore, type GraphSnapshot } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

export function CurrentEventAuthorityCard({ currentSnapshot, runtimeSummary, runtimeExplanation = null, selectedActivity: selectedActivityOverride = null }: { currentSnapshot: GraphSnapshot; runtimeSummary: RuntimeSummary | null; runtimeExplanation?: RuntimeExplanationProjection | null; selectedActivity?: RuntimeExplanationActivity | null }) {
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedEventId = useReplayStore((state) => state.selectedEventId);
  const selectedActivityId = useReplayStore((state) => state.selectedActivityId);
  const selectedActivity = useMemo<RuntimeExplanationActivity | null>(() => selectedActivityOverride ?? resolveSelectedActivity(runtimeExplanation, currentSnapshot, selectedActivityId, selectedNodeId, selectedEventId), [currentSnapshot, runtimeExplanation, selectedActivityOverride, selectedActivityId, selectedEventId, selectedNodeId]);
  const authority = selectedFrameAuthority(runtimeSummary, selectedActivity);
  const authorityDisclosure = authority.incompatibilities.length > 0 ? 'selected-frame authority incompatible' : authority.status && authority.phase ? `status ${authority.status} | phase ${authority.phase.label} (${authority.phase.basis})` : 'selected-frame authority unavailable';
  const selectedActivityDisclosure = selectedActivity ? `${selectedActivity.operator_facing_record?.primary_label ?? selectedActivity.title} | ${selectedActivity.operator_facing_record?.action.value ?? selectedActivity.action} | ${selectedActivity.status}` : runtimeExplanation?.selected_activity_state?.kind === 'overview' ? 'Frame overview | no authoritative selected activity' : runtimeExplanation && runtimeExplanation.activities.length === 0 ? 'No selectable activity at this frame' : 'No authoritative selected activity';
  const incompatibilityDisclosure = authority.incompatibilities.length > 0 ? `Authority incompatibility: ${authority.incompatibilities.join('; ')}` : null;
  return <div className="absolute bottom-4 left-4 z-10 max-w-sm rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(10,11,16,0.82)] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.3)] backdrop-blur-xl"><div className="text-[10px] uppercase tracking-[0.18em] text-[#7b819f]">Current Event</div><div className="mt-1 text-[13px] font-medium text-[#eef1fa]">{currentSnapshot.event_description ?? currentSnapshot.event_type ?? 'Replay frame'}</div><div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#68708f]">Recorded event metadata</div><div className="mt-1 text-[11px] text-[#8f95b2]">{new Date(currentSnapshot.timestamp).toLocaleString()} | {authorityDisclosure}</div><div className="mt-1 text-[11px] text-[#8f95b2]">Selected activity | {selectedActivityDisclosure}</div>{incompatibilityDisclosure && <div className="mt-2 text-[11px] text-[#fbbf24]">{incompatibilityDisclosure}</div>}</div>;
}
