'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, CircleHelp, GitBranch, PauseCircle, XCircle } from 'lucide-react';
import type { ReplayStateResponse, RuntimeExplanationV1, RuntimeSummary } from '@agentlens/protocol';
import { MissionGraph } from '@/components/graph/MissionGraph';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { StatusBar } from '@/components/layout/StatusBar';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { MissionTimeline } from '@/components/timeline/MissionTimeline';
import { api } from '@/lib/api';
import { selectedFrameAuthority } from '@/lib/runtimeAuthority';
import { runtimeExplanationFromRealtime } from '@/lib/runtimeExplanationContract';
import { matchNodeToActivity, resolveSelectedActivity } from '@/lib/runtimeFocus';
import { sequenceNumThroughFrame } from '@/lib/replayFrame';
import { shouldReloadReplayForRealtimeMessage } from '@/lib/replayRealtime';
import { useGraphStore } from '@/stores/graphStore';
import type { Mission } from '@/stores/missionStore';
import { useReplayStore } from '@/stores/replayStore';

const statusConfig = {
  active: {
    icon: <Activity size={13} />,
    className: 'text-status-active',
    label: 'Active',
  },
  completed: {
    icon: <CheckCircle2 size={13} />,
    className: 'text-status-completed',
    label: 'Completed',
  },
  failed: {
    icon: <XCircle size={13} />,
    className: 'text-status-failed',
    label: 'Failed',
  },
  paused: {
    icon: <PauseCircle size={13} />,
    className: 'text-status-waiting',
    label: 'Paused',
  },
  waiting: {
    icon: <PauseCircle size={13} />,
    className: 'text-status-waiting',
    label: 'Waiting',
  },
  unknown: {
    icon: <CircleHelp size={13} />,
    className: 'text-text-muted',
    label: 'Unknown',
  },
};

function websocketBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001').replace(/^http/, 'ws');
}

export default function MissionWorkspacePage() {
  const { setSnapshots, applySnapshot, clearWorkspace: clearGraphWorkspace, snapshots, selectedNodeId, setSelectedNodeId } = useGraphStore();
  const currentFrame = useReplayStore((state) => state.currentFrame);
  const branches = useReplayStore((state) => state.branches);
  const currentBranchId = useReplayStore((state) => state.currentBranchId);
  const events = useReplayStore((state) => state.events);
  const setReplayData = useReplayStore((state) => state.setReplayData);
  const clearReplayWorkspace = useReplayStore((state) => state.clearWorkspace);
  const selectedEventId = useReplayStore((state) => state.selectedEventId);
  const selectedActivityId = useReplayStore((state) => state.selectedActivityId);
  const setSelectedActivityId = useReplayStore((state) => state.setSelectedActivityId);
  const setSelectedEventId = useReplayStore((state) => state.setSelectedEventId);
  const setActivityContextState = useReplayStore((state) => state.setActivityContextState);
  const params = useParams<{ id?: string }>();
  const missionId = Array.isArray(params?.id) ? (params.id[0] ?? '') : (params?.id ?? '');
  const requestVersion = useRef(0);
  const [mission, setMission] = useState<Mission | null>(null);
  const [missionLoadError, setMissionLoadError] = useState<string | null>(null);
  const [isMissionLoading, setIsMissionLoading] = useState(true);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummary | null>(null);
  const [runtimeExplanation, setRuntimeExplanation] = useState<RuntimeExplanationV1 | null>(null);

  const frameSequenceNum = useMemo(() => sequenceNumThroughFrame(snapshots, events, currentFrame), [snapshots, events, currentFrame]);
  const runtimeContextReady = Boolean(missionId && currentBranchId && frameSequenceNum !== undefined);
  const activeRuntimeSummary = runtimeContextReady && runtimeSummary !== null && runtimeSummary.mission_id === missionId && runtimeSummary.branch_id === currentBranchId && runtimeSummary.sequence_num === frameSequenceNum ? runtimeSummary : null;
  const activeRuntimeExplanation = runtimeContextReady && runtimeExplanation !== null && runtimeExplanation.mission_id === missionId && runtimeExplanation.branch_id === currentBranchId && runtimeExplanation.as_of_sequence_num === frameSequenceNum ? runtimeExplanation : null;

  const clearWorkspaceContext = useCallback(() => {
    clearGraphWorkspace();
    clearReplayWorkspace();
    setRuntimeSummary(null);
    setRuntimeExplanation(null);
    setActivityContextState(null);
  }, [clearGraphWorkspace, clearReplayWorkspace, setActivityContextState]);

  const syncReplayToGraph = useCallback(
    (replay: ReplayStateResponse) => {
      // Replay snapshots are canonical frame projections. `current_state` is the
      // latest branch state and must never annotate historical frames.
      setSnapshots(replay.snapshots);
      setReplayData(replay);
    },
    [setReplayData, setSnapshots],
  );

  const loadReplay = useCallback(
    async (branchId?: string) => {
      const version = ++requestVersion.current;
      clearWorkspaceContext();
      setIsMissionLoading(true);
      if (!missionId) {
        setMission(null);
        setMissionLoadError('Mission identifier is required.');
        setIsMissionLoading(false);
        return;
      }
      try {
        const [missionData, replay] = await Promise.all([api.missions.get(missionId), api.replay.get(missionId, branchId)]);
        if (version !== requestVersion.current) return;
        setMission(missionData);
        setMissionLoadError(null);
        syncReplayToGraph(replay);
      } catch (cause) {
        if (version !== requestVersion.current) return;
        setMission(null);
        setMissionLoadError(cause instanceof Error ? cause.message : 'Failed to load mission.');
      } finally {
        if (version === requestVersion.current) setIsMissionLoading(false);
      }
    },
    [clearWorkspaceContext, missionId, syncReplayToGraph],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadReplay();
    });
    return () => {
      requestVersion.current += 1;
    };
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
      api.runtimeSummary.get(missionId, {
        branchId: currentBranchId,
        sequenceNum: frameSequenceNum,
      }),
      api.runtimeExplanation.get(missionId, {
        branchId: currentBranchId,
        sequenceNum: frameSequenceNum,
      }),
    ])
      .then(([summary, explanation]) => {
        if (!active) return;
        setRuntimeSummary(summary);
        setRuntimeExplanation(explanation);
      })
      .catch(() => {
        if (!active) return;
        setRuntimeSummary(null);
        setRuntimeExplanation(null);
      });
    return () => {
      active = false;
    };
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
    if (!selectedActivity) {
      if (selectedActivityId) setSelectedActivityId(null);
      return;
    }
    const selectedNode = matchNodeToActivity(snapshot, selectedActivity);
    const nextEventId = selectedActivity.evidence_refs[0]?.event_id ?? null;
    const nextNodeId = selectedNode?.id ?? null;
    if (selectedActivityId !== selectedActivity.id) setSelectedActivityId(selectedActivity.id);
    if (selectedEventId !== nextEventId) setSelectedEventId(nextEventId);
    if (selectedNodeId !== nextNodeId) setSelectedNodeId(nextNodeId);
  }, [activeRuntimeExplanation, currentFrame, selectedActivityId, selectedEventId, selectedNodeId, setActivityContextState, setSelectedActivityId, setSelectedEventId, setSelectedNodeId, snapshots]);

  useEffect(() => {
    if (!missionId) return;
    const ws = new WebSocket(`${websocketBaseUrl()}/ws/missions/${missionId}`);
    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as {
          type: string;
          mission?: Mission;
          runtime_summary?: unknown;
          runtime_explanation?: unknown;
          branch_id?: string;
          branch?: { id: string };
          snapshot?: { branch_id: string };
          interrupt?: { branch_id: string };
          job?: { branch_id: string };
        };
        if (message.type === 'mission.updated' && message.mission) setMission(message.mission);
        if (message.type === 'runtime.summary.updated' && (message.runtime_summary as RuntimeSummary | undefined)?.sequence_num === frameSequenceNum) setRuntimeSummary(message.runtime_summary as RuntimeSummary);
        if (message.type === 'runtime.explanation.updated') {
          const expectedBranchId = currentBranchId ?? snapshots[currentFrame]?.branch_id ?? 'main';
          const explanation = frameSequenceNum === undefined
            ? null
            : runtimeExplanationFromRealtime(message, {
                missionId,
                branchId: expectedBranchId,
                sequenceNum: frameSequenceNum,
              });
          if (explanation) setRuntimeExplanation(explanation);
        }
        if (shouldReloadReplayForRealtimeMessage(message, currentBranchId)) void loadReplay(currentBranchId ?? undefined);
      } catch {
        // Ignore malformed realtime messages.
      }
    };
    return () => ws.close();
  }, [currentBranchId, currentFrame, frameSequenceNum, loadReplay, missionId, snapshots]);

  const authority = selectedFrameAuthority(activeRuntimeSummary);
  const runtimeStatus = authority.status?.toLowerCase() ?? 'unknown';
  const statusBadge = statusConfig[runtimeStatus as keyof typeof statusConfig] ?? statusConfig.unknown;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-primary">
      <header className="z-40 flex min-h-12 items-center justify-between gap-4 border-b border-border-subtle bg-bg-primary px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="Back to runs" className="rounded-sm p-1 text-text-muted transition-colors hover:text-text-primary">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <p className="text-[11px] text-text-muted">Mission</p>
            <h1 className="max-w-xl truncate text-[13px] font-medium text-text-primary">{mission?.objective ?? (isMissionLoading ? 'Loading mission…' : 'Mission workspace')}</h1>
          </div>
          <div className={`flex items-center gap-1.5 rounded-sm border border-border-subtle px-2 py-1 text-[11px] font-medium ${statusBadge.className}`}>
            {statusBadge.icon}
            <span>{statusBadge.label}</span>
          </div>
        </div>
        <div aria-label="Workspace context" className="flex shrink-0 items-center gap-2 text-[11px] text-text-secondary">
          <GitBranch size={13} aria-hidden="true" />
          <label htmlFor="workspace-branch" className="text-text-muted">
            Branch
          </label>
          <select id="workspace-branch" aria-label="Workspace branch" value={currentBranchId ?? ''} onChange={(event) => void loadReplay(event.target.value)} disabled={branches.length === 0 || isMissionLoading} className="max-w-44 rounded-sm border border-border-default bg-bg-secondary px-2 py-1.5 text-[11px] text-text-primary disabled:cursor-not-allowed disabled:opacity-50">
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      </header>
      {authority.incompatibilities.length > 0 && (
        <div role="alert" className="flex items-start gap-2 border-b border-warning/30 bg-bg-secondary px-4 py-2 text-[11px] leading-4 text-text-secondary">
          <AlertTriangle size={14} className="mt-px shrink-0 text-warning" aria-hidden="true" />
          <span>
            <strong className="font-semibold text-warning">Frame authority mismatch:</strong> {authority.incompatibilities.join('; ')}.
          </span>
        </div>
      )}
      <WorkspaceShell
        leftPanel={<MissionTimeline explanation={activeRuntimeExplanation} summary={activeRuntimeSummary} />}
        centerPanel={
          <section aria-label="Runtime graph" className="relative flex-1 overflow-hidden">
            <MissionGraph />
            {isMissionLoading && snapshots.length === 0 && <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-primary/80 text-[12px] text-text-muted">Loading runtime…</div>}
            {missionLoadError && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-primary/90 p-6">
                <div className="max-w-md rounded-md border border-error/30 bg-bg-secondary px-5 py-4 text-center">
                  <XCircle size={18} className="mx-auto text-error" />
                  <h2 className="mt-3 text-[14px] font-semibold text-text-primary">Mission unavailable</h2>
                  <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">{missionLoadError}</p>
                  <button type="button" onClick={() => void loadReplay(currentBranchId ?? undefined)} className="mt-4 rounded-sm border border-border-default bg-bg-tertiary px-3 py-1.5 text-[11px] font-medium text-text-primary hover:bg-bg-hover">
                    Retry
                  </button>
                </div>
              </div>
            )}
          </section>
        }
        rightPanel={<RightSidebar missionId={missionId} onBranchChange={loadReplay} runtimeSummary={activeRuntimeSummary} runtimeExplanation={activeRuntimeExplanation} />}
        bottomPanel={<StatusBar />}
      />
    </div>
  );
}
