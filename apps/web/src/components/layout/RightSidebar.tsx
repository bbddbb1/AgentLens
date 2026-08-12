'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, CheckCircle2, PanelRightClose, Play, Shield, X, XCircle } from 'lucide-react';
import type { RuntimeExplanationActivity, RuntimeExplanationProjection, RuntimeInterruptState, RuntimeState, RuntimeSummary } from '@agentlens/protocol';
import { RopsEvidence } from '@/components/rops/RopsEvidence';
import { RopsInspector } from '@/components/rops/RopsInspector';
import { useNodeProjection } from '@/hooks/useNodeProjection';
import { api } from '@/lib/api';
import { findFrameForEvent, selectEnvelopeForNode, sequenceNumThroughFrame } from '@/lib/replayFrame';
import { runtimeActivityInspectorView } from '@/lib/runtimeActivityPresentation';
import { useAuditStore } from '@/stores/auditStore';
import { useGraphStore } from '@/stores/graphStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useReplayStore } from '@/stores/replayStore';

interface RightSidebarProps {
  missionId: string;
  onBranchChange?: (branchId: string) => Promise<void>;
  runtimeSummary?: RuntimeSummary | null;
  runtimeExplanation?: RuntimeExplanationProjection | null;
}

interface EvidenceTarget {
  sequenceNum: number;
  eventId: string | null;
  contextKey: string;
}

export function supportedDecisions(interrupt: RuntimeInterruptState): string[] {
  const frameworkGovernance = interrupt.framework === 'langgraph' || interrupt.framework === 'ms_agent_framework' || Boolean(interrupt.supported_decision_types?.length) || interrupt.actionability !== undefined;
  return frameworkGovernance ? (interrupt.supported_decision_types ?? []) : ['approve', 'reject', 'revise', 'resume'];
}

export function isActionableInterrupt(interrupt: RuntimeInterruptState): boolean {
  if (interrupt.governance_available === false || interrupt.decision_state === 'recorded') return false;
  if (interrupt.actionability && interrupt.actionability !== 'actionable') return false;
  const pending = interrupt.request_lifecycle ? interrupt.request_lifecycle === 'pending' : interrupt.status === 'pending';
  return pending && supportedDecisions(interrupt).length > 0;
}

function isObservedInteraction(interrupt: RuntimeInterruptState): boolean {
  if (isActionableInterrupt(interrupt) || interrupt.decision_state === 'recorded') return false;
  return interrupt.status === 'pending' || interrupt.request_lifecycle === 'pending';
}

export function isCurrentStateForSelectedFrame(currentState: RuntimeState | null, missionId: string, branchId: string | null, sequenceNum: number | undefined, isLatestFramePosition: boolean): boolean {
  return Boolean(isLatestFramePosition && currentState && sequenceNum !== undefined && currentState.mission_id === missionId && currentState.branch_id === branchId && currentState.sequence_num === sequenceNum);
}

export function RightSidebar({ missionId, onBranchChange, runtimeSummary = null, runtimeExplanation = null }: RightSidebarProps) {
  const setIsRightCollapsed = useLayoutStore((state) => state.setIsRightCollapsed);
  const { snapshots, selectedNodeId, setSelectedNodeId } = useGraphStore();
  const { currentState, selectedEventId, selectedActivityId, activityContextState, currentBranchId, currentFrame, events, setSelectedEventId, setSelectedActivityId, setCurrentFrame, setIsPlaying } = useReplayStore();
  const auditEvents = useAuditStore((state) => state.events);
  const isEvidenceLoading = useAuditStore((state) => state.isLoading);
  const auditError = useAuditStore((state) => state.error);
  const loadEvidence = useAuditStore((state) => state.load);
  const refreshEvidence = useAuditStore((state) => state.refresh);
  const clearEvidence = useAuditStore((state) => state.clear);
  const [activeTab, setActiveTab] = useState<'inspect' | 'govern'>('inspect');
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null);
  const [decisionComment, setDecisionComment] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const frameSequenceNum = useMemo(() => sequenceNumThroughFrame(snapshots, events, currentFrame), [snapshots, events, currentFrame]);
  useEffect(() => {
    if (!missionId || !currentBranchId || frameSequenceNum === undefined) {
      clearEvidence();
      return;
    }
    loadEvidence(missionId, currentBranchId, frameSequenceNum);
  }, [clearEvidence, currentBranchId, frameSequenceNum, loadEvidence, missionId]);
  const evidenceContextKey = [currentBranchId, currentFrame, selectedActivityId, selectedEventId, selectedNodeId].join(':');
  const activeEvidenceTarget = evidenceTarget?.contextKey === evidenceContextKey ? evidenceTarget : null;

  const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const isLatestFramePosition = snapshots.length > 0 && currentFrame === snapshots.length - 1;
  const hasFrameScopedCurrentState = isCurrentStateForSelectedFrame(currentState, missionId, currentBranchId, frameSequenceNum, isLatestFramePosition);
  const frameCurrentState = hasFrameScopedCurrentState ? currentState : null;

  const selectedNode = useMemo(() => currentSnapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null, [currentSnapshot, selectedNodeId]);
  const selectedActivity = useMemo(
    () => runtimeExplanation?.activities.find((activity) => activity.id === selectedActivityId) ?? null,
    [runtimeExplanation, selectedActivityId],
  );
  const selectedEventEnvelope = useMemo(() => {
    if (selectedNode) {
      const envelope = selectEnvelopeForNode(selectedNode, auditEvents);
      if (envelope) return envelope;
    }
    if (selectedEventId) return auditEvents.find((event) => event.id === selectedEventId) ?? null;
    return null;
  }, [auditEvents, selectedEventId, selectedNode]);
  const selectedAgentId = selectedNode?.type === 'agent' ? (selectedNode.agent_id ?? selectedNode.id) : null;
  const { projection: nodeProjection } = useNodeProjection({
    missionId,
    agentId: selectedAgentId,
    branchId: currentBranchId ?? undefined,
    sequenceNum: frameSequenceNum,
    runtimeSummary,
  });
  const runtimeAgentState = selectedAgentId ? (frameCurrentState?.agents?.[selectedAgentId] ?? null) : null;
  const selectedInterrupt = useMemo(() => {
    if (!selectedNode || !frameCurrentState) return null;
    if (runtimeAgentState?.pending_interrupt_id) {
      return frameCurrentState.interrupts[runtimeAgentState.pending_interrupt_id] ?? null;
    }
    return Object.values(frameCurrentState.interrupts).find((interrupt) => interrupt.interrupt_id === selectedNode.id) ?? null;
  }, [frameCurrentState, runtimeAgentState, selectedNode]);
  const selectedEvidenceEnvelope = useMemo(() => {
    if (!activeEvidenceTarget) return null;
    if (activeEvidenceTarget.eventId) {
      const byId = auditEvents.find((event) => event.id === activeEvidenceTarget.eventId);
      if (byId) return byId;
    }
    return auditEvents.find((event) => event.sequence_num === activeEvidenceTarget.sequenceNum) ?? null;
  }, [activeEvidenceTarget, auditEvents]);

  const openEvidence = (sequenceNum: number) => {
    const envelope = auditEvents.find((event) => event.sequence_num === sequenceNum) ?? null;
    setEvidenceTarget({
      sequenceNum,
      eventId: envelope?.id ?? null,
      contextKey: evidenceContextKey,
    });
  };

  const inspectorInput = {
    node: selectedNode,
    agentProjection: nodeProjection,
    edges: currentSnapshot?.edges ?? [],
    nodes: currentSnapshot?.nodes ?? [],
    mission: null,
    eventEnvelope: selectedEventEnvelope,
    eventEnvelopes: auditEvents,
    runtimeAgentState,
    interrupt: selectedInterrupt,
    branch: null,
    snapshot: null,
    onViewEvidence: openEvidence,
    onJumpToEvent: (sequenceNum: number) => {
      const event = events.find((entry) => entry.sequence_num === sequenceNum);
      if (!event) return;
      setIsPlaying(false);
      const frame = findFrameForEvent(snapshots, events, event.id);
      if (frame !== null) setCurrentFrame(frame);
      setSelectedActivityId(null);
      setSelectedNodeId(null);
      setSelectedEventId(event.id);
      setEvidenceTarget(null);
    },
    onSelectNode: (nodeId: string) => {
      setSelectedActivityId(null);
      setSelectedEventId(null);
      setEvidenceTarget(null);
      setSelectedNodeId(nodeId);
    },
  };

  const liveInterrupts = useMemo(() => Object.values(frameCurrentState?.interrupts ?? {}), [frameCurrentState]);
  const actionableInterrupts = useMemo(() => liveInterrupts.filter(isActionableInterrupt), [liveInterrupts]);
  const observedOnlyInterrupts = useMemo(() => liveInterrupts.filter(isObservedInteraction), [liveInterrupts]);
  const recentDecisions = useMemo(
    () =>
      liveInterrupts
        .filter((interrupt) => interrupt.status !== 'pending')
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
        .slice(0, 5),
    [liveInterrupts],
  );

  const handleDecision = async (interruptId: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => {
    if (!missionId || !hasFrameScopedCurrentState) return;
    setIsSubmittingDecision(true);
    setDecisionError(null);
    try {
      await api.interrupts.decide(
        missionId,
        interruptId,
        {
          decision,
          comment: decisionComment.trim() || undefined,
          idempotency_key: crypto.randomUUID(),
        },
        currentBranchId ?? undefined,
      );
      setDecisionComment('');
      refreshEvidence();
      if (currentBranchId && onBranchChange) await onBranchChange(currentBranchId);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Failed to submit decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const hasSelection = Boolean(selectedNodeId || selectedEventId || selectedActivityId);

  return (
    <aside className="flex h-full flex-col bg-bg-secondary text-text-primary">
      <div className="flex items-center justify-between border-b border-border-subtle bg-bg-primary px-2 pt-2">
        <div className="flex items-center gap-1" role="group" aria-label="Inspector mode">
          {[
            { id: 'inspect' as const, label: 'Inspect', icon: Activity },
            {
              id: 'govern' as const,
              label: 'Govern',
              icon: Shield,
              count: actionableInterrupts.length,
            },
          ].map((tab) => (
            <button key={tab.id} type="button" aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-medium ${activeTab === tab.id ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
              <tab.icon size={13} />
              {tab.label}
              {tab.count ? <span className="font-mono text-[10px] text-warning">{tab.count}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setIsRightCollapsed(true)} aria-label="Close runtime inspector" className="mb-1 mr-1 rounded-sm p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary">
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'inspect' ? (
          <div id="inspect-panel" className="h-full space-y-4 overflow-y-auto p-4">
            {activeEvidenceTarget ? (
              selectedEvidenceEnvelope ? (
                <RopsEvidence envelope={selectedEvidenceEnvelope} onClose={() => setEvidenceTarget(null)} />
              ) : (
                <div className="rounded-sm border border-border-subtle bg-bg-tertiary p-4">
                  <p className="text-[12px] font-medium text-text-primary">Recorded evidence unavailable</p>
                  <p className="mt-1 text-[11px] text-text-muted">{isEvidenceLoading ? `Loading event at sequence ${activeEvidenceTarget.sequenceNum}…` : `No EventEnvelope was returned for sequence ${activeEvidenceTarget.sequenceNum}.`}</p>
                  <button type="button" onClick={() => setEvidenceTarget(null)} className="mt-3 text-[11px] text-accent hover:text-accent-strong">
                    Back to inspector
                  </button>
                </div>
              )
            ) : selectedActivity ? (
              <RuntimeActivityInspector activity={selectedActivity} onViewEvidence={openEvidence} />
            ) : selectedNode ? (
              <div className="space-y-3">
                {selectedNode.metadata?.runtime_activity_representation === 'multiple_activities_not_representable' && (
                  <div className="rounded-sm border border-warning/25 bg-bg-tertiary p-3 text-[11px] text-text-secondary">
                    This graph node is a recorded span containing {String(selectedNode.metadata.runtime_activity_count ?? 'multiple')} canonical activities. No single activity identity, lifecycle, or outcome is assigned to the node.
                  </div>
                )}
                <RopsInspector {...inspectorInput} />
              </div>
            ) : selectedEventEnvelope ? (
              <div className="space-y-2 rounded-sm border border-border-subtle bg-bg-tertiary p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">Selected event</p>
                <p className="text-[13px] font-semibold text-text-primary">{selectedEventEnvelope.event_type.replace(/[._]/g, ' ')}</p>
                <p className="font-mono text-[10px] text-text-muted">
                  seq #{selectedEventEnvelope.sequence_num} · {selectedEventEnvelope.origin_framework ?? 'framework not recorded'}
                </p>
                <button type="button" onClick={() => openEvidence(selectedEventEnvelope.sequence_num)} className="text-[11px] text-accent hover:text-accent-strong">
                  View recorded evidence
                </button>
              </div>
            ) : hasSelection && isEvidenceLoading ? (
              <p className="py-10 text-center text-[11px] text-text-muted">Loading recorded facts for the selection…</p>
            ) : hasSelection ? (
              <div className="rounded-sm border border-warning/25 bg-bg-tertiary p-3 text-[11px] text-text-secondary">The selected runtime object is not present in this authoritative frame.</div>
            ) : (
              <FrameOverview state={activityContextState} />
            )}
            {!activeEvidenceTarget && isEvidenceLoading && <p className="text-[10px] text-text-muted">Loading recorded evidence…</p>}
            {auditError && (
              <p role="alert" className="rounded-sm border border-error/25 bg-bg-tertiary p-2 text-[11px] text-error">
                Recorded evidence unavailable: {auditError}
              </p>
            )}
          </div>
        ) : (
          <GovernPanel
            hasFrameScopedCurrentState={hasFrameScopedCurrentState}
            isLatestFramePosition={isLatestFramePosition}
            actionableInterrupts={actionableInterrupts}
            observedOnlyInterrupts={observedOnlyInterrupts}
            recentDecisions={recentDecisions}
            decisionComment={decisionComment}
            setDecisionComment={setDecisionComment}
            decisionError={decisionError}
            isSubmittingDecision={isSubmittingDecision}
            onDecision={handleDecision}
            onJumpLatest={() => {
              setIsPlaying(false);
              setCurrentFrame(Math.max(snapshots.length - 1, 0));
            }}
          />
        )}
      </div>
    </aside>
  );
}

function RuntimeActivityInspector({ activity, onViewEvidence }: { activity: RuntimeExplanationActivity; onViewEvidence: (sequenceNum: number) => void }) {
  const view = runtimeActivityInspectorView(activity);
  return (
    <div className="space-y-4 rounded-sm border border-border-subtle bg-bg-tertiary p-4">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">Canonical runtime activity</p>
        <h2 className="mt-2 text-[14px] font-semibold text-text-primary">{view.title}</h2>
        <p className="mt-1 text-[11px] capitalize text-text-muted">{view.kind}</p>
      </div>
      <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-2 text-[11px]">
        <dt className="text-text-muted">Lifecycle</dt><dd className="text-text-primary">{view.lifecycle}{view.lifecycleProvenance && <span className="ml-1 text-text-muted">· {view.lifecycleProvenance.basis} · {view.lifecycleProvenance.condition.replace(/_/g, ' ')}</span>}</dd>
        <dt className="text-text-muted">Outcome</dt><dd className="text-text-primary">{view.outcome}{view.outcomeProvenance && <span className="ml-1 text-text-muted">· {view.outcomeProvenance.basis} · {view.outcomeProvenance.condition.replace(/_/g, ' ')}</span>}</dd>
        <dt className="text-text-muted">Activity ID</dt><dd className="break-all font-mono text-text-secondary">{view.id}</dd>
        {view.invocationId && <><dt className="text-text-muted">Invocation ID</dt><dd className="break-all font-mono text-text-secondary">{view.invocationId}</dd></>}
        {view.sourceSpanId && <><dt className="text-text-muted">Source span</dt><dd className="break-all font-mono text-text-secondary">{view.sourceSpanId}</dd></>}
      </dl>
      {view.limitation && <p className="rounded-sm border border-warning/25 p-2 text-[11px] text-text-secondary">{view.limitation}</p>}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">Supporting evidence</p>
        {(view.lifecycleProvenance?.evidenceRefs ?? []).map((reference, index) => (
          <button key={`lifecycle:${reference.eventId}:${index}`} type="button" onClick={() => onViewEvidence(reference.sequenceNum)} className="mr-2 text-[11px] text-accent hover:text-accent-strong">
            Lifecycle {reference.eventId} · sequence #{reference.sequenceNum}
          </button>
        ))}
        {(view.outcomeProvenance?.evidenceRefs ?? []).map((reference, index) => (
          <button key={`outcome:${reference.eventId}:${index}`} type="button" onClick={() => onViewEvidence(reference.sequenceNum)} className="mr-2 text-[11px] text-accent hover:text-accent-strong">
            Outcome {reference.eventId} · sequence #{reference.sequenceNum}
          </button>
        ))}
        {!view.lifecycleProvenance && !view.outcomeProvenance && view.evidenceRefs.map((reference, index) => (
          <button key={`${reference.eventId}:${index}`} type="button" onClick={() => onViewEvidence(reference.sequenceNum)} className="mr-2 text-[11px] text-accent hover:text-accent-strong">
            Activity {reference.eventId} · sequence #{reference.sequenceNum}
          </button>
        ))}
      </div>
    </div>
  );
}

function FrameOverview({ state }: { state: ReturnType<typeof useReplayStore.getState>['activityContextState'] }) {
  const message = state?.kind === 'no_activity' ? 'No selectable runtime activity exists at this frame.' : 'This is the authoritative frame overview.';
  return (
    <div className="rounded-sm border border-border-subtle bg-bg-tertiary p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">Frame overview</p>
      <p className="mt-2 text-[12px] text-text-secondary">{message}</p>
      <p className="mt-1 text-[11px] text-text-muted">Select a timeline activity, graph node, or recorded event to inspect its facts.</p>
      {state?.selection_basis && <p className="mt-3 font-mono text-[10px] text-text-faint">basis: {state.selection_basis}</p>}
    </div>
  );
}

interface GovernPanelProps {
  hasFrameScopedCurrentState: boolean;
  isLatestFramePosition: boolean;
  actionableInterrupts: RuntimeInterruptState[];
  observedOnlyInterrupts: RuntimeInterruptState[];
  recentDecisions: RuntimeInterruptState[];
  decisionComment: string;
  setDecisionComment: (value: string) => void;
  decisionError: string | null;
  isSubmittingDecision: boolean;
  onDecision: (id: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => Promise<void>;
  onJumpLatest: () => void;
}

function GovernPanel({ hasFrameScopedCurrentState, isLatestFramePosition, actionableInterrupts, observedOnlyInterrupts, recentDecisions, decisionComment, setDecisionComment, decisionError, isSubmittingDecision, onDecision, onJumpLatest }: GovernPanelProps) {
  return (
    <div id="govern-panel" className="h-full space-y-4 overflow-y-auto p-4">
      <h2 className="flex items-center gap-1.5 text-[12px] font-semibold text-text-primary">
        <AlertTriangle size={14} className="text-warning" />
        Governance
      </h2>
      {!hasFrameScopedCurrentState ? (
        <div className="rounded-sm border border-border-subtle bg-bg-tertiary p-4">
          <p className="text-[12px] font-medium text-text-primary">{isLatestFramePosition ? 'Live governance state unavailable' : 'Governance is available at the latest frame'}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{isLatestFramePosition ? 'The latest runtime state does not match this authoritative frame, so decision controls remain fail-closed.' : 'Historical replay never exposes later actionable requests. Return to the latest frame to review current governance state.'}</p>
          {!isLatestFramePosition && (
            <button type="button" onClick={onJumpLatest} className="mt-3 rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 text-[11px] text-text-primary hover:bg-bg-hover">
              Go to latest frame
            </button>
          )}
        </div>
      ) : actionableInterrupts.length > 0 ? (
        <div className="space-y-3">
          <textarea value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} placeholder="Optional decision note" aria-label="Decision note" className="h-20 w-full resize-none rounded-sm border border-border-default bg-bg-primary px-3 py-2 text-[12px] text-text-primary placeholder:text-text-faint" />
          {decisionError && (
            <div role="alert" className="flex items-center gap-2 rounded-sm border border-error/30 bg-bg-tertiary p-2 text-[11px] text-error">
              <XCircle size={12} />
              <p>{decisionError}</p>
            </div>
          )}
          {actionableInterrupts.map((interrupt) => (
            <InterruptCard key={interrupt.interrupt_id} interrupt={interrupt} isSubmitting={isSubmittingDecision} onDecision={onDecision} />
          ))}
        </div>
      ) : (
        <div className="rounded-sm border border-border-subtle bg-bg-tertiary px-4 py-6 text-center">
          <CheckCircle2 size={20} className="mx-auto text-success" />
          <p className="mt-2 text-[12px] font-medium text-text-secondary">No actionable interaction</p>
          <p className="mt-1 text-[11px] text-text-muted">Decision controls appear only for a supported, actionable request.</p>
        </div>
      )}

      {hasFrameScopedCurrentState && observedOnlyInterrupts.length > 0 && (
        <section className="space-y-2 border-t border-border-subtle pt-4">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Observed interactions</h3>
          {observedOnlyInterrupts.map((interrupt) => (
            <InterruptCard key={interrupt.interrupt_id} interrupt={interrupt} isSubmitting={false} onDecision={onDecision} />
          ))}
        </section>
      )}
      {hasFrameScopedCurrentState && recentDecisions.length > 0 && (
        <section className="space-y-2 border-t border-border-subtle pt-4">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Recent governance decisions</h3>
          {recentDecisions.map((interrupt) => (
            <div key={interrupt.interrupt_id} className="space-y-1 rounded-sm border border-border-subtle bg-bg-tertiary p-2.5">
              <p className="text-[10px] text-text-muted">request lifecycle: {interrupt.request_lifecycle ?? interrupt.status}</p>
              <p className="text-[10px] text-text-muted">
                decision: {interrupt.decision_state ?? 'none'} · delivery: {interrupt.delivery_state ?? 'not_requested'} · runtime: {interrupt.runtime_outcome ?? 'unknown'}
              </p>
              <p className="text-[11px] text-text-secondary">{interrupt.reason}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function InterruptCard({ interrupt, isSubmitting, onDecision }: { interrupt: RuntimeInterruptState; isSubmitting: boolean; onDecision: (id: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => Promise<void> }) {
  const frameworkGovernance = interrupt.framework === 'langgraph' || interrupt.framework === 'ms_agent_framework' || Boolean(interrupt.supported_decision_types?.length) || interrupt.actionability !== undefined;
  const supported = supportedDecisions(interrupt);
  const actionable = isActionableInterrupt(interrupt);
  return (
    <div className="space-y-3 rounded-sm border border-warning/30 bg-bg-tertiary p-3">
      <div className="space-y-1">
        <p className="font-mono text-[10px] text-warning">Interrupt {interrupt.interrupt_id}</p>
        <p className="text-[12px] font-medium text-text-primary">{interrupt.safe_prompt || interrupt.reason}</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-text-muted">
          <div>
            <dt className="inline">request: </dt>
            <dd className="inline">{interrupt.request_lifecycle ?? interrupt.status}</dd>
          </div>
          <div>
            <dt className="inline">actionability: </dt>
            <dd className="inline">{interrupt.actionability ?? 'legacy'}</dd>
          </div>
          <div>
            <dt className="inline">decision: </dt>
            <dd className="inline">{interrupt.decision_state ?? 'none'}</dd>
          </div>
          <div>
            <dt className="inline">delivery: </dt>
            <dd className="inline">{interrupt.delivery_state ?? 'not_requested'}</dd>
          </div>
          <div>
            <dt className="inline">runtime: </dt>
            <dd className="inline">{interrupt.runtime_outcome ?? 'unknown'}</dd>
          </div>
        </dl>
      </div>
      {actionable ? (
        <div className="grid grid-cols-2 gap-2">
          {supported.includes('approve') && (
            <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'approve')} disabled={isSubmitting} className="rounded-sm border border-success/40 bg-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-success disabled:opacity-50">
              <Check size={12} className="mr-1 inline" />
              Approve
            </button>
          )}
          {supported.includes('reject') && (
            <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'reject')} disabled={isSubmitting} className="rounded-sm border border-error/40 bg-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-error disabled:opacity-50">
              <X size={12} className="mr-1 inline" />
              Reject
            </button>
          )}
          {(supported.includes('structured_response') || supported.includes('revise')) && (
            <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'revise')} disabled={isSubmitting} className="rounded-sm border border-warning/40 bg-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-warning disabled:opacity-50">
              Respond
            </button>
          )}
          {supported.includes('resume') && !frameworkGovernance && (
            <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'resume')} disabled={isSubmitting} className="rounded-sm border border-info/40 bg-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-info disabled:opacity-50">
              <Play size={12} className="mr-1 inline" />
              Resume
            </button>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-text-muted">{interrupt.governance_available === false ? 'Governance controls unavailable for this deployment.' : interrupt.actionability === 'identity_conflict' ? 'Identity conflict — controls blocked.' : supported.length === 0 && frameworkGovernance ? 'No supported decisions declared for this request.' : 'Observation only — waiting for a live bridge binding.'}</p>
      )}
    </div>
  );
}
