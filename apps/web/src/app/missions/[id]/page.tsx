'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SPAN_PROJECTION_VERSION } from '@agentlens/protocol';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  PauseCircle,
  Share2,
  Telescope,
  XCircle,
} from 'lucide-react';
import type {
  RuntimeExplanationActivity,
  MissionEventRecord,
  ReplayBranch,
  ReplayStateResponse,
  RuntimeExplanationProjection,
  RuntimeState,
  RuntimeSummary,
} from '@agentlens/protocol';
import { AiAssistant } from '@/components/ai/AiAssistant';
import { CanvasToolbar } from '@/components/graph/CanvasToolbar';
import { MissionGraph } from '@/components/graph/MissionGraph';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { MissionTimeline } from '@/components/timeline/MissionTimeline';
import { RuntimeSummaryPanel } from '@/components/runtime/RuntimeSummaryPanel';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { StatusBar } from '@/components/layout/StatusBar';
import { useLayoutStore } from '@/stores/layoutStore';
import { api } from '@/lib/api';
import { matchNodeToActivity, resolveSelectedActivity } from '@/lib/runtimeFocus';
import { sequenceNumThroughFrame } from '@/lib/replayFrame';
import { selectedFrameAuthority } from '@/lib/runtimeAuthority';
import { shouldReloadReplayForRealtimeMessage } from '@/lib/replayRealtime';
import { useGraphStore, type GraphSnapshot } from '@/stores/graphStore';
import type { Mission } from '@/stores/missionStore';
import { useReplayStore } from '@/stores/replayStore';

function websocketBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
  return apiUrl.replace(/^http/, 'ws');
}

function buildDemoReplay(): ReplayStateResponse {
  const snapshots: GraphSnapshot[] = [
    {
      id: 'snap-1',
      mission_id: 'demo-mission',
      branch_id: 'main',
      sequence_num: 0,
      timestamp: new Date(Date.now() - 300000).toISOString(),
      event_type: 'task.started',
      event_description: 'Planner initialized and began decomposing the mission.',
      source_event_id: 'event-1',
      source_event_sequence_num: 0,
      phase: 'planning',
      nodes: [
        {
          id: 'planner',
          type: 'agent',
          label: 'Planner',
          status: 'active',
          position: { x: 300, y: 0 },
          agent_id: 'planner',
          agent_role: 'planner',
          agent_team: 'Core',
          confidence: 0.95,
          summary: 'Decomposing objective into subtasks',
        },
      ],
      edges: [],
    },
    {
      id: 'snap-2',
      mission_id: 'demo-mission',
      branch_id: 'main',
      sequence_num: 1,
      timestamp: new Date(Date.now() - 240000).toISOString(),
      event_type: 'delegation',
      event_description: 'Planner delegated parallel work to Researcher and Writer.',
      source_event_id: 'event-2',
      source_event_sequence_num: 1,
      phase: 'executing',
      nodes: [
        {
          id: 'planner',
          type: 'agent',
          label: 'Planner',
          status: 'completed',
          position: { x: 300, y: 0 },
          agent_id: 'planner',
          agent_role: 'planner',
          agent_team: 'Core',
          confidence: 0.95,
          summary: 'Plan created: 3 research tasks, 1 writing task',
        },
        {
          id: 'researcher',
          type: 'agent',
          label: 'Researcher',
          status: 'active',
          position: { x: 100, y: 180 },
          agent_id: 'researcher',
          agent_role: 'researcher',
          agent_team: 'Research',
          confidence: 0.82,
          summary: 'Gathering data from multiple sources',
        },
        {
          id: 'writer',
          type: 'agent',
          label: 'Writer',
          status: 'waiting',
          position: { x: 500, y: 180 },
          agent_id: 'writer',
          agent_role: 'writer',
          agent_team: 'Content',
          confidence: 0.78,
          summary: 'Awaiting research results',
        },
      ],
      edges: [
        { id: 'e-1', source: 'planner', target: 'researcher', type: 'delegation', label: 'delegates research', status: 'active', animated: true },
        { id: 'e-2', source: 'planner', target: 'writer', type: 'delegation', label: 'delegates writing', status: 'pending' },
      ],
    },
    {
      id: 'snap-3',
      mission_id: 'demo-mission',
      branch_id: 'main',
      sequence_num: 2,
      timestamp: new Date(Date.now() - 180000).toISOString(),
      event_type: 'tool.called',
      event_description: 'Researcher invoked search and analysis tools to expand evidence.',
      source_event_id: 'event-3',
      source_event_sequence_num: 2,
      phase: 'executing',
      nodes: [
        {
          id: 'planner',
          type: 'agent',
          label: 'Planner',
          status: 'completed',
          position: { x: 300, y: 0 },
          agent_id: 'planner',
          agent_role: 'planner',
          agent_team: 'Core',
          confidence: 0.95,
        },
        {
          id: 'researcher',
          type: 'agent',
          label: 'Researcher',
          status: 'active',
          position: { x: 100, y: 180 },
          agent_id: 'researcher',
          agent_role: 'researcher',
          agent_team: 'Research',
          confidence: 0.88,
          summary: 'Analyzing 12 data sources',
        },
        {
          id: 'writer',
          type: 'agent',
          label: 'Writer',
          status: 'waiting',
          position: { x: 500, y: 180 },
          agent_id: 'writer',
          agent_role: 'writer',
          agent_team: 'Content',
          confidence: 0.78,
        },
        { id: 'tool-search', type: 'tool', label: 'Web Search', status: 'completed', position: { x: 0, y: 350 } },
        { id: 'tool-analysis', type: 'tool', label: 'Data Analysis', status: 'active', position: { x: 200, y: 350 } },
        { id: 'mem-findings', type: 'memory', label: 'Research Findings', status: 'active', position: { x: 400, y: 350 } },
      ],
      edges: [
        { id: 'e-1', source: 'planner', target: 'researcher', type: 'delegation', label: 'delegates', status: 'completed' },
        { id: 'e-2', source: 'planner', target: 'writer', type: 'delegation', label: 'delegates', status: 'pending' },
        { id: 'e-3', source: 'researcher', target: 'tool-search', type: 'uses', label: 'calls', status: 'completed' },
        { id: 'e-4', source: 'researcher', target: 'tool-analysis', type: 'uses', label: 'calls', status: 'active', animated: true },
        { id: 'e-5', source: 'researcher', target: 'mem-findings', type: 'data_flow', label: 'writes', status: 'active' },
      ],
    },
    {
      id: 'snap-4',
      mission_id: 'demo-mission',
      branch_id: 'main',
      sequence_num: 3,
      timestamp: new Date(Date.now() - 120000).toISOString(),
      event_type: 'review.changes_requested',
      event_description: 'Critic requested another pass after finding coverage gaps.',
      source_event_id: 'event-4',
      source_event_sequence_num: 3,
      phase: 'reviewing',
      nodes: [
        {
          id: 'planner',
          type: 'agent',
          label: 'Planner',
          status: 'completed',
          position: { x: 300, y: 0 },
          agent_id: 'planner',
          agent_role: 'planner',
          agent_team: 'Core',
          confidence: 0.95,
        },
        {
          id: 'researcher',
          type: 'agent',
          label: 'Researcher',
          status: 'active',
          position: { x: 100, y: 180 },
          agent_id: 'researcher',
          agent_role: 'researcher',
          agent_team: 'Research',
          confidence: 0.72,
          summary: 'Revising findings based on critique',
        },
        {
          id: 'critic',
          type: 'agent',
          label: 'Critic',
          status: 'reviewing',
          position: { x: 300, y: 180 },
          agent_id: 'critic',
          agent_role: 'critic',
          agent_team: 'QA',
          confidence: 0.91,
          summary: 'Found gaps in market data coverage',
        },
        {
          id: 'writer',
          type: 'agent',
          label: 'Writer',
          status: 'waiting',
          position: { x: 500, y: 180 },
          agent_id: 'writer',
          agent_role: 'writer',
          agent_team: 'Content',
          confidence: 0.78,
        },
        { id: 'tool-search', type: 'tool', label: 'Web Search', status: 'completed', position: { x: 0, y: 350 } },
        { id: 'tool-analysis', type: 'tool', label: 'Data Analysis', status: 'completed', position: { x: 200, y: 350 } },
        { id: 'mem-findings', type: 'memory', label: 'Research Findings', status: 'active', position: { x: 400, y: 350 } },
      ],
      edges: [
        { id: 'e-1', source: 'planner', target: 'researcher', type: 'delegation', label: 'delegates', status: 'completed' },
        { id: 'e-2', source: 'planner', target: 'writer', type: 'delegation', label: 'delegates', status: 'pending' },
        { id: 'e-2b', source: 'planner', target: 'critic', type: 'delegation', label: 'delegates review', status: 'active' },
        { id: 'e-3', source: 'researcher', target: 'tool-search', type: 'uses', label: 'calls', status: 'completed' },
        { id: 'e-4', source: 'researcher', target: 'tool-analysis', type: 'uses', label: 'calls', status: 'completed' },
        { id: 'e-5', source: 'researcher', target: 'mem-findings', type: 'data_flow', label: 'writes', status: 'active' },
        { id: 'e-6', source: 'critic', target: 'researcher', type: 'review', label: 'changes requested', status: 'active' },
      ],
    },
    {
      id: 'snap-5',
      mission_id: 'demo-mission',
      branch_id: 'main',
      sequence_num: 4,
      timestamp: new Date(Date.now() - 60000).toISOString(),
      event_type: 'artifact.created',
      event_description: 'Writer resumed on approved research and started drafting output.',
      source_event_id: 'event-5',
      source_event_sequence_num: 4,
      phase: 'executing',
      nodes: [
        { id: 'planner', type: 'agent', label: 'Planner', status: 'completed', position: { x: 300, y: 0 }, agent_id: 'planner', agent_role: 'planner', agent_team: 'Core', confidence: 0.95 },
        { id: 'researcher', type: 'agent', label: 'Researcher', status: 'completed', position: { x: 100, y: 180 }, agent_id: 'researcher', agent_role: 'researcher', agent_team: 'Research', confidence: 0.94, summary: 'Research complete - 15 sources analyzed' },
        { id: 'critic', type: 'agent', label: 'Critic', status: 'completed', position: { x: 300, y: 180 }, agent_id: 'critic', agent_role: 'critic', agent_team: 'QA', confidence: 0.93, summary: 'Approved revised findings' },
        { id: 'writer', type: 'agent', label: 'Writer', status: 'active', position: { x: 500, y: 180 }, agent_id: 'writer', agent_role: 'writer', agent_team: 'Content', confidence: 0.86, summary: 'Generating executive summary draft' },
        { id: 'tool-search', type: 'tool', label: 'Web Search', status: 'completed', position: { x: 0, y: 350 } },
        { id: 'tool-analysis', type: 'tool', label: 'Data Analysis', status: 'completed', position: { x: 200, y: 350 } },
        { id: 'mem-findings', type: 'memory', label: 'Research Findings', status: 'completed', position: { x: 400, y: 350 } },
        { id: 'artifact-report', type: 'artifact', label: 'Executive Summary', status: 'active', position: { x: 600, y: 350 } },
      ],
      edges: [
        { id: 'e-1', source: 'planner', target: 'researcher', type: 'delegation', status: 'completed' },
        { id: 'e-2', source: 'planner', target: 'writer', type: 'delegation', status: 'active', animated: true },
        { id: 'e-2b', source: 'planner', target: 'critic', type: 'delegation', status: 'completed' },
        { id: 'e-3', source: 'researcher', target: 'tool-search', type: 'uses', status: 'completed' },
        { id: 'e-4', source: 'researcher', target: 'tool-analysis', type: 'uses', status: 'completed' },
        { id: 'e-5', source: 'researcher', target: 'mem-findings', type: 'data_flow', status: 'completed' },
        { id: 'e-6', source: 'critic', target: 'researcher', type: 'review', label: 'approved', status: 'completed' },
        { id: 'e-7', source: 'mem-findings', target: 'writer', type: 'data_flow', label: 'reads', status: 'active' },
        { id: 'e-8', source: 'writer', target: 'artifact-report', type: 'produces', label: 'produces', status: 'active', animated: true },
      ],
    },
  ];

  const branches: ReplayBranch[] = [
    {
      id: 'main',
      mission_id: 'demo-mission',
      name: 'Main',
      status: 'active',
      metadata: {},
      created_at: snapshots[0].timestamp,
      updated_at: snapshots[snapshots.length - 1].timestamp,
    },
  ];

  const events: MissionEventRecord[] = snapshots.map((snapshot, index) => ({
    id: `event-${index + 1}`,
    mission_id: 'demo-mission',
    branch_id: 'main',
    sequence_num: index,
    branch_sequence_num: index,
    event_type: snapshot.event_type ?? 'span.completed',
    timestamp: snapshot.timestamp,
    agent_id: snapshot.nodes.find((node) => node.type === 'agent' && node.status === 'active')?.agent_id,
    payload: {
      event_description: snapshot.event_description,
      phase: snapshot.phase,
    },
    metadata: {},
  }));

  const currentState: RuntimeState = {
    mission_id: 'demo-mission',
    branch_id: 'main',
    status: 'active',
    phase: snapshots[snapshots.length - 1]?.phase ?? 'executing',
    sequence_num: snapshots.length - 1,
    agents: {
      planner: { agent_id: 'planner', name: 'Planner', role: 'planner', team: 'Core', status: 'completed', history: [0, 1], metadata: {} },
      researcher: { agent_id: 'researcher', name: 'Researcher', role: 'researcher', team: 'Research', status: 'completed', history: [1, 2, 3], metadata: {} },
      critic: { agent_id: 'critic', name: 'Critic', role: 'critic', team: 'QA', status: 'completed', history: [3, 4], metadata: {} },
      writer: { agent_id: 'writer', name: 'Writer', role: 'writer', team: 'Content', status: 'active', current_task_id: 'draft-report', history: [1, 4], metadata: {} },
    },
    interrupts: {},
    nodes: snapshots[snapshots.length - 1]?.nodes ?? [],
    edges: snapshots[snapshots.length - 1]?.edges ?? [],
  };

  const durationSeconds =
    (new Date(snapshots[snapshots.length - 1].timestamp).getTime() - new Date(snapshots[0].timestamp).getTime()) / 1000;

  return {
    mission_id: 'demo-mission',
    branch_id: 'main',
    projection_version: SPAN_PROJECTION_VERSION,
    total_frames: snapshots.length,
    duration_seconds: durationSeconds,
    branches,
    events,
    snapshots,
    current_state: currentState,
  };
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  active: { icon: <Loader2 size={12} className="animate-spin" />, color: '#818cf8', label: 'Active' },
  completed: { icon: <CheckCircle2 size={12} />, color: '#34d399', label: 'Completed' },
  failed: { icon: <XCircle size={12} />, color: '#f87171', label: 'Failed' },
  paused: { icon: <PauseCircle size={12} />, color: '#fbbf24', label: 'Paused' },
};

function CurrentEventAuthorityCard({
  currentSnapshot,
  runtimeSummary,
  runtimeExplanation = null,
  selectedActivity: selectedActivityOverride = null,
}: {
  currentSnapshot: GraphSnapshot;
  runtimeSummary: RuntimeSummary | null;
  runtimeExplanation?: RuntimeExplanationProjection | null;
  selectedActivity?: RuntimeExplanationActivity | null;
}) {
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedEventId = useReplayStore((state) => state.selectedEventId);
  const selectedActivityId = useReplayStore((state) => state.selectedActivityId);

  const selectedActivity = useMemo<RuntimeExplanationActivity | null>(() => {
    if (selectedActivityOverride) return selectedActivityOverride;
    return resolveSelectedActivity(
      runtimeExplanation,
      currentSnapshot,
      selectedActivityId,
      selectedNodeId,
      selectedEventId,
    );
  }, [currentSnapshot, runtimeExplanation, selectedActivityOverride, selectedActivityId, selectedEventId, selectedNodeId]);

  const authority = selectedFrameAuthority(runtimeSummary, selectedActivity);
  const authorityDisclosure = authority.incompatibilities.length > 0
    ? 'selected-frame authority incompatible'
    : authority.status && authority.phase
    ? `status ${authority.status} | phase ${authority.phase.label} (${authority.phase.basis})`
    : 'selected-frame authority unavailable';
  const selectedActivityDisclosure = selectedActivity
    ? `${selectedActivity.operator_facing_record?.primary_label ?? selectedActivity.title} | ${selectedActivity.operator_facing_record?.action.value ?? selectedActivity.action} | ${selectedActivity.status}`
    : runtimeExplanation?.selected_activity_state?.kind === 'overview'
      ? 'Frame overview | no authoritative selected activity'
    : runtimeExplanation && runtimeExplanation.activities.length === 0
      ? 'No selectable activity at this frame'
      : 'No authoritative selected activity';
  const incompatibilityDisclosure = authority.incompatibilities.length > 0
    ? `Authority incompatibility: ${authority.incompatibilities.join('; ')}`
    : null;

  return (
    <div className="absolute bottom-4 left-4 z-10 max-w-sm rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(10,11,16,0.82)] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#7b819f]">
        Current Event
      </div>
      <div className="mt-1 text-[13px] font-medium text-[#eef1fa]">
        {currentSnapshot.event_description ?? currentSnapshot.event_type ?? 'Replay frame'}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#68708f]">
        Recorded event metadata
      </div>
      <div className="mt-1 text-[11px] text-[#8f95b2]">
        {new Date(currentSnapshot.timestamp).toLocaleString()} | {authorityDisclosure}
      </div>
      <div className="mt-1 text-[11px] text-[#8f95b2]">
        Selected activity | {selectedActivityDisclosure}
      </div>
      {incompatibilityDisclosure && (
        <div className="mt-2 text-[11px] text-[#fbbf24]">{incompatibilityDisclosure}</div>
      )}
    </div>
  );
}

export default function MissionWorkspacePage() {
  const { setSnapshots, applySnapshot, snapshots, visibleEdgeCount, totalEdgeCount, zoomBand, setSelectedNodeId, selectedNodeId } = useGraphStore();
  const currentFrame = useReplayStore((state) => state.currentFrame);
  const branches = useReplayStore((state) => state.branches);
  const currentBranchId = useReplayStore((state) => state.currentBranchId);
  const currentState = useReplayStore((state) => state.currentState);
  const events = useReplayStore((state) => state.events);
  const setReplayData = useReplayStore((state) => state.setReplayData);
  const setCurrentFrame = useReplayStore((state) => state.setCurrentFrame);
  const selectedEventId = useReplayStore((state) => state.selectedEventId);
  const selectedActivityId = useReplayStore((state) => state.selectedActivityId);
  const setSelectedActivityId = useReplayStore((state) => state.setSelectedActivityId);
  const setSelectedEventId = useReplayStore((state) => state.setSelectedEventId);
  const setActivityContextState = useReplayStore((state) => state.setActivityContextState);
  const { isGraphFullscreen, setIsGraphFullscreen } = useLayoutStore();
  const [mission, setMission] = useState<Mission | null>(null);
  const [missionLoadError, setMissionLoadError] = useState<string | null>(null);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummary | null>(null);
  const [runtimeExplanation, setRuntimeExplanationState] = useState<RuntimeExplanationProjection | null>(null);
  const [isEnhancingSummary, setIsEnhancingSummary] = useState(false);
  const params = useParams<{ id?: string }>();
  const missionId = Array.isArray(params?.id) ? params.id[0] : params?.id ?? 'demo-mission';
  const frameSequenceNum = useMemo(
    () => sequenceNumThroughFrame(snapshots, events, currentFrame),
    [snapshots, events, currentFrame],
  );

  const syncReplayToGraph = useCallback((replay: ReplayStateResponse) => {
    // Inject pending interrupt flags into snapshots so nodes can render badges
    const interruptsByAgent = new Map(
      Object.values(replay.current_state?.interrupts ?? {})
        .filter(i => i.status === 'pending' && i.agent_id)
        .map(i => [i.agent_id, true])
    );
    
    const enrichedSnapshots = replay.snapshots.map(snap => ({
      ...snap,
      nodes: snap.nodes.map(node => ({
        ...node,
        metadata: {
          ...node.metadata,
          hasPendingInterrupt: node.agent_id ? interruptsByAgent.has(node.agent_id) : false
        }
      }))
    }));

    setSnapshots(enrichedSnapshots);
    setReplayData(replay);
    if (enrichedSnapshots.length > 0) {
      const nextFrame = Math.max(0, Math.min(currentFrame, enrichedSnapshots.length - 1));
      setCurrentFrame(nextFrame);
      applySnapshot(enrichedSnapshots[nextFrame]);
    }
  }, [applySnapshot, currentFrame, setCurrentFrame, setReplayData, setSnapshots]);

  const loadReplay = useCallback(async (branchId?: string) => {
    if (!missionId || missionId === 'demo-mission') {
      const demoReplay = buildDemoReplay();
      syncReplayToGraph(demoReplay);
      setMission(null);
      setMissionLoadError(null);
      setRuntimeSummary(null);
      setRuntimeExplanationState(null);
      return;
    }

    const [missionData, replay] = await Promise.all([
      api.missions.get(missionId),
      api.replay.get(missionId, branchId),
    ]);

    setMission(missionData);
    setMissionLoadError(null);
    syncReplayToGraph(replay);

  }, [missionId, syncReplayToGraph]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        await loadReplay();
      } catch (cause) {
        if (!active) return;
        const demoReplay = buildDemoReplay();
        setMission(null);
        setMissionLoadError(cause instanceof Error ? cause.message : 'Failed to load mission.');
        setRuntimeExplanationState(null);
        setRuntimeSummary(null);
        syncReplayToGraph(demoReplay);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [loadReplay, syncReplayToGraph]);

  useEffect(() => {
    if (!snapshots.length) return;
    const snapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1];
    if (snapshot) {
      applySnapshot(snapshot);
    }
  }, [applySnapshot, currentFrame, snapshots]);

  useEffect(() => {
    if (!missionId || missionId === 'demo-mission') {
      setRuntimeSummary(null);
      setRuntimeExplanationState(null);
      return;
    }
    if (!currentBranchId || frameSequenceNum === undefined) {
      setRuntimeSummary(null);
      setRuntimeExplanationState(null);
      return;
    }

    let active = true;
    void Promise.all([
      api.runtimeSummary.get(missionId, { branchId: currentBranchId, sequenceNum: frameSequenceNum }),
      api.runtimeExplanation.get(missionId, { branchId: currentBranchId, sequenceNum: frameSequenceNum }),
    ]).then(([summary, explanation]) => {
      if (!active) return;
      setRuntimeSummary(summary);
      setRuntimeExplanationState(explanation);
    }).catch(() => {
      if (!active) return;
      setRuntimeSummary(null);
      setRuntimeExplanationState(null);
    });

    return () => {
      active = false;
    };
  }, [currentBranchId, frameSequenceNum, missionId]);

  useEffect(() => {
    const snapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
    const selectedActivity = resolveSelectedActivity(
      runtimeExplanation,
      snapshot,
      selectedActivityId,
      selectedNodeId,
      selectedEventId,
    );

    if (!runtimeExplanation) {
      setActivityContextState(null);
      return;
    }
    setActivityContextState(runtimeExplanation.selected_activity_state ?? null);
    if (runtimeExplanation.selected_activity_state?.kind === 'no_activity' || runtimeExplanation.activities.length === 0) {
      setSelectedActivityId(null);
      setSelectedEventId(null);
      setSelectedNodeId(null);
      return;
    }

    if (
      runtimeExplanation.selected_activity_state?.kind === 'overview'
      && !selectedActivityId
      && !selectedNodeId
      && !selectedEventId
    ) {
      return;
    }

    if (!selectedActivity) return;
    const resolvedNode = matchNodeToActivity(snapshot, selectedActivity);
    if (selectedActivityId !== selectedActivity.id) {
      setSelectedActivityId(selectedActivity.id);
    }
    if (selectedActivity.evidence_refs[0]?.event_id && selectedEventId !== selectedActivity.evidence_refs[0].event_id) {
      setSelectedEventId(selectedActivity.evidence_refs[0].event_id);
    }
    if (resolvedNode?.id && selectedNodeId !== resolvedNode.id) {
      setSelectedNodeId(resolvedNode.id);
    }
  }, [
    currentFrame,
    runtimeExplanation,
    selectedActivityId,
    selectedEventId,
    selectedNodeId,
    setActivityContextState,
    setSelectedActivityId,
    setSelectedEventId,
    setSelectedNodeId,
    snapshots,
  ]);

  useEffect(() => {
    if (!missionId || missionId === 'demo-mission') return;

    const ws = new WebSocket(`${websocketBaseUrl()}/ws/missions/${missionId}`);
    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as {
          type: string;
          mission_id?: string;
          branch_id?: string;
          mission?: Mission;
          runtime_summary?: unknown;
          runtime_explanation?: unknown;
          branch?: { id: string };
          snapshot?: { branch_id: string };
          interrupt?: { branch_id: string };
          job?: { branch_id: string };
        };
        if (message.type === 'mission.updated' && message.mission) {
          setMission(message.mission);
        }
        
        if (
          message.type === 'runtime.summary.updated'
          && message.runtime_summary
          && (message.runtime_summary as RuntimeSummary).sequence_num === frameSequenceNum
        ) {
          setRuntimeSummary(message.runtime_summary as RuntimeSummary);
        }
        if (
          message.type === 'runtime.explanation.updated'
          && message.runtime_explanation
          && (message.runtime_explanation as RuntimeExplanationProjection).as_of_sequence_num === frameSequenceNum
        ) {
          const explanation = message.runtime_explanation as RuntimeExplanationProjection;
          setRuntimeExplanationState(explanation);
        }

        if (shouldReloadReplayForRealtimeMessage(message, currentBranchId)) {
          void loadReplay(currentBranchId ?? undefined);
        }
      } catch {
        // Ignore malformed realtime messages.
      }
    };

    return () => ws.close();
  }, [currentBranchId, frameSequenceNum, loadReplay, missionId]);

  const handleEnhanceSummary = useCallback(async () => {
    if (!missionId || missionId === 'demo-mission') return;
    setIsEnhancingSummary(true);
    try {
      const enhanced = await api.runtimeSummary.enhance(missionId, currentBranchId ?? undefined);
      setRuntimeSummary(enhanced);
    } finally {
      setIsEnhancingSummary(false);
    }
  }, [missionId, currentBranchId]);

  const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const missionStatus = mission?.status ?? currentState?.status ?? 'active';
  const statusBadge = statusConfig[missionStatus] ?? statusConfig.active;
  const activeAgents = useMemo(() => Object.values(currentState?.agents ?? {}).filter((agent) => agent.status === 'active').length, [currentState]);
  const pendingInterrupts = useMemo(() => Object.values(currentState?.interrupts ?? {}).filter((interrupt) => interrupt.status === 'pending').length, [currentState]);
  const showMissionError = Boolean(missionLoadError && missionId !== 'demo-mission');

  return (
    <div className="h-screen flex flex-col bg-[#0a0b10] overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.9)] backdrop-blur-xl z-40">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-[#5d6180] hover:text-[#9498b0] transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex items-center gap-2">
            <Telescope size={18} className="text-[#818cf8]" />
            <span className="text-[14px] font-bold gradient-text">AgentLens</span>
          </div>
          <div className="h-4 w-px bg-[rgba(255,255,255,0.08)]" />
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: `${statusBadge.color}15`, color: statusBadge.color }}
            >
              {statusBadge.icon}
              {statusBadge.label}
            </div>
            <h1 className="text-[13px] font-medium text-[#e8eaf0] max-w-md truncate">
              {mission?.objective ?? 'Mission overview'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-[#34d399] mr-2">
            <Lock size={10} />
            <span>E2E Encrypted</span>
          </div>
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.04)] transition-colors">
            <Share2 size={12} />
            Share
          </button>
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.04)] transition-colors">
            <Download size={12} />
            Export
          </button>
          <button
            onClick={() => setIsGraphFullscreen(!isGraphFullscreen)}
            className="p-1.5 rounded-lg text-[#5d6180] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          >
            {isGraphFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </header>

      <WorkspaceShell
        leftPanel={
          <div className="flex flex-col h-full min-h-0">
            <RuntimeSummaryPanel
              objective={mission?.objective ?? 'Mission overview'}
              missionStatus={missionStatus}
              missionPhase={currentState?.phase ?? mission?.phase ?? 'executing'}
              serverSummary={runtimeSummary}
              serverExplanation={runtimeExplanation}
              onEnhance={missionId !== 'demo-mission' ? handleEnhanceSummary : undefined}
              isEnhancing={isEnhancingSummary}
            />
            <div className="flex-1 min-h-0 overflow-hidden">
              <MissionTimeline explanation={runtimeExplanation} />
            </div>
          </div>
        }
        centerPanel={
          <div className="relative flex-1 overflow-hidden">
            <CanvasToolbar
              agentCount={Object.keys(currentState?.agents ?? {}).length}
              branchCount={branches.length}
              pendingInterrupts={pendingInterrupts}
              activeAgents={activeAgents}
            />
            <MissionGraph />

            {showMissionError && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(10,11,16,0.72)] backdrop-blur-sm p-6">
                <div className="max-w-md rounded-2xl border border-[rgba(248,113,113,0.18)] bg-[rgba(36,17,20,0.92)] px-5 py-4 text-center shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(248,113,113,0.12)] text-[#f87171]">
                    <XCircle size={18} />
                  </div>
                  <h2 className="text-[14px] font-semibold text-[#f3d0d0]">Mission unavailable</h2>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#d8b4b4]">{missionLoadError}</p>
                </div>
              </div>
            )}

            {currentSnapshot && (
              <CurrentEventAuthorityCard
                currentSnapshot={currentSnapshot}
                runtimeSummary={runtimeSummary}
                runtimeExplanation={runtimeExplanation}
              />
            )}
          </div>
        }
        rightPanel={
          <RightSidebar
            missionId={missionId}
            onBranchChange={loadReplay}
            missionObjective={mission?.objective ?? 'Mission overview'}
            missionStatus={missionStatus}
            runtimeExplanation={runtimeExplanation}
            runtimeSummary={runtimeSummary}
          />
        }
        bottomPanel={
          <StatusBar
            metrics={
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-[#5d6180] capitalize">{zoomBand} view</span>
                <span className={totalEdgeCount > 0 && visibleEdgeCount / totalEdgeCount < 0.3 ? 'text-[#fbbf24]' : 'text-[#9498b0]'}>
                  {visibleEdgeCount} / {totalEdgeCount} edges visible
                </span>
              </div>
            }
          />
        }
      />
      <AiAssistant
        missionId={missionId}
        missionObjective={mission?.objective ?? 'Mission overview'}
        missionStatus={missionStatus}
      />
    </div>
  );
}
