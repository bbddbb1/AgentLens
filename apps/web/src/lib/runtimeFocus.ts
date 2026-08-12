import type {
  GraphNode,
  GraphSnapshot,
  MissionEventRecord,
  RuntimeActivity,
  RuntimeExplanationActivity,
  RuntimeExplanationProjection,
} from '@agentlens/protocol';
import { findFrameForEvent } from './replayFrame';

type FocusableRuntimeActivity = RuntimeExplanationActivity | RuntimeActivity;

export interface RuntimeActivityFocusTarget {
  setSelectedEventId: (eventId: string | null) => void;
  setSelectedActivityId: (activityId: string | null) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setCurrentFrame: (frame: number) => void;
}

export function matchNodeToActivity(
  snapshot: GraphSnapshot | null,
  activity: FocusableRuntimeActivity,
): GraphNode | null {
  if (!snapshot) return null;
  return snapshot.nodes.find((node) => node.activity?.id === activity.id) ?? null;
}

export function resolveSelectedActivity(
  explanation: RuntimeExplanationProjection | null | undefined,
  snapshot: GraphSnapshot | null,
  selectedActivityId: string | null,
  selectedNodeId: string | null,
  selectedEventId: string | null,
): RuntimeExplanationActivity | null {
  const activities = explanation?.activities ?? [];
  if (activities.length === 0) return null;
  const authoritativeState = explanation?.selected_activity_state;

  if (selectedActivityId) {
    const byId = activities.find((activity) => activity.id === selectedActivityId);
    if (byId) return byId;
  }

  if (selectedNodeId && snapshot) {
    const selectedNode = snapshot.nodes.find((node) => node.id === selectedNodeId) ?? null;
    if (selectedNode?.activity?.id) {
      const byNodeActivity = activities.find((activity) => activity.id === selectedNode.activity?.id);
      if (byNodeActivity) return byNodeActivity;
    }
  }

  if (selectedEventId) {
    const byEvent = activities.find((activity) =>
      activity.evidence_refs.some((ref) => ref.event_id === selectedEventId),
    );
    if (byEvent) return byEvent;
  }

  if (authoritativeState?.kind === 'selected' && authoritativeState.activity_id) {
    return activities.find((activity) => activity.id === authoritativeState.activity_id) ?? null;
  }

  return null;
}

export function focusRuntimeActivity(
  activity: FocusableRuntimeActivity,
  snapshots: readonly GraphSnapshot[],
  events: readonly MissionEventRecord[],
  target: RuntimeActivityFocusTarget,
): void {
  const eventId = 'evidence_refs' in activity ? activity.evidence_refs[0]?.event_id ?? null : null;
  const frameIndex = eventId ? findFrameForEvent(snapshots, events, eventId) : null;
  const selectedFrame =
    frameIndex !== null ? Math.max(0, Math.min(frameIndex, Math.max(snapshots.length - 1, 0))) : null;
  const snapshot =
    selectedFrame !== null
      ? snapshots[selectedFrame] ?? null
      : snapshots[snapshots.length - 1] ?? null;
  const node = matchNodeToActivity(snapshot, activity);

  if (selectedFrame !== null) {
    target.setCurrentFrame(selectedFrame);
  }
  target.setSelectedEventId(eventId);
  target.setSelectedActivityId(activity.id);
  target.setSelectedNodeId(node?.id ?? null);
}
