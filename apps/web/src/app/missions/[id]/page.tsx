'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, CircleHelp, GitBranch, Loader2, PauseCircle, Telescope, XCircle } from 'lucide-react';
import type { ReplayStateResponse, RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';
import { CanvasToolbar } from '@/components/graph/CanvasToolbar';
import { MissionGraph } from '@/components/graph/MissionGraph';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { StatusBar } from '@/components/layout/StatusBar';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { MissionTimeline } from '@/components/timeline/MissionTimeline';
import { api } from '@/lib/api';
import { selectedFrameAuthority } from '@/lib/runtimeAuthority';
import { matchNodeToActivity, resolveSelectedActivity } from '@/lib/runtimeFocus';
import { sequenceNumThroughFrame } from '@/lib/replayFrame';
import { shouldReloadReplayForRealtimeMessage } from '@/lib/replayRealtime';
import { useGraphStore } from '@/stores/graphStore';
import type { Mission } from '@/stores/missionStore';
import { useReplayStore } from '@/stores/replayStore';

const statusConfig = {
  active: { icon: <Loader2 size={12} className="animate-spin" />, color: '#818cf8', label: 'Active' },
  completed: { icon: <CheckCircle2 size={12} />, color: '#34d399', label: 'Completed' },
  failed: { icon: <XCircle size={12} />, color: '#f87171', label: 'Failed' },
  paused: { icon: <PauseCircle size={12} />, color: '#fbbf24', label: 'Paused' },
  waiting: { icon: <PauseCircle size={12} />, color: '#fbbf24', label: 'Waiting' },
  unknown: { icon: <CircleHelp size={12} />, color: '#5d6180', label: 'Unknown' },
};

function websocketBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001').replace(/^http/, 'ws');
}

export default function MissionWorkspacePage() {
  const {
    setSnapshots,
    applySnapshot,
    clearWorkspace: clearGraphWorkspace,
    snapshots,
    visibleEdgeCount,
    totalEdgeCount,
    zoomBand,
    selectedNodeId,
    setSelectedNodeId,
  } = useGraphStore();
  const currentFrame = useReplayStore((state) => state.currentFrame);
  const branches = useReplayStore((state) => state.branches);
  const currentBranchId = useReplayStore((state) => state.currentBranchId);
  const currentState = useReplayStore((state) => state.currentState);
  const events = useReplayStore((state) => state.events);
  const setReplayData = useReplayStore((state) => state.setReplayData);
  const clearReplayWorkspace = useReplayStore((state) => state.clearWorkspace);
  const selectedEventId = useReplayStore((state) => state.selectedEventId);
  const selectedActivityId = useReplayStore((state) => state.selectedActivityId);
  const setSelectedActivityId = useReplayStore((state) => state.setSelectedActivityId);
  const setSelectedEventId = useReplayStore((state) => state.setSelectedEventId);
  const setActivityContextState = useReplayStore((state) => state.setActivityContextState);
  const params = useParams<{ id?: string }>();
  const missionId = Array.isArray(params?.id) ? params.id[0] ?? '' : params?.id ?? '';
  const requestVersion = useRef(0);
  const [mission, setMission] = useState<Mission | null>(null);
  const [missionLoadError, setMissionLoadError] = useState<string | null>(null);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummary | null>(null);
  const [runtimeExplanation, setRuntimeExplanation] = useState<RuntimeExplanationProjection | null>(null);

  const frameSequenceNum = useMemo(
    () => sequenceNumThroughFrame(snapshots, events, currentFrame),
    [snapshots, events, currentFrame],
  );
  const runtimeContextReady = Boolean(missionId && currentBranchId && frameSequenceNum !== undefined);
  const activeRuntimeSummary = runtimeContextReady
    && runtimeSummary !== null
    && runtimeSummary.mission_id === missionId
    && runtimeSummary.branch_id === currentBranchId
    && runtimeSummary.sequence_num === frameSequenceNum
    ? runtimeSummary
    : null;
  const activeRuntimeExplanation = runtimeContextReady
    && runtimeExplanation !== null
    && runtimeExplanation.mission_id === missionId
    && runtimeExplanation.branch_id === currentBranchId
    && runtimeExplanation.as_of_sequence_num === frameSequenceNum
    ? runtimeExplanation
    : null;

  const clearWorkspaceContext = useCallback(() => {
    clearGraphWorkspace();
    clearReplayWorkspace();
    setRuntimeSummary(null);
    setRuntimeExplanation(null);
    setActivityContextState(null);
  }, [clearGraphWorkspace, clearReplayWorkspace, setActivityContextState]);

  const syncReplayToGraph = useCallback((replay: ReplayStateResponse) => {
    const interruptsByAgent = new Map(
      Object.values(replay.current_state?.interrupts ?? {})
        .filter((interrupt) => interrupt.status === 'pending' && interrupt.agent_id)
        .map((interrupt) => [interrupt.agent_id, true]),
    );
    const snapshotsWithInterrupts = replay.snapshots.map((snapshot) => ({
      ...snapshot,
      nodes: snapshot.nodes.map((node) => ({
        ...node,
        metadata: { ...node.metadata, hasPendingInterrupt: node.agent_id ? interruptsByAgent.has(node.agent_id) : false },
      })),
    }));
    setSnapshots(snapshotsWithInterrupts);
    setReplayData(replay);
    if (snapshotsWithInterrupts[0]) applySnapshot(snapshotsWithInterrupts[0]);
  }, [applySnapshot, setReplayData, setSnapshots]);

  const loadReplay = useCallback(async (branchId?: string) => {
    const version = ++requestVersion.current;
    clearWorkspaceContext();
    if (!missionId) {
      setMission(null);
      setMissionLoadError('Mission identifier is required.');
      return;
    }
    try {
      const [missionData, replay] = await Promise.all([
        api.missions.get(missionId),
        api.replay.get(missionId, branchId),
      ]);
      if (version !== requestVersion.current) return;
      setMission(missionData);
      setMissionLoadError(null);
      syncReplayToGraph(replay);
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setMission(null);
      setMissionLoadError(cause instanceof Error ? cause.message : 'Failed to load mission.');
    }
  }, [clearWorkspaceContext, missionId, syncReplayToGraph]);

  useEffect(() => {
    queueMicrotask(() => { void loadReplay(); });
    return () => { requestVersion.current += 1; };
  }, [loadReplay]);

  useEffect(() => {
    const snapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
    if (snapshot) applySnapshot(snapshot);
  }, [applySnapshot, currentFrame, snapshots]);

  useEffect(() => {
    queueMicrotask(() => {
      setRuntimeSummary(null);
      setRuntimeExplanation(null);
      setActivityContextState(null);
    });
    if (!runtimeContextReady || !currentBranchId || frameSequenceNum === undefined) return;
    let active = true;
    void Promise.all([
      api.runtimeSummary.get(missionId, { branchId: currentBranchId, sequenceNum: frameSequenceNum }),
      api.runtimeExplanation.get(missionId, { branchId: currentBranchId, sequenceNum: frameSequenceNum }),
    ]).then(([summary, explanation]) => {
      if (!active) return;
      setRuntimeSummary(summary);
      setRuntimeExplanation(explanation);
    }).catch(() => {
      if (!active) return;
      setRuntimeSummary(null);
      setRuntimeExplanation(null);
    });
    return () => { active = false; };
  }, [currentBranchId, frameSequenceNum, missionId, runtimeContextReady, setActivityContextState]);

  useEffect(() => {
    const snapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
    if (!activeRuntimeExplanation) {
      setActivityContextState(null);
      return;
    }
    setActivityContextState(activeRuntimeExplanation.selected_activity_state ?? null);
    if (activeRuntimeExplanation.selected_activity_state?.kind === 'no_activity' || activeRuntimeExplanation.activities.length === 0) {
      setSelectedActivityId(null);
      setSelectedEventId(null);
      setSelectedNodeId(null);
      return;
    }
    const selectedActivity = resolveSelectedActivity(activeRuntimeExplanation, snapshot, selectedActivityId, selectedNodeId, selectedEventId);
    if (!selectedActivity) return;
    const selectedNode = matchNodeToActivity(snapshot, selectedActivity);
    if (selectedActivityId !== selectedActivity.id) setSelectedActivityId(selectedActivity.id);
    if (selectedActivity.evidence_refs[0]?.event_id && selectedEventId !== selectedActivity.evidence_refs[0].event_id) setSelectedEventId(selectedActivity.evidence_refs[0].event_id);
    if (selectedNode?.id && selectedNodeId !== selectedNode.id) setSelectedNodeId(selectedNode.id);
  }, [activeRuntimeExplanation, currentFrame, selectedActivityId, selectedEventId, selectedNodeId, setActivityContextState, setSelectedActivityId, setSelectedEventId, setSelectedNodeId, snapshots]);

  useEffect(() => {
    if (!missionId) return;
    const ws = new WebSocket(`${websocketBaseUrl()}/ws/missions/${missionId}`);
    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as { type: string; mission?: Mission; runtime_summary?: unknown; runtime_explanation?: unknown; branch_id?: string; branch?: { id: string }; snapshot?: { branch_id: string }; interrupt?: { branch_id: string }; job?: { branch_id: string } };
        if (message.type === 'mission.updated' && message.mission) setMission(message.mission);
        if (message.type === 'runtime.summary.updated' && (message.runtime_summary as RuntimeSummary | undefined)?.sequence_num === frameSequenceNum) setRuntimeSummary(message.runtime_summary as RuntimeSummary);
        if (message.type === 'runtime.explanation.updated' && (message.runtime_explanation as RuntimeExplanationProjection | undefined)?.as_of_sequence_num === frameSequenceNum) setRuntimeExplanation(message.runtime_explanation as RuntimeExplanationProjection);
        if (shouldReloadReplayForRealtimeMessage(message, currentBranchId)) void loadReplay(currentBranchId ?? undefined);
      } catch {
        // Ignore malformed realtime messages.
      }
    };
    return () => ws.close();
  }, [currentBranchId, frameSequenceNum, loadReplay, missionId]);

  const authority = selectedFrameAuthority(activeRuntimeSummary);
  const runtimeStatus = authority.status?.toLowerCase() ?? 'unknown';
  const statusBadge = statusConfig[runtimeStatus as keyof typeof statusConfig] ?? statusConfig.unknown;
  const frameTimestamp = activeRuntimeExplanation?.as_of_timestamp
    ?? snapshots[currentFrame]?.timestamp
    ?? null;
  return (
    <div className="h-screen flex flex-col bg-[#0a0b10] overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.9)] backdrop-blur-xl z-40">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/" aria-label="Back to missions" className="flex items-center gap-2 text-[#5d6180] hover:text-[#9498b0] transition-colors"><ArrowLeft size={16} /></Link>
          <div className="flex items-center gap-2"><Telescope size={18} className="text-[#818cf8]" /><span className="text-[14px] font-bold gradient-text">AgentLens</span></div>
          <div className="h-4 w-px bg-[rgba(255,255,255,0.08)]" />
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `${statusBadge.color}15`, color: statusBadge.color }}>{statusBadge.icon}{statusBadge.label}</div>
            <h1 className="text-[13px] font-medium text-[#e8eaf0] max-w-md truncate">{mission?.objective ?? 'Mission workspace'}</h1>
          </div>
          <div aria-label="Workspace context" className="flex items-center gap-2 text-[10px] text-[#8f95b2]">
            <label className="flex items-center gap-1.5">
            <GitBranch size={12} className="text-[#67e8f9]" />
            <span className="sr-only">Workspace branch</span>
            <select aria-label="Workspace branch" value={currentBranchId ?? ''} onChange={(event) => void loadReplay(event.target.value)} disabled={!currentBranchId} className="max-w-40 rounded border border-[rgba(255,255,255,0.08)] bg-[#12131a] px-2 py-1 text-[10px] text-[#d8dbef] disabled:opacity-50">
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            </label>
            {snapshots.length > 0 && <span>frame {Math.min(currentFrame + 1, snapshots.length)}/{snapshots.length}</span>}
            {frameSequenceNum !== undefined && <span className="font-mono text-[#7c83a3]">seq #{frameSequenceNum}</span>}
            {frameTimestamp && <time className="font-mono text-[#5d6180]" dateTime={frameTimestamp}>{new Date(frameTimestamp).toISOString()}</time>}
          </div>
        </div>
      </header>
      <WorkspaceShell
        leftPanel={<MissionTimeline explanation={activeRuntimeExplanation} summary={activeRuntimeSummary} />}
        centerPanel={<section aria-label="Graph" className="relative flex-1 overflow-hidden"><CanvasToolbar agentCount={Object.keys(currentState?.agents ?? {}).length} /><MissionGraph />{missionLoadError && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(10,11,16,0.72)] backdrop-blur-sm p-6"><div className="max-w-md rounded-2xl border border-[rgba(248,113,113,0.18)] bg-[rgba(36,17,20,0.92)] px-5 py-4 text-center shadow-[0_24px_64px_rgba(0,0,0,0.4)]"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(248,113,113,0.12)] text-[#f87171]"><XCircle size={18} /></div><h2 className="text-[14px] font-semibold text-[#f3d0d0]">Mission unavailable</h2><p className="mt-2 text-[12px] leading-relaxed text-[#d8b4b4]">{missionLoadError}</p></div></div>}</section>}
        rightPanel={<RightSidebar missionId={missionId} onBranchChange={loadReplay} runtimeSummary={activeRuntimeSummary} />}
        bottomPanel={<StatusBar metrics={<div className="flex items-center gap-3 text-[10px]"><span className="text-[#5d6180] capitalize">{zoomBand} view</span><span className={totalEdgeCount > 0 && visibleEdgeCount / totalEdgeCount < 0.3 ? 'text-[#fbbf24]' : 'text-[#9498b0]'}>{visibleEdgeCount} / {totalEdgeCount} edges visible</span>{authority.incompatibilities.length > 0 && <span className="text-[#fbbf24]">frame authority mismatch</span>}</div>} />}
      />
    </div>
  );
}
