import { MissionEventRecord, BranchCapability, BranchPointKind } from '@agentlens/protocol';

export class BranchClassifier {
  static classify(event: MissionEventRecord): { capability: BranchCapability; kind?: BranchPointKind } {
    const type = event.event_type;

    // HITL interrupts
    if (
      type === 'interrupt.requested' ||
      type === 'interrupt.decision' ||
      type === 'agent.registered' ||
      type === 'agent.interrupt.requested' ||
      type === 'agent.human.decision'
    ) {
      return { capability: { is_branchable: true }, kind: 'hitl' };
    }

    // Pre/Post Tool events
    if (type === 'tool.called' || type === 'agent.tool.call') {
      return { capability: { is_branchable: true }, kind: 'pre_tool' };
    }
    if (
      type === 'tool.completed' ||
      type === 'tool.failed' ||
      type === 'agent.tool.result' ||
      type === 'agent.tool.failed'
    ) {
      return { capability: { is_branchable: true }, kind: 'post_tool' };
    }

    // Routing / Decisions
    if (
      type === 'delegation' ||
      type === 'handoff.requested' ||
      type === 'escalation' ||
      type === 'agent.decision' ||
      type === 'agent.delegation' ||
      type === 'agent.handoff.requested' ||
      type === 'agent.escalation'
    ) {
      return { capability: { is_branchable: true }, kind: 'routing' };
    }

    // Reviews
    if (
      type === 'review.started' ||
      type === 'review.approved' ||
      type === 'review.changes_requested' ||
      type === 'review.rejected' ||
      type === 'agent.review.started' ||
      type === 'agent.review.approved' ||
      type === 'agent.review.changes_requested' ||
      type === 'agent.review.rejected'
    ) {
      return { capability: { is_branchable: true }, kind: 'review_divergence' };
    }

    // Deterministic frames or non-branchable
    return {
      capability: { is_branchable: false, reason: 'Deterministic frame' },
    };
  }
}
