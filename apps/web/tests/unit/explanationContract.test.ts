import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type {
  EventEnvelope,
  GraphSnapshot,
  RuntimeActivity,
  RuntimeExplanationProjection,
  RuntimeSummary,
} from '@agentlens/protocol';
import { MissionTimeline } from '../../src/components/timeline/MissionTimeline.js';
import { RuntimeSummaryPanel } from '../../src/components/runtime/RuntimeSummaryPanel.js';
import { RopsInspector } from '../../src/components/rops/RopsInspector.js';
import { BranchExplorer } from '../../src/components/replay/BranchExplorer.js';
import { CurrentEventAuthorityCard } from '../../src/components/runtime/CurrentEventAuthorityCard.js';
import { useRuntimeExplanation } from '../../src/hooks/useRuntimeExplanation.js';
import { useRuntimeSummary } from '../../src/hooks/useRuntimeSummary.js';
import { useGraphStore } from '../../src/stores/graphStore.js';
import { useReplayStore } from '../../src/stores/replayStore.js';

function envelope(sequence_num: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: overrides.id ?? `e-${sequence_num}`,
    mission_id: 'm1',
    branch_id: 'main',
    branch_sequence_num: sequence_num,
    sequence_num,
    event_type: overrides.event_type ?? 'tool.called',
    timestamp: overrides.timestamp ?? `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    payload: overrides.payload ?? {},
    metadata: overrides.metadata ?? {},
    ...overrides,
  };
}

function activity(sequence_num = 7): RuntimeActivity {
  return {
    id: 'tool:call-1',
    kind: 'tool',
    label: 'Tool | fetch_logs',
    action: 'Tool called',
    outcome: 'Completed',
    status: 'completed',
    sequence_num,
    timestamp: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    duration_ms: 50,
    actor: 'planner',
    source_span_id: 'span-tool',
    provenance: 'projection',
  };
}

function repeatedActivities(sequence_num = 7): RuntimeActivity[] {
  return [
    {
      ...activity(sequence_num),
      id: 'llm:req-1',
      kind: 'llm',
      label: 'LLM | draft_summary | req-1',
      action: 'Generate summary',
      actor: 'planner',
      source_span_id: 'span-llm-1',
    },
    {
      ...activity(sequence_num + 1),
      id: 'llm:req-2',
      kind: 'llm',
      label: 'LLM | draft_summary | req-2',
      action: 'Generate summary',
      actor: 'planner',
      source_span_id: 'span-llm-2',
    },
    {
      ...activity(sequence_num + 2),
      id: 'tool:call-1',
      kind: 'tool',
      label: 'Tool | fetch_logs | call-1',
      action: 'Tool called',
      actor: 'planner',
      source_span_id: 'span-tool-1',
    },
    {
      ...activity(sequence_num + 3),
      id: 'tool:call-2',
      kind: 'tool',
      label: 'Tool | fetch_logs | call-2',
      action: 'Tool called',
      actor: 'planner',
      source_span_id: 'span-tool-2',
    },
    {
      ...activity(sequence_num + 4),
      id: 'retrieval:req-1',
      kind: 'retrieval',
      label: 'Retrieval | search_index | req-1',
      action: 'Retrieval searched',
      actor: 'planner',
      source_span_id: 'span-ret-1',
    },
    {
      ...activity(sequence_num + 5),
      id: 'retrieval:req-2',
      kind: 'retrieval',
      label: 'Retrieval | search_index | req-2',
      action: 'Retrieval searched',
      actor: 'planner',
      source_span_id: 'span-ret-2',
    },
  ];
}

function explanation(sequence_num = 7): RuntimeExplanationProjection {
  return {
    mission_id: 'm1',
    branch_id: 'main',
    as_of_sequence_num: sequence_num,
    as_of_timestamp: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    projection_version: 'runtime_explanation.v1',
    run_outcome: 'completed',
    activities: [
      {
        id: 'tool:call-1',
        kind: 'tool',
        title: 'Tool | fetch_logs',
        action: 'Tool called',
        status: 'completed',
        started_at: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
        ended_at: `2026-06-29T00:00:${String(sequence_num + 1).padStart(2, '0')}.000Z`,
        duration_ms: 1000,
        actor: 'planner',
        source_span_id: 'span-tool',
        sequence_num,
        evidence_refs: [
          {
            event_id: 'e-7',
            sequence_num,
            timestamp: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
            span_id: 'span-tool',
            branch_id: 'main',
          },
        ],
      },
    ],
    relations: [],
    parallel_groups: [],
    merge_groups: [],
    consistency_flags: [],
  };
}

function repeatedExplanation(sequence_num = 7): RuntimeExplanationProjection {
  const activities = repeatedActivities(sequence_num);
  return {
    mission_id: 'm1',
    branch_id: 'main',
    as_of_sequence_num: sequence_num + 5,
    as_of_timestamp: `2026-06-29T00:00:${String(sequence_num + 5).padStart(2, '0')}.000Z`,
    projection_version: 'runtime_explanation.v1',
    run_outcome: 'completed',
    activities: activities.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.label,
      action: entry.action,
      status: 'completed',
      outcome: 'Completed',
      started_at: `2026-06-29T00:00:${String(entry.sequence_num ?? sequence_num).padStart(2, '0')}.000Z`,
      ended_at: `2026-06-29T00:00:${String((entry.sequence_num ?? sequence_num) + 1).padStart(2, '0')}.000Z`,
      duration_ms: 1000,
      actor: entry.actor,
      source_span_id: entry.source_span_id,
      sequence_num: entry.sequence_num,
      evidence_refs: [
        {
          event_id: `e-${entry.id}`,
          sequence_num: entry.sequence_num ?? sequence_num,
          timestamp: `2026-06-29T00:00:${String(entry.sequence_num ?? sequence_num).padStart(2, '0')}.000Z`,
          span_id: entry.source_span_id,
          branch_id: 'main',
        },
      ],
    })),
    relations: [],
    parallel_groups: [],
    merge_groups: [],
    consistency_flags: [],
  };
}

function summary(sequence_num = 7): RuntimeSummary {
  return {
    mission_id: 'm1',
    branch_id: 'main',
    sequence_num,
    generated_at: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    frame: {
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num,
      as_of_timestamp: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
      projection_version: 'runtime_explanation.v1',
    },
    objective: 'Investigate',
    status: 'completed',
    phase: 'executing',
    current_phase: {
      id: 'derived:Converging:7',
      label: 'Converging',
      basis: 'derived',
      start_sequence_num: sequence_num,
      end_sequence_num: sequence_num,
      evidence_refs: [],
    },
    headline: 'Execution completed',
    progress: [
      {
        sequence_num,
        timestamp: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
        event_type: 'tool',
        actor: 'planner',
        text: 'Tool | fetch_logs | Tool called | completed',
      },
    ],
    activities: [activity(sequence_num)],
    observations: [],
    decisions: [],
    evidence: [],
    actions: [{ text: 'Tool | fetch_logs | Tool called', sequence_num, actor: 'planner', status: 'completed' }],
    pending_work: [],
    warnings: [],
    artifacts: [],
    interrupts: [],
    agents: [],
    nodes: [],
    is_blocked: false,
    requires_human: false,
    source: 'deterministic',
  };
}

function repeatedSummary(sequence_num = 7): RuntimeSummary {
  const activities = repeatedActivities(sequence_num);
  return {
    ...summary(sequence_num + 5),
    sequence_num: sequence_num + 5,
    frame: {
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: sequence_num + 5,
      as_of_timestamp: `2026-06-29T00:00:${String(sequence_num + 5).padStart(2, '0')}.000Z`,
      projection_version: 'runtime_explanation.v1',
    },
    activities,
    story_activities: activities,
    actions: activities.map((entry) => ({
      text: `${entry.label} | ${entry.action}`,
      sequence_num: entry.sequence_num ?? sequence_num,
      actor: entry.actor,
      status: entry.status,
    })),
  };
}

function snapshot(sequence_num = 0): GraphSnapshot {
  return {
    id: `snap-${sequence_num}`,
    mission_id: 'm1',
    branch_id: 'main',
    sequence_num,
    timestamp: `2026-06-29T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    nodes: [
      {
        id: 'node-tool',
        type: 'tool',
        label: 'Tool node',
        status: 'completed',
        position: { x: 0, y: 0 },
        span_id: 'span-tool',
        source_span_id: 'span-tool',
        activity: activity(7),
      },
    ],
    edges: [],
    source_event_id: 'e-7',
    source_event_sequence_num: 7,
  };
}

beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    baseNodes: [],
    baseEdges: [],
    snapshots: [],
    currentSnapshotIndex: 0,
    selectedNodeId: null,
    activeNodeId: null,
    hoveredNodeId: null,
    highlightedEdgeId: null,
    highlightedNodeIds: [],
    highlightedEdgeIds: [],
    zoomLevel: 1,
    zoomBand: 'standard',
    edgeVisibility: {
      dependency: true,
      uses: true,
      delegation: true,
      critique: true,
      review: true,
      escalation: true,
      data_flow: true,
      approval: true,
      member_of: true,
      produces: true,
    },
    edgeLayerPreset: 'all',
    tracePreset: 'none',
    showActiveOnly: false,
    focusModeEnabled: true,
    focusDepth: 1,
    bundleEdges: true,
    visibleEdgeCount: 0,
    totalEdgeCount: 0,
    satelliteCounts: {},
    layoutPositions: {},
  });
  useReplayStore.setState({
    isPlaying: false,
    currentFrame: 0,
    totalFrames: 1,
    playbackSpeed: 1,
    durationSeconds: null,
    currentBranchId: 'main',
    branches: [],
    events: [],
    currentState: null,
    selectedEventId: null,
    selectedActivityId: null,
    activityContextState: null,
  });
});

describe('runtime explanation contract in web consumers', () => {
  it('does not reconstruct explanation or summary from replay evidence when the server projection is missing', () => {
    useReplayStore.setState({
      events: [envelope(0, { span_id: 'span-tool', payload: { 'gen_ai.tool.name': 'fetch_logs' } })],
    });

    function HookProbe() {
      const exp = useRuntimeExplanation({ serverExplanation: null });
      const sum = useRuntimeSummary({ serverSummary: null });
      return createElement('div', null, `${exp ? 'exp' : 'no-exp'}|${sum ? 'sum' : 'no-sum'}`);
    }

    expect(renderToString(createElement(HookProbe))).toContain('no-exp|no-sum');
  });

  it('renders an explicit timeline fallback instead of raw event meaning when explanation is absent', () => {
    const snap = snapshot(0);
    useGraphStore.getState().setSnapshots([snap]);
    useReplayStore.setState({
      events: [envelope(7, { span_id: 'span-tool', payload: { 'gen_ai.tool.name': 'fetch_logs' } })],
      totalFrames: 1,
    });

    const html = renderToString(createElement(MissionTimeline, { explanation: null }));
    expect(html).toContain('Runtime explanation unavailable');
    expect(html).not.toContain('tool.called');
  });

  it('keeps graph node activity on the server-provided snapshot instead of reattaching it client-side', () => {
    useGraphStore.getState().setZoomLevel(1.5);
    useGraphStore.getState().applySnapshot(snapshot(0));
    const renderedNode = useGraphStore.getState().nodes[0];
    expect(renderedNode.data.activity).toMatchObject({
      id: 'tool:call-1',
      action: 'Tool called',
      sequence_num: 7,
    });
  });

  it('keeps summary, timeline, graph, and inspector aligned to the same frame payload', () => {
    const snap = snapshot(0);
    useGraphStore.getState().setSnapshots([snap]);
    useGraphStore.getState().applySnapshot(snap);
    useReplayStore.setState({
      events: [envelope(7, { span_id: 'span-tool' })],
      totalFrames: 1,
    });

    const explanationPayload = explanation(7);
    const summaryPayload = summary(7);
    const summaryHtml = renderToString(createElement(RuntimeSummaryPanel, {
      serverSummary: summaryPayload,
      serverExplanation: explanationPayload,
    }));
    const timelineHtml = renderToString(createElement(MissionTimeline, {
      explanation: explanationPayload,
    }));
    const inspectorHtml = renderToString(createElement(RopsInspector, {
      node: snap.nodes[0],
      agentProjection: null,
      edges: [],
      nodes: snap.nodes,
      mission: null,
      eventEnvelope: envelope(7, { span_id: 'span-tool' }),
      eventEnvelopes: [envelope(7, { span_id: 'span-tool' })],
      runtimeAgentState: null,
      interrupt: null,
      branch: null,
      snapshot: snap,
    }));

    expect(summaryHtml).toMatch(/as of seq #(?:<!-- -->)?7/);
    expect(timelineHtml).toContain('#7');
    expect(inspectorHtml).toContain('Selected activity');
    expect(inspectorHtml).toContain('Tool called');
  });

  it('keeps the current event card and reconstructed runtime matrix aligned to selected-frame authority', () => {
    const snap = {
      ...snapshot(0),
      phase: 'reviewing',
      event_description: 'Snapshot still says reviewing',
    } as GraphSnapshot;
    useGraphStore.getState().setSnapshots([snap]);
    useGraphStore.getState().applySnapshot(snap);
    useReplayStore.setState({
      currentFrame: 0,
      currentState: {
        phase: 'waiting_for_human',
        status: 'waiting',
        agents: {},
        interrupts: {},
      } as never,
    });

    const summaryPayload = summary(7);
    const branchHtml = renderToString(createElement(BranchExplorer, {
      missionId: 'm1',
      onBranchChange: async () => {},
      isCollapsed: false,
      onToggleCollapsed: () => {},
      runtimeSummary: summaryPayload,
    }));
    const cardHtml = renderToString(createElement(CurrentEventAuthorityCard, {
      currentSnapshot: snap,
      runtimeSummary: summaryPayload,
    }));

    expect(branchHtml).toContain('Converging');
    expect(branchHtml).toContain('Derived');
    expect(branchHtml).toContain('Completed');
    expect(branchHtml).not.toContain('waiting_for_human');
    expect(cardHtml).toContain('status Completed | phase Converging (Derived)');
    expect(cardHtml).not.toContain('phase reviewing');
  });

  it('preserves frame overview authority instead of auto-selecting a first activity', () => {
    const overviewExplanation = {
      ...explanation(7),
      selected_activity_state: {
        kind: 'overview',
        reason: 'frame_overview',
      },
    } satisfies RuntimeExplanationProjection;
    const overviewSummary = {
      ...summary(7),
      selected_activity_state: {
        kind: 'overview',
        reason: 'frame_overview',
      },
      selected_activity_id: undefined,
    } satisfies RuntimeSummary;

    const summaryHtml = renderToString(createElement(RuntimeSummaryPanel, {
      serverSummary: overviewSummary,
      serverExplanation: overviewExplanation,
    }));
    const timelineHtml = renderToString(createElement(MissionTimeline, {
      explanation: overviewExplanation,
    }));
    const cardHtml = renderToString(createElement(CurrentEventAuthorityCard, {
      currentSnapshot: snapshot(0),
      runtimeSummary: overviewSummary,
      runtimeExplanation: overviewExplanation,
    }));

    expect(summaryHtml).toMatch(/context:\s*(?:<!-- -->)?Frame overview/);
    expect(timelineHtml).toMatch(/Activity context:\s*(?:<!-- -->)?frame overview/);
    expect(cardHtml).toContain('Frame overview | no authoritative selected activity');
  });

  it('discloses unavailable authority in auxiliary widgets instead of falling back to snapshot state', () => {
    const snap = {
      ...snapshot(0),
      phase: 'executing',
    } as GraphSnapshot;
    useGraphStore.getState().setSnapshots([snap]);
    useGraphStore.getState().applySnapshot(snap);
    useReplayStore.setState({
      currentFrame: 0,
      currentState: {
        phase: 'executing',
        status: 'active',
        agents: {},
        interrupts: {},
      } as never,
    });

    const branchHtml = renderToString(createElement(BranchExplorer, {
      missionId: 'm1',
      onBranchChange: async () => {},
      isCollapsed: false,
      onToggleCollapsed: () => {},
      runtimeSummary: null,
    }));
    const cardHtml = renderToString(createElement(CurrentEventAuthorityCard, {
      currentSnapshot: snap,
      runtimeSummary: null,
    }));

    expect(branchHtml).toContain('Unavailable');
    expect(cardHtml).toContain('selected-frame authority unavailable');
    expect(cardHtml).not.toContain('phase executing');
  });

  it('discloses same-frame authority conflicts instead of rendering competing values', () => {
    const conflictingSummary = {
      ...summary(7),
      status: 'active',
      current_phase: {
        id: 'recorded:completed:7',
        label: 'Completed',
        basis: 'recorded',
        evidence_refs: [],
      },
    } satisfies RuntimeSummary;
    const conflictingExplanation = {
      ...explanation(7),
      activities: [
        {
          ...explanation(7).activities[0],
          title: 'Tool | fetch_logs | call-1',
          status: 'active',
          outcome: 'Completed',
          source_span_id: 'span-tool',
        },
      ],
    } satisfies RuntimeExplanationProjection;
    const conflictingSnapshot = {
      ...snapshot(0),
      event_description: 'Active tool event still streaming',
      event_type: 'tool.active',
      nodes: [
        {
          ...snapshot(0).nodes[0],
          id: 'node-tool',
          source_span_id: 'span-tool',
          activity: {
            ...activity(7),
            label: 'Tool | fetch_logs | call-1',
            status: 'active',
            outcome: 'Completed',
            source_span_id: 'span-tool',
          },
        },
      ],
    } as GraphSnapshot;

    useGraphStore.getState().setSnapshots([conflictingSnapshot]);
    useGraphStore.getState().applySnapshot(conflictingSnapshot);
    useGraphStore.getState().setSelectedNodeId('node-tool');
    useReplayStore.setState({
      currentFrame: 0,
      selectedEventId: 'e-7',
      currentState: {
        phase: 'executing',
        status: 'active',
        agents: {},
        interrupts: {},
      } as never,
    });

    const branchHtml = renderToString(createElement(BranchExplorer, {
      missionId: 'm1',
      onBranchChange: async () => {},
      isCollapsed: false,
      onToggleCollapsed: () => {},
      runtimeSummary: conflictingSummary,
    }));
    const cardHtml = renderToString(createElement(CurrentEventAuthorityCard, {
      currentSnapshot: conflictingSnapshot,
      runtimeSummary: conflictingSummary,
      runtimeExplanation: conflictingExplanation,
      selectedActivity: conflictingExplanation.activities[0],
    }));

    expect(branchHtml).toContain('Incompatible');
    expect(branchHtml).toContain('Authority mismatch');
    expect(cardHtml).toContain('Recorded event metadata');
    expect(cardHtml).toContain('Selected activity |');
    expect(cardHtml).toContain('Tool | fetch_logs | call-1 | Tool called | active');
    expect(cardHtml).toContain('Authority incompatibility: frame phase Completed conflicts with runtime status Active; selected activity outcome Completed conflicts with lifecycle status active');
    expect(cardHtml).toContain('selected-frame authority incompatible');
  });

  it('keeps repeated llm, tool, and retrieval invocations distinguishable across summary, timeline, current-event, and inspector', () => {
    const repeatedSnap = {
      ...snapshot(0),
      nodes: [
        {
          ...snapshot(0).nodes[0],
          id: 'node-tool-2',
          label: 'Tool node 2',
          source_span_id: 'span-tool-2',
          activity: {
            ...activity(10),
            id: 'tool:call-2',
            label: 'Tool | fetch_logs | call-2',
            action: 'Tool called',
            source_span_id: 'span-tool-2',
          },
        },
      ],
    } as GraphSnapshot;
    const repeatedExplanationPayload = repeatedExplanation(7);
    const repeatedSummaryPayload = repeatedSummary(7);
    useGraphStore.getState().setSnapshots([repeatedSnap]);
    useGraphStore.getState().applySnapshot(repeatedSnap);
    useGraphStore.getState().setSelectedNodeId('node-tool-2');
    useReplayStore.setState({
      currentFrame: 0,
      totalFrames: 1,
      selectedEventId: 'e-tool:call-2',
      events: repeatedExplanationPayload.activities.map((entry) =>
        envelope(entry.sequence_num ?? 0, {
          id: `e-${entry.id}`,
          span_id: entry.source_span_id,
          event_type: entry.kind,
        }),
      ),
    });

    const summaryHtml = renderToString(createElement(RuntimeSummaryPanel, {
      serverSummary: repeatedSummaryPayload,
      serverExplanation: repeatedExplanationPayload,
    }));
    const timelineHtml = renderToString(createElement(MissionTimeline, {
      explanation: repeatedExplanationPayload,
    }));
    const cardHtml = renderToString(createElement(CurrentEventAuthorityCard, {
      currentSnapshot: repeatedSnap,
      runtimeSummary: repeatedSummaryPayload,
      runtimeExplanation: repeatedExplanationPayload,
      selectedActivity: repeatedExplanationPayload.activities[3],
    }));
    const inspectorHtml = renderToString(createElement(RopsInspector, {
      node: repeatedSnap.nodes[0],
      agentProjection: null,
      edges: [],
      nodes: repeatedSnap.nodes,
      mission: null,
      eventEnvelope: envelope(10, { id: 'e-tool:call-2', span_id: 'span-tool-2' }),
      eventEnvelopes: [envelope(10, { id: 'e-tool:call-2', span_id: 'span-tool-2' })],
      runtimeAgentState: null,
      interrupt: null,
      branch: null,
      snapshot: repeatedSnap,
    }));

    expect(summaryHtml).toContain('LLM | draft_summary | req-1');
    expect(summaryHtml).toContain('LLM | draft_summary | req-2');
    expect(summaryHtml).toContain('Tool | fetch_logs | call-1');
    expect(summaryHtml).toContain('Tool | fetch_logs | call-2');
    expect(timelineHtml).toContain('Retrieval | search_index | req-1');
    expect(timelineHtml).toContain('Retrieval | search_index | req-2');
    expect(timelineHtml).toContain('Tool | fetch_logs | call-1');
    expect(timelineHtml).toContain('Tool | fetch_logs | call-2');
    expect(cardHtml).toContain('Selected activity |');
    expect(cardHtml).toContain('Tool | fetch_logs | call-2 | Tool called | completed');
    expect(inspectorHtml).toContain('Tool | fetch_logs | call-2');
    expect(inspectorHtml).not.toContain('Tool | fetch_logs | call-1 | Tool called | Completed');
  });

  it('keeps hidden recorded graph context distinct from missing relationship evidence in web state', () => {
    useGraphStore.setState({
      hiddenContext: {
        kind: 'hidden_recorded_context',
        reason: 'focus_mode',
        hiddenNodeCount: 2,
        hiddenEdgeCount: 1,
        disclosure: 'Recorded graph context hidden by selected-node focus: 2 nodes, 1 edges',
        inspectHint: 'Disable focus mode or widen focus depth to inspect hidden recorded neighbors.',
      },
    });

    expect(useGraphStore.getState().hiddenContext).toMatchObject({
      kind: 'hidden_recorded_context',
      reason: 'focus_mode',
    });
    expect(useGraphStore.getState().hiddenContext?.disclosure).toContain('hidden by selected-node focus');
    expect(useGraphStore.getState().hiddenContext?.inspectHint).toContain('inspect hidden recorded neighbors');
  });
});
