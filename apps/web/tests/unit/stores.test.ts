import { describe, expect, it, beforeEach } from 'vitest';
import { useGraphStore } from '../../src/stores/graphStore.js';
import { useMissionStore } from '../../src/stores/missionStore.js';
import { useReplayStore } from '../../src/stores/replayStore.js';
import { useReviewStore } from '../../src/stores/reviewStore.js';
import type { EventEnvelope, GraphSnapshot } from '@agentlens/protocol';

function replayEvent(id: string, sequence_num = 0): EventEnvelope {
  return {
    id,
    mission_id: 'm1',
    branch_id: 'main',
    sequence_num,
    branch_sequence_num: sequence_num,
    event_type: 'span.started',
    timestamp: `2026-01-01T00:00:0${sequence_num}.000Z`,
    payload: {},
    metadata: {},
  };
}

// Zustand stores are standalone — reset between tests by calling getState/setState
beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    baseNodes: [],
    baseEdges: [],
    snapshots: [],
    currentSnapshotIndex: 0,
    selectedNodeId: null,
    highlightedEdgeId: null,
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
  useMissionStore.setState({ missions: [], activeMission: null, isLoading: false, error: null });
  useReplayStore.setState({
    isPlaying: false, currentFrame: 0, totalFrames: 0, playbackSpeed: 1,
    durationSeconds: null, currentBranchId: null, branches: [], events: [],
    currentState: null, selectedEventId: null, selectedActivityId: null, activityContextState: null,
  });
  useReviewStore.setState({
    reviews: [], comments: [], activeCommentTarget: null, isCommentPanelOpen: true,
  });
});

// ====================================================================
// graphStore
// ====================================================================

describe('graphStore', () => {
  it('has default state', () => {
    const state = useGraphStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
    expect(state.zoomLevel).toBe(1);
    expect(state.selectedNodeId).toBeNull();
  });

  it('sets nodes', () => {
    useGraphStore.getState().setNodes([{ id: 'n1', type: 'default', position: { x: 0, y: 0 }, data: {} }]);
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it('sets edges', () => {
    useGraphStore.getState().setEdges([{ id: 'e1', source: 'a', target: 'b' }]);
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });

  it('sets selected node', () => {
    useGraphStore.getState().setSelectedNodeId('node-1');
    expect(useGraphStore.getState().selectedNodeId).toBe('node-1');
  });

  it('clears selected node', () => {
    useGraphStore.getState().setSelectedNodeId('node-1');
    useGraphStore.getState().setSelectedNodeId(null);
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('sets zoom level', () => {
    useGraphStore.getState().setZoomLevel(2.5);
    expect(useGraphStore.getState().zoomLevel).toBe(2.5);
  });

  it('sets snapshots', () => {
    const snapshots: GraphSnapshot[] = [{
      id: 'snap-1', mission_id: 'm1', sequence_num: 0,
      timestamp: '2026-01-01T00:00:00.000Z', nodes: [], edges: [],
    }];
    useGraphStore.getState().setSnapshots(snapshots);
    expect(useGraphStore.getState().snapshots).toHaveLength(1);
  });

  it('applies a snapshot, converting graph nodes to flow nodes', () => {
    const snapshot: GraphSnapshot = {
      id: 'snap-1', mission_id: 'm1', sequence_num: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [
        { id: 'a1', type: 'agent', label: 'Researcher', status: 'active', position: { x: 0, y: 0 }, agent_role: 'researcher' },
        { id: 't1', type: 'task', label: 'Find papers', status: 'active', position: { x: 0, y: 150 } },
        { id: 'tool1', type: 'tool', label: 'web_search', status: 'active', position: { x: 125, y: 300 } },
      ],
      edges: [
        { id: 'e1', type: 'dependency', source: 'a1', target: 't1', label: 'executes', status: 'active' },
        { id: 'e2', type: 'uses', source: 'a1', target: 'tool1', label: 'calls tool', status: 'active' },
      ],
    };

    useGraphStore.getState().setZoomLevel(1.5);
    useGraphStore.getState().applySnapshot(snapshot);

    const state = useGraphStore.getState();
    expect(state.nodes).toHaveLength(3);
    expect(state.edges).toHaveLength(2);

    // Agent maps to 'agentNode' type
    expect(state.nodes[0].type).toBe('agentNode');
    expect(state.nodes[0].data.label).toBe('Researcher');
    expect(state.nodes[0].data.role).toBe('researcher');

    // Task maps to 'taskNode' type
    expect(state.nodes[1].type).toBe('taskNode');
    expect(state.nodes[1].data.nodeType).toBe('task');

    // Tool maps to 'toolNode' type
    expect(state.nodes[2].type).toBe('toolNode');

    // Dependency edge style
    expect(state.edges[0].style).toBeDefined();
    expect(state.edges[0].type).toBe('bundledEdge');
    expect(state.edges[0].data?.edgeType).toBe('dependency');

    // Uses edge
    expect(state.edges[1].data?.edgeType).toBe('uses');
  });

  it('maps memory and artifact node types', () => {
    const snapshot: GraphSnapshot = {
      id: 'snap-1', mission_id: 'm1', sequence_num: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      nodes: [
        { id: 'mem1', type: 'memory', label: 'shared', status: 'active', position: { x: 0, y: 0 } },
        { id: 'art1', type: 'artifact', label: 'report.pdf', status: 'active', position: { x: 250, y: 0 } },
        { id: 'h1', type: 'human', label: 'human_reviewer', status: 'waiting', position: { x: 0, y: -150 } },
      ],
      edges: [],
    };

    useGraphStore.getState().setZoomLevel(1.5);
    useGraphStore.getState().applySnapshot(snapshot);
    const state = useGraphStore.getState();

    expect(state.nodes[0].type).toBe('toolNode'); // memory → toolNode
    expect(state.nodes[1].type).toBe('toolNode'); // artifact → toolNode
    expect(state.nodes[2].type).toBe('agentNode'); // human → agentNode
  });
});

// ====================================================================
// missionStore
// ====================================================================

describe('missionStore', () => {
  it('has default state', () => {
    const state = useMissionStore.getState();
    expect(state.missions).toEqual([]);
    expect(state.activeMission).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('sets missions list', () => {
    const missions = [
      { id: 'm1', objective: 'Research', status: 'active', phase: 'executing', created_at: '', updated_at: '', metadata: {}, is_encrypted: false, visibility: 'private' },
    ];
    useMissionStore.getState().setMissions(missions);
    expect(useMissionStore.getState().missions).toHaveLength(1);
  });

  it('sets active mission', () => {
    const mission = { id: 'm1', objective: 'Research', status: 'active', phase: 'executing', created_at: '', updated_at: '', metadata: {}, is_encrypted: false, visibility: 'private' };
    useMissionStore.getState().setActiveMission(mission);
    expect(useMissionStore.getState().activeMission!.id).toBe('m1');
  });

  it('updates a mission in the list and active mission', () => {
    const m1 = { id: 'm1', objective: 'Old', status: 'active' as const, phase: 'executing', created_at: '', updated_at: '', metadata: {}, is_encrypted: false, visibility: 'private' };
    const m2 = { id: 'm2', objective: 'Other', status: 'active' as const, phase: 'executing', created_at: '', updated_at: '', metadata: {}, is_encrypted: false, visibility: 'private' };

    useMissionStore.setState({ missions: [m1, m2], activeMission: m1 });
    useMissionStore.getState().updateMission('m1', { objective: 'Updated' });

    const state = useMissionStore.getState();
    expect(state.missions[0].objective).toBe('Updated');
    expect(state.missions[1].objective).toBe('Other'); // unchanged
    expect(state.activeMission!.objective).toBe('Updated');
  });

  it('does not update active mission if different id', () => {
    const m1 = { id: 'm1', objective: 'A', status: 'active' as const, phase: 'executing', created_at: '', updated_at: '', metadata: {}, is_encrypted: false, visibility: 'private' };

    useMissionStore.setState({ missions: [m1], activeMission: m1 });
    useMissionStore.getState().updateMission('m2', { objective: 'Changed' });

    // m2 not in list, active mission unchanged
    expect(useMissionStore.getState().activeMission!.objective).toBe('A');
  });
});

// ====================================================================
// replayStore
// ====================================================================

describe('replayStore', () => {
  it('has default state', () => {
    const state = useReplayStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.currentFrame).toBe(0);
    expect(state.totalFrames).toBe(0);
    expect(state.playbackSpeed).toBe(1);
    expect(state.activityContextState).toBeNull();
  });

  it('sets playing state', () => {
    useReplayStore.getState().setIsPlaying(true);
    expect(useReplayStore.getState().isPlaying).toBe(true);
  });

  it('clamps current frame to valid range', () => {
    useReplayStore.setState({ totalFrames: 5, events: Array.from({ length: 5 }, (_, i) => replayEvent(`e${i}`, i)) });
    useReplayStore.getState().setCurrentFrame(10);
    expect(useReplayStore.getState().currentFrame).toBe(4); // clamped to totalFrames-1
  });

  it('clamps negative current frame to 0', () => {
    useReplayStore.setState({ totalFrames: 5, events: Array.from({ length: 5 }, (_, i) => replayEvent(`e${i}`, i)) });
    useReplayStore.getState().setCurrentFrame(-5);
    expect(useReplayStore.getState().currentFrame).toBe(0);
  });

  it('sets current frame without coupling to the events array index', () => {
    const events = [replayEvent('e0', 0), replayEvent('e1', 1), replayEvent('e2', 2)];
    useReplayStore.setState({ totalFrames: 3, events });
    useReplayStore.getState().setCurrentFrame(1);
    expect(useReplayStore.getState().currentFrame).toBe(1);
    expect(useReplayStore.getState().selectedEventId).toBeNull();
  });

  it('nextFrame advances the frame', () => {
    const events = [replayEvent('e0', 0), replayEvent('e1', 1), replayEvent('e2', 2)];
    useReplayStore.setState({ totalFrames: 3, events });
    useReplayStore.getState().nextFrame();
    expect(useReplayStore.getState().currentFrame).toBe(1);
    expect(useReplayStore.getState().selectedEventId).toBeNull();
  });

  it('stops playing when nextFrame reaches end', () => {
    useReplayStore.setState({ totalFrames: 3, currentFrame: 2, isPlaying: true, events: [replayEvent('e0', 0), replayEvent('e1', 1), replayEvent('e2', 2)] });
    useReplayStore.getState().nextFrame();
    expect(useReplayStore.getState().isPlaying).toBe(false);
    expect(useReplayStore.getState().currentFrame).toBe(2); // didn't exceed bounds
  });

  it('prevFrame goes back one frame', () => {
    const events = [replayEvent('e0', 0), replayEvent('e1', 1), replayEvent('e2', 2)];
    useReplayStore.setState({ totalFrames: 3, currentFrame: 2, events });
    useReplayStore.getState().prevFrame();
    expect(useReplayStore.getState().currentFrame).toBe(1);
    expect(useReplayStore.getState().selectedEventId).toBeNull();
  });

  it('prevFrame stays at 0 when already at start', () => {
    const events = [replayEvent('e0', 0)];
    useReplayStore.setState({ totalFrames: 1, currentFrame: 0, events });
    useReplayStore.getState().prevFrame();
    expect(useReplayStore.getState().currentFrame).toBe(0);
  });

  it('sets replay data via setReplayData', () => {
    const events = [replayEvent('e0', 0), replayEvent('e1', 1)];
    useReplayStore.getState().setReplayData({
      branch_id: 'main',
      branches: [{ id: 'main', mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: '', updated_at: '' }],
      events,
      current_state: null,
      total_frames: 2,
      duration_seconds: 10.5,
    });

    const state = useReplayStore.getState();
    expect(state.totalFrames).toBe(2);
    expect(state.durationSeconds).toBe(10.5);
    expect(state.currentBranchId).toBe('main');
    expect(state.events).toHaveLength(2);
    expect(state.selectedEventId).toBeNull();
    expect(state.activityContextState).toBeNull();
  });

  it('reset goes back to frame 0 and stops playing', () => {
    const events = [replayEvent('e0', 0), replayEvent('e1', 1)];
    useReplayStore.setState({ isPlaying: true, currentFrame: 1, events });
    useReplayStore.getState().reset();
    expect(useReplayStore.getState().isPlaying).toBe(false);
    expect(useReplayStore.getState().currentFrame).toBe(0);
    expect(useReplayStore.getState().selectedEventId).toBeNull();
  });

  it('setSelectedEventId stores the id without changing the frame index', () => {
    const events = [replayEvent('e0', 0), replayEvent('e1', 1), replayEvent('e2', 2)];
    useReplayStore.setState({ totalFrames: 3, currentFrame: 0, events });
    useReplayStore.getState().setSelectedEventId('e2');
    expect(useReplayStore.getState().selectedEventId).toBe('e2');
    expect(useReplayStore.getState().currentFrame).toBe(0);
  });

  it('setSelectedEventId handles unknown event id gracefully', () => {
    useReplayStore.setState({ events: [replayEvent('e0', 0)] });
    useReplayStore.getState().setSelectedEventId('nonexistent');
    expect(useReplayStore.getState().selectedEventId).toBe('nonexistent');
  });

  it('stores and resets frame activity-context authority state', () => {
    useReplayStore.getState().setActivityContextState({
      kind: 'selected',
      activity_id: 'tool:call-1',
      selection_basis: 'latest_event',
    });
    expect(useReplayStore.getState().activityContextState).toEqual({
      kind: 'selected',
      activity_id: 'tool:call-1',
      selection_basis: 'latest_event',
    });

    useReplayStore.getState().reset();
    expect(useReplayStore.getState().activityContextState).toBeNull();
  });
});

// ====================================================================
// reviewStore
// ====================================================================

describe('reviewStore', () => {
  it('has default state', () => {
    const state = useReviewStore.getState();
    expect(state.reviews).toEqual([]);
    expect(state.comments).toEqual([]);
    expect(state.activeCommentTarget).toBeNull();
    expect(state.isCommentPanelOpen).toBe(true);
  });

  it('sets reviews', () => {
    const reviews = [{
      id: 'r1', mission_id: 'm1', status: 'pending' as const,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }];
    useReviewStore.getState().setReviews(reviews);
    expect(useReviewStore.getState().reviews).toHaveLength(1);
  });

  it('sets comments', () => {
    const comments = [{
      id: 'c1', mission_id: 'm1', body: 'Interesting',
      resolved: false, created_at: '2026-01-01T00:00:00.000Z',
    }];
    useReviewStore.getState().setComments(comments);
    expect(useReviewStore.getState().comments).toHaveLength(1);
  });

  it('adds a comment to existing list', () => {
    useReviewStore.setState({
      comments: [{ id: 'c1', mission_id: 'm1', body: 'First', resolved: false, created_at: '' }],
    });
    useReviewStore.getState().addComment({
      id: 'c2', mission_id: 'm1', body: 'Second',
      resolved: false, created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(useReviewStore.getState().comments).toHaveLength(2);
  });

  it('resolves a comment by id', () => {
    useReviewStore.setState({
      comments: [
        { id: 'c1', mission_id: 'm1', body: 'A', resolved: false, created_at: '' },
        { id: 'c2', mission_id: 'm1', body: 'B', resolved: false, created_at: '' },
      ],
    });
    useReviewStore.getState().resolveComment('c1');
    const comments = useReviewStore.getState().comments;
    expect(comments[0].resolved).toBe(true);
    expect(comments[1].resolved).toBe(false);
  });

  it('does not throw when resolving non-existent comment', () => {
    useReviewStore.getState().resolveComment('nonexistent');
    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it('toggles comment panel', () => {
    useReviewStore.getState().setCommentPanelOpen(false);
    expect(useReviewStore.getState().isCommentPanelOpen).toBe(false);
  });

  it('sets active comment target', () => {
    useReviewStore.getState().setActiveCommentTarget({ type: 'node', id: 'n1' });
    expect(useReviewStore.getState().activeCommentTarget).toEqual({ type: 'node', id: 'n1' });
  });

  it('clears active comment target', () => {
    useReviewStore.getState().setActiveCommentTarget({ type: 'node', id: 'n1' });
    useReviewStore.getState().setActiveCommentTarget(null);
    expect(useReviewStore.getState().activeCommentTarget).toBeNull();
  });
});
