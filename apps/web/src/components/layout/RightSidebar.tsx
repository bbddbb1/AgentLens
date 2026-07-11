'use client';

import { useEffect, useState, useMemo } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';
import { useAuditStore } from '@/stores/auditStore';
import { BranchExplorer } from '@/components/replay/BranchExplorer';
import { api } from '@/lib/api';
import type { MissionAuditEventResponse, RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';
import { useNodeProjection } from '@/hooks/useNodeProjection';
import { RopsInspector } from '@/components/rops/RopsInspector';
import { RopsEvidence } from '@/components/rops/RopsEvidence';
import {
  eventAtFrame,
  findFrameForEvent,
  selectEnvelopeForNode,
  sequenceNumThroughFrame,
} from '@/lib/replayFrame';
import {
  PanelRightClose,
  Activity,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Check,
  X,
  Play,
  FileText,
  Copy,
  Info,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface RightSidebarProps {
  missionId: string;
  onBranchChange?: (branchId: string) => Promise<void>;
  missionObjective?: string;
  missionStatus?: string;
  runtimeExplanation?: RuntimeExplanationProjection | null;
  runtimeSummary?: RuntimeSummary | null;
}

export function RightSidebar({
  missionId,
  onBranchChange,
  missionObjective: _missionObjective = 'Mission overview',
  missionStatus: _missionStatus = 'active',
  runtimeExplanation = null,
  runtimeSummary = null,
}: RightSidebarProps) {
  const { setIsRightCollapsed } = useLayoutStore();
  const { snapshots, selectedNodeId, setSelectedNodeId } = useGraphStore();
  const { currentState, selectedEventId, currentBranchId, currentFrame, events } = useReplayStore();

  const [activeTab, setActiveTab] = useState<'run' | 'govern' | 'audit'>('run');
  const [decisionComment, setDecisionComment] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Compact audit events & integrity state 鈥?owned by the shared audit store
  // so graph node components (hover popovers) can read the same envelopes.
  // The store performs the existing fetch (filtered to sequence_num <= frame)
  // and caches by (missionId, branchId, sequenceNum).
  const auditEvents = useAuditStore((s) => s.events);
  const auditIntegrity = useAuditStore((s) => s.integrity);
  const isAuditLoading = useAuditStore((s) => s.isLoading);
  const loadAudit = useAuditStore((s) => s.load);
  const refreshAudit = useAuditStore((s) => s.refresh);
  // Memoized so its reference is stable across renders when the underlying
  // store values are unchanged (avoids recomputing selectedEventEnvelope).
  const auditData = useMemo<MissionAuditEventResponse | null>(() => {
    if (auditEvents.length === 0 && !auditIntegrity) return null;
    return {
      events: auditEvents,
      integrity: auditIntegrity ?? {
        is_valid: null,
        verification_status: 'unsupported',
        verification_reason: 'Cryptographic hash verification is not implemented for this span-backed runtime evidence.',
        hash_chain_status: 'not_verified',
        branch_id: currentBranchId ?? 'main',
        total_events: auditEvents.length,
      },
    };
  }, [auditEvents, auditIntegrity, currentBranchId]);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const frameSequenceNum = useMemo(
    () => sequenceNumThroughFrame(snapshots, events, currentFrame),
    [snapshots, events, currentFrame],
  );

  useEffect(() => {
    loadAudit(missionId, currentBranchId ?? null, frameSequenceNum);
  }, [loadAudit, missionId, currentBranchId, frameSequenceNum]);

  // Tab auto-selection rules
  useEffect(() => {
    const hasPendingInterrupt = Object.values(currentState?.interrupts ?? {}).some(i => i.status === 'pending');
    const integrityIssue = auditData?.integrity?.is_valid === false;
    const selectionExists = !!selectedNodeId || !!selectedEventId;

    setTimeout(() => {
      if (hasPendingInterrupt) {
        setActiveTab('govern');
      } else if (selectionExists) {
        setActiveTab('run');
      } else if (integrityIssue) {
        setActiveTab('audit');
      } else {
        setActiveTab('run');
      }
    }, 0);
  }, [currentState, selectedNodeId, selectedEventId, auditData?.integrity?.is_valid]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDecision = async (interruptId: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => {
    if (!missionId) return;
    setIsSubmittingDecision(true);
    setDecisionError(null);
    try {
      await api.interrupts.decide(missionId, interruptId, {
        decision,
        comment: decisionComment.trim() || undefined,
        idempotency_key: crypto.randomUUID(),
      }, currentBranchId ?? undefined);
      setDecisionComment('');
      refreshAudit();
      if (onBranchChange && currentBranchId) {
        await onBranchChange(currentBranchId);
      }
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Failed to submit decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const selectedNode = useMemo(() => {
    const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
    if (!currentSnapshot || !selectedNodeId) return null;
    return currentSnapshot.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, currentFrame, snapshots]);

  const selectedEventEnvelope = useMemo(() => {
    if (selectedNode) {
      const nodeEnvelope = selectEnvelopeForNode(selectedNode, auditEvents);
      if (nodeEnvelope) return nodeEnvelope;
    }
    if (selectedEventId && auditData?.events) {
      return auditData.events.find((e) => e.id === selectedEventId) ?? null;
    }
    const frameEvent = eventAtFrame(snapshots, events, currentFrame);
    if (!frameEvent || !auditData?.events) return null;
    return auditData.events.find((e) => e.id === frameEvent.id) ?? (frameEvent as import('@agentlens/protocol').EventEnvelope);
  }, [selectedNode, auditEvents, selectedEventId, auditData, snapshots, events, currentFrame]);

  const selectedAgentId = selectedNode?.type === 'agent'
    ? (selectedNode.agent_id ?? selectedNode.id ?? selectedNode.label)
    : null;

  const { projection: nodeProjection } = useNodeProjection({
    missionId,
    agentId: selectedAgentId,
    branchId: currentBranchId ?? undefined,
    sequenceNum: frameSequenceNum,
    events: events as unknown as import('@agentlens/protocol').MissionEventRecord[],
    runtimeSummary,
  });

  // ROPS L4 evidence view: the operator can open the recorded EventEnvelope for the
  // selected event from the L3 inspector. The envelope comes from the already-
  // fetched audit data (Evidence source per spec 9.4 / section 11).
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // ROPS L3 inspector input: pack the selected object's evidence. The runtime
  // agent state is the in-memory replay source; the node projection is the
  // authoritative L3 source for agents (spec 9.2).
  const currentSnapshotForInspector = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const runtimeAgentState = selectedAgentId
    ? currentState?.agents?.[selectedAgentId] ??
      (selectedNode ? Object.values(currentState?.agents ?? {}).find((a) => a.name === selectedNode.label || a.agent_id === selectedNode.agent_id) ?? null : null)
    : null;
  const selectedInterrupt = useMemo(() => {
    if (!selectedNode) return null;
    // Interrupt selection via pending_interrupt_id on an agent state, or when
    // the selected node id matches an interrupt id.
    const byPending = runtimeAgentState?.pending_interrupt_id
      ? currentState?.interrupts?.[runtimeAgentState.pending_interrupt_id] ?? null
      : null;
    if (byPending) return byPending;
    return Object.values(currentState?.interrupts ?? {}).find((i) => i.interrupt_id === selectedNode.id) ?? null;
  }, [selectedNode, runtimeAgentState, currentState]);

  const inspectorInput = {
    node: selectedNode,
    agentProjection: nodeProjection,
    edges: currentSnapshotForInspector?.edges ?? [],
    nodes: currentSnapshotForInspector?.nodes ?? [],
    mission: null as import('@agentlens/protocol').Mission | null,
    eventEnvelope: selectedEventEnvelope ?? null,
    eventEnvelopes: auditEvents,
    runtimeAgentState: runtimeAgentState ?? null,
    interrupt: selectedInterrupt,
    branch: null as import('@agentlens/protocol').ReplayBranch | null,
    snapshot: null as import('@agentlens/protocol').GraphSnapshot | null,
    onViewEvidence: () => setEvidenceOpen(true),
    onJumpToEvent: (seq: number) => {
      const ev = events.find((e) => e.sequence_num === seq);
      if (ev) {
        const { setSelectedEventId, setCurrentFrame } = useReplayStore.getState();
        const { setSelectedNodeId } = useGraphStore.getState();
        setSelectedEventId(ev.id);
        const frame = findFrameForEvent(snapshots, events, ev.id);
        if (frame !== null) {
          setCurrentFrame(frame);
          const snapshot = snapshots[frame] ?? snapshots[snapshots.length - 1] ?? null;
          const node = snapshot?.nodes.find(
            (entry) =>
              entry.source_span_id === ev.span_id ||
              entry.evidence_span_id === ev.span_id ||
              entry.span_id === ev.span_id,
          );
          setSelectedNodeId(node?.id ?? null);
        }
      }
    },
    onSelectNode: (nodeId: string) => setSelectedNodeId(nodeId),
  };

  // Interrupt lists — actionable pending only when governance allows controls.
  const pendingInterrupts = useMemo(() => {
    return Object.values(currentState?.interrupts ?? {}).filter((i) => {
      if (i.decision_state === 'recorded') return false;
      if (i.status !== 'pending' && i.request_lifecycle && i.request_lifecycle !== 'pending') return false;
      if (i.governance_available === false && i.framework === 'langgraph') return false;
      if (i.actionability && i.actionability !== 'actionable' && i.supported_decision_types?.length) {
        return false;
      }
      return i.status === 'pending' || i.actionability === 'actionable';
    });
  }, [currentState]);

  const observedOnlyInterrupts = useMemo(() => {
    return Object.values(currentState?.interrupts ?? {}).filter((i) =>
      i.status === 'pending'
      && (i.actionability === 'observed_only' || i.actionability === 'unavailable' || i.actionability === 'identity_conflict'),
    );
  }, [currentState]);

  const recentDecisions = useMemo(() => {
    return Object.values(currentState?.interrupts ?? {})
      .filter(i => i.status !== 'pending')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 5);
  }, [currentState]);

  const tabs = [
    { id: 'run' as const, label: 'Run', icon: Activity },
    { id: 'govern' as const, label: 'Govern', icon: Shield, count: pendingInterrupts.length },
    { id: 'audit' as const, label: 'Audit', icon: FileText, alert: auditData?.integrity?.is_valid === false },
  ];

  return (
    <div className="flex flex-col h-full bg-[#12131a] border-l border-[rgba(255,255,255,0.05)] text-[#e8eaf0] select-none">
      {/* Header and Tabs */}
      <div className="flex items-center justify-between px-2 pt-2 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.5)]">
        <div className="flex items-center gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-[11px] font-semibold rounded-t-lg transition-colors flex items-center gap-1.5 relative ${
                activeTab === tab.id
                  ? 'bg-[#1a1b25] text-white border-b-2 border-[#6366f1]'
                  : 'text-[#8f95b2] hover:text-[#c4c7da] hover:bg-[rgba(255,255,255,0.02)]'
              }`}
            >
              <tab.icon size={12} />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#f43f5e]/15 text-[#fb7185] text-[9px] font-bold">
                  {tab.count}
                </span>
              )}
              {tab.alert && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#f43f5e] animate-pulse shrink-0" />
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsRightCollapsed(true)}
          className="p-1 rounded-md mb-1 mr-1 text-[#5d6180] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          title="Collapse right panel (])"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative bg-[#12131a]">
        <AnimatePresence mode="wait">
          {activeTab === 'run' && (
            <motion.div
              key="run"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="h-full overflow-y-auto p-4 space-y-4"
            >
              {/* ROPS L3 Inspector + L4 Evidence View (spec sections 9, 8, 11).
                  Replaces the prior AgentNodeProjectionPanel which rendered the
                  forbidden `generated.*` block (P4). The ROPS inspector reads
                  only `facts` + `recent_runtime_events` and the EventEnvelope. */}
              {selectedNode && (
                <>
                  <div className="rounded-lg border border-[rgba(103,232,249,0.12)] bg-[rgba(103,232,249,0.04)] px-3 py-2 text-[10px] text-[#8f95b2]">
                    <span className="font-semibold text-[#67e8f9]">Frame-consistent view</span>
                    <span className="mx-1.5 text-[#4f536d]">路</span>
                    branch {currentBranchId ?? runtimeExplanation?.branch_id ?? currentSnapshotForInspector?.branch_id ?? 'main'} | seq #{runtimeExplanation?.as_of_sequence_num ?? frameSequenceNum ?? currentSnapshotForInspector?.sequence_num ?? 0} | {runtimeExplanation?.as_of_timestamp ? new Date(runtimeExplanation.as_of_timestamp).toISOString() : currentSnapshotForInspector?.timestamp ? new Date(currentSnapshotForInspector.timestamp).toISOString() : 'unknown time'} | {runtimeExplanation?.projection_version ?? 'runtime_explanation.v1'}
                  </div>
                  <RopsInspector {...inspectorInput} />
                </>
              )}
              {evidenceOpen && selectedEventEnvelope && (
                <RopsEvidence envelope={selectedEventEnvelope} onClose={() => setEvidenceOpen(false)} />
              )}

              {selectedEventEnvelope && (
                <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.025)] p-3.5 relative overflow-hidden group transition-all duration-300">
                  <div className="border-l-3 border-[#06b6d4] pl-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22d3ee]" />
                        <span className="text-[9px] uppercase tracking-[0.12em] text-[#06b6d4] font-bold">Timeline Event Context</span>
                      </div>
                      <span className="text-[9px] bg-[rgba(6,182,212,0.1)] text-[#22d3ee] border border-[#06b6d4]/20 px-2 py-0.5 rounded-md font-mono tracking-wide">
                        seq #{selectedEventEnvelope.sequence_num}
                      </span>
                    </div>
                    <div className="text-[13px] font-semibold text-white tracking-wide uppercase flex items-center gap-1.5">
                      {selectedEventEnvelope.event_type.replace(/[._]/g, ' ')}
                    </div>
                    {typeof selectedEventEnvelope.payload?.event_description === 'string' && (
                      <div className="text-[11px] text-[#9498b0] leading-relaxed bg-[rgba(255,255,255,0.01)] p-2 rounded-lg border border-[rgba(255,255,255,0.02)]">
                        {selectedEventEnvelope.payload.event_description}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Branch Explorer Integration */}
              <div className="border-t border-[rgba(255,255,255,0.05)] pt-3">
                <BranchExplorer
                  missionId={missionId}
                  isCollapsed={false}
                  runtimeSummary={runtimeSummary}
                  onToggleCollapsed={() => {}}
                  onBranchChange={async (bId) => {
                    if (onBranchChange) await onBranchChange(bId);
                  }}
                />
              </div>
            </motion.div>
          )}

          {activeTab === 'govern' && (
            <motion.div
              key="govern"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="h-full overflow-y-auto p-4 space-y-4"
            >
              {/* HITL Interrupt Queue */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#fbbf24] flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    Human Review Queue
                  </span>
                </div>

                <textarea
                  value={decisionComment}
                  onChange={(e) => setDecisionComment(e.target.value)}
                  placeholder="Reviewer notes / justification comments..."
                  className="w-full h-20 resize-none px-3 py-2 text-xs rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] text-[#e8eaf0] placeholder:text-[#3a3d54] outline-none focus:border-[#6366f1]/40 transition-colors"
                />

                {decisionError && (
                  <div className="p-2 text-[11px] rounded bg-[#7f1d1d]/30 text-[#fecaca] border border-[#7f1d1d]/60 flex items-center gap-2">
                    <XCircle size={12} className="text-[#f87171] shrink-0" />
                    <p className="flex-1">{decisionError}</p>
                  </div>
                )}

                {pendingInterrupts.length > 0 ? (
                  <div className="space-y-3 animate-in fade-in duration-200">
                    {pendingInterrupts.map((interrupt) => {
                      const isLangGraphGovernance = interrupt.framework === 'langgraph'
                        || Boolean(interrupt.supported_decision_types?.length)
                        || interrupt.actionability !== undefined;
                      // LangGraph governance: only declared supported types; empty means no buttons.
                      // Legacy non-LangGraph: keep generic approve/reject/revise/resume fallback.
                      const supported = isLangGraphGovernance
                        ? (interrupt.supported_decision_types ?? [])
                        : (['approve', 'reject', 'revise', 'resume'] as const);
                      const showControls = interrupt.governance_available !== false
                        && interrupt.decision_state !== 'recorded'
                        && (interrupt.actionability === 'actionable' || (!isLangGraphGovernance && !interrupt.actionability))
                        && supported.length > 0;
                      const deliveryLabel = interrupt.delivery_state ?? 'not_requested';
                      const runtimeLabel = interrupt.runtime_outcome ?? 'unknown';
                      const deliveryIsError = deliveryLabel === 'failed';
                      const runtimeIsError = runtimeLabel === 'failed';
                      return (
                      <div
                        key={interrupt.interrupt_id}
                        className="rounded-xl border border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.04)] p-3 space-y-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-mono text-[#fbbf24] uppercase tracking-wider font-bold">Interrupt ID: {interrupt.interrupt_id}</span>
                            <span className="text-[9px] text-[#c9b98c]">{new Date(interrupt.updated_at).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-xs text-[#f7e8bf] leading-relaxed font-medium">
                            {interrupt.safe_prompt || interrupt.reason}
                          </p>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-[rgba(255,255,255,0.08)] text-[#9498b0]">
                              decision: {interrupt.decision_state ?? 'none'}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              deliveryIsError
                                ? 'border-[#f59e0b]/40 text-[#fbbf24]'
                                : 'border-[rgba(255,255,255,0.08)] text-[#9498b0]'
                            }`}>
                              delivery: {deliveryLabel}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              runtimeIsError
                                ? 'border-[#f43f5e]/40 text-[#fda4af]'
                                : 'border-[rgba(255,255,255,0.08)] text-[#9498b0]'
                            }`}>
                              runtime: {runtimeLabel}
                            </span>
                          </div>
                        </div>

                        {showControls ? (
                        <div className="grid grid-cols-2 gap-2">
                          {(supported as readonly string[]).includes('approve') && (
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'approve')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#14532d] hover:bg-[#166534] px-2.5 py-1.5 text-xs font-semibold text-[#dcfce7] disabled:opacity-50 transition-colors"
                          >
                            <Check size={12} />
                            Approve
                          </button>
                          )}
                          {(supported as readonly string[]).includes('reject') && (
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'reject')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#7f1d1d] hover:bg-[#991b1b] px-2.5 py-1.5 text-xs font-semibold text-[#fee2e2] disabled:opacity-50 transition-colors"
                          >
                            <X size={12} />
                            Reject
                          </button>
                          )}
                          {((supported as readonly string[]).includes('structured_response') || (supported as readonly string[]).includes('revise')) && (
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'revise')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#78350f] hover:bg-[#92400e] px-2.5 py-1.5 text-xs font-semibold text-[#fef3c7] disabled:opacity-50 transition-colors"
                          >
                            <AlertTriangle size={12} className="text-[#fbbf24]" />
                            Respond
                          </button>
                          )}
                          {(supported as readonly string[]).includes('resume') && !isLangGraphGovernance && (
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'resume')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4c1d95] hover:bg-[#5b21b6] px-2.5 py-1.5 text-xs font-semibold text-[#f3e8ff] disabled:opacity-50 transition-colors"
                          >
                            <Play size={12} className="text-[#c084fc]" />
                            Resume
                          </button>
                          )}
                        </div>
                        ) : (
                          <p className="text-[10px] text-[#9498b0]">
                            {interrupt.governance_available === false
                              ? 'Governance controls unavailable for this deployment.'
                              : interrupt.actionability === 'identity_conflict'
                                ? 'Identity conflict — controls blocked.'
                                : supported.length === 0 && isLangGraphGovernance
                                  ? 'No supported decisions declared for this request.'
                                  : 'Observation only — waiting for a live bridge binding.'}
                          </p>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-8 text-center bg-[rgba(255,255,255,0.01)] rounded-xl border border-dashed border-[rgba(255,255,255,0.04)]">
                    <CheckCircle2 size={24} className="text-[#34d399]/40 mb-2" />
                    <p className="text-xs text-[#9498b0] font-medium">No pending interrupts</p>
                    <p className="text-[10px] text-[#5d6180] mt-0.5">Runtime operations are executing normally.</p>
                    {observedOnlyInterrupts.length > 0 && (
                      <p className="text-[10px] text-[#5d6180] mt-2">
                        {observedOnlyInterrupts.length} observed interrupt(s) are not actionable.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Recent Decisions List */}
              {recentDecisions.length > 0 && (
                <div className="space-y-2 border-t border-[rgba(255,255,255,0.05)] pt-4">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#9498b0] block">Recent Governance Decisions</span>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {recentDecisions.map((interrupt) => {
                      const isApproved = interrupt.status === 'approved' || interrupt.decision === 'approve';
                      const isResumed = interrupt.status === 'resumed' || interrupt.decision === 'resume';
                      const isRevised = interrupt.status === 'revised' || interrupt.decision === 'revise';
                      
                      const badgeBg = isApproved
                        ? 'bg-[#10b981]/10 border-[#10b981]/20 text-[#34d399]'
                        : isResumed
                          ? 'bg-[#818cf8]/10 border-[#818cf8]/20 text-[#a5b4fc]'
                          : isRevised
                            ? 'bg-[#fbbf24]/10 border-[#fbbf24]/20 text-[#fde68a]'
                            : 'bg-[#f43f5e]/10 border-[#f43f5e]/20 text-[#fda4af]';

                      return (
                        <div key={interrupt.interrupt_id} className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] p-2.5 space-y-1">
                          <div className="flex items-center justify-between text-[9px]">
                            <span className={`px-1.5 py-0.5 rounded font-mono uppercase font-bold border ${badgeBg}`}>
                              {interrupt.status}
                            </span>
                            <span className="text-[#5d6180]">{new Date(interrupt.updated_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-[11px] text-[#c4c7da] leading-relaxed">{interrupt.reason}</p>
                          {interrupt.decision_comment && (
                            <p className="text-[10px] text-[#5d6180] leading-relaxed italic bg-[rgba(255,255,255,0.02)] p-1 rounded">
                              Reviewer note: {interrupt.decision_comment}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'audit' && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="h-full overflow-y-auto p-4 space-y-4"
            >
              {/* Hash Chain Integrity Summary Card */}
              {isAuditLoading ? (
                <div className="flex items-center justify-center py-6 gap-2 text-xs text-[#8f95b2]">
                  <Loader2 size={14} className="animate-spin text-[#818cf8]" />
                  <span>Verifying ledger hash integrity...</span>
                </div>
              ) : auditData?.integrity ? (
                <div className={`rounded-xl border p-3 flex items-start gap-3 ${
                  auditData.integrity.is_valid === true
                    ? 'border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.04)]'
                    : 'border-[rgba(244,63,94,0.18)] bg-[rgba(244,63,94,0.04)]'
                }`}>
                  {auditData.integrity.is_valid === true ? (
                    <Shield size={20} className="text-[#34d399] shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert size={20} className="text-[#f43f5e] shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-[#eef1fa] flex items-center gap-1.5">
                      Integrity verification:
                      <span className={auditData.integrity.is_valid === true ? 'text-[#34d399]' : auditData.integrity.is_valid === false ? 'text-[#f43f5e]' : 'text-[#fbbf24]'}>
                        {auditData.integrity.is_valid === true ? 'VERIFIED' : auditData.integrity.is_valid === false ? 'INVALID' : 'NOT VERIFIED'}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#9498b0] leading-relaxed">
                      {auditData.integrity.verification_reason}
                    </p>
                    <div className="text-[9px] font-mono text-[#5d6180]">
                      Branch: {auditData.integrity.branch_id} 鈥?Verified: {auditData.integrity.total_events} events
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Event Provenance Details */}
              {selectedEventEnvelope ? (
                <div className="space-y-3 animate-in fade-in duration-200">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#818cf8] flex items-center gap-1.5">
                    <Info size={13} />
                    Cryptographic Event Provenance
                  </div>

                  <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.01)] p-3 space-y-3 text-[11px] leading-relaxed">
                    
                    {/* Actor Context */}
                    <div className="flex justify-between items-start border-b border-[rgba(255,255,255,0.04)] pb-2">
                      <span className="text-[#8f95b2] font-semibold">Actor Type</span>
                      <span className="font-mono text-white bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 rounded uppercase text-[10px]">
                        {selectedEventEnvelope.actor_type || 'System'}
                      </span>
                    </div>

                    {selectedEventEnvelope.actor_id && (
                      <div className="flex justify-between items-start border-b border-[rgba(255,255,255,0.04)] pb-2">
                        <span className="text-[#8f95b2] font-semibold">Actor ID</span>
                        <span className="font-mono text-[#67e8f9] max-w-[200px] truncate" title={selectedEventEnvelope.actor_id}>
                          {selectedEventEnvelope.actor_id}
                        </span>
                      </div>
                    )}

                    {/* Origin Framework */}
                    <div className="flex justify-between items-start border-b border-[rgba(255,255,255,0.04)] pb-2">
                      <span className="text-[#8f95b2] font-semibold">Origin Framework</span>
                      <span className="font-mono text-[#a5b4fc] capitalize">
                        {selectedEventEnvelope.origin_framework || 'Custom SDK'}
                      </span>
                    </div>

                    {/* LLM Model Provenance */}
                    {selectedEventEnvelope.model && (
                      <div className="border-b border-[rgba(255,255,255,0.04)] pb-2 space-y-1.5">
                        <span className="text-[#8f95b2] font-semibold block">Model Provenance</span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-[rgba(255,255,255,0.02)] p-2 rounded-lg text-[10px] font-mono">
                          {selectedEventEnvelope.model.provider && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Provider</span><span>{selectedEventEnvelope.model.provider}</span></div>
                          )}
                          {selectedEventEnvelope.model.model_name && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Model</span><span className="text-white max-w-[100px] truncate" title={selectedEventEnvelope.model.model_name}>{selectedEventEnvelope.model.model_name}</span></div>
                          )}
                          {selectedEventEnvelope.model.tokens_input !== undefined && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Input Tokens</span><span>{selectedEventEnvelope.model.tokens_input}</span></div>
                          )}
                          {selectedEventEnvelope.model.tokens_output !== undefined && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Output Tokens</span><span>{selectedEventEnvelope.model.tokens_output}</span></div>
                          )}
                          {selectedEventEnvelope.model.temperature !== undefined && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Temp</span><span>{selectedEventEnvelope.model.temperature}</span></div>
                          )}
                          {selectedEventEnvelope.model.stop_reason && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Stop</span><span>{selectedEventEnvelope.model.stop_reason}</span></div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Policy / Governance */}
                    {selectedEventEnvelope.policy && (
                      <div className="border-b border-[rgba(255,255,255,0.04)] pb-2 space-y-1.5">
                        <span className="text-[#8f95b2] font-semibold block">Applied Policy</span>
                        <div className="bg-[rgba(52,211,153,0.02)] border border-[rgba(52,211,153,0.1)] p-2 rounded-lg text-[10px] space-y-1">
                          <div className="flex justify-between"><span className="text-[#5d6180]">Rule ID</span><span className="font-mono text-[#34d399]">{selectedEventEnvelope.policy.rule_id}</span></div>
                          <div className="flex justify-between"><span className="text-[#5d6180]">Decision</span><span className="uppercase font-bold text-[#34d399]">{selectedEventEnvelope.policy.decision}</span></div>
                          {selectedEventEnvelope.policy.reason && (
                            <p className="text-[#9498b0] text-[9px] pt-1 border-t border-[rgba(52,211,153,0.06)] leading-relaxed italic">{selectedEventEnvelope.policy.reason}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Causal Context */}
                    {selectedEventEnvelope.causal && (
                      <div className="border-b border-[rgba(255,255,255,0.04)] pb-2 space-y-1.5">
                        <span className="text-[#8f95b2] font-semibold block">Causal Chain Connections</span>
                        <div className="grid gap-1 font-mono text-[9px] bg-[rgba(255,255,255,0.02)] p-2 rounded-lg">
                          {selectedEventEnvelope.causal.parent_span_id && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Parent Span</span><span className="text-[#818cf8]">{selectedEventEnvelope.causal.parent_span_id}</span></div>
                          )}
                          {selectedEventEnvelope.causal.tool_call_id && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">Tool Call</span><span>{selectedEventEnvelope.causal.tool_call_id}</span></div>
                          )}
                          {selectedEventEnvelope.causal.decision_for_event_id && (
                            <div className="flex justify-between"><span className="text-[#5d6180]">HITL Decision For</span><span className="text-[#fbbf24]">{selectedEventEnvelope.causal.decision_for_event_id}</span></div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Cryptographic Signatures & Hash Linkages */}
                    <div className="space-y-1.5">
                      <span className="text-[#8f95b2] font-semibold block">Cryptographic Linkage</span>
                      
                      <div className="space-y-1 font-mono text-[10px]">
                        <div className="flex flex-col bg-[rgba(0,0,0,0.18)] p-2 rounded border border-[rgba(255,255,255,0.02)] relative group">
                          <span className="text-[8px] uppercase tracking-wider text-[#5d6180]">Content Hash (SHA-256)</span>
                          <span className="text-[#cfd3e6] truncate pr-8" title={selectedEventEnvelope.content_hash || 'None'}>
                            {selectedEventEnvelope.content_hash || 'No hash recorded.'}
                          </span>
                          {selectedEventEnvelope.content_hash && (
                            <button
                              onClick={() => copyToClipboard(selectedEventEnvelope.content_hash!, 'content')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[#5d6180] hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
                              title="Copy hash"
                            >
                              {copiedField === 'content' ? <CheckCircle2 size={12} className="text-[#34d399]" /> : <Copy size={12} />}
                            </button>
                          )}
                        </div>

                        <div className="flex flex-col bg-[rgba(0,0,0,0.18)] p-2 rounded border border-[rgba(255,255,255,0.02)] relative group">
                          <span className="text-[8px] uppercase tracking-wider text-[#5d6180]">Previous Link Hash</span>
                          <span className="text-[#8f95b2] truncate pr-8" title={selectedEventEnvelope.previous_hash || 'None'}>
                            {selectedEventEnvelope.previous_hash || '0000000000000000000000000000000000000000000000000000000000000000 (Genesis)'}
                          </span>
                          {selectedEventEnvelope.previous_hash && (
                            <button
                              onClick={() => copyToClipboard(selectedEventEnvelope.previous_hash!, 'prev')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[#5d6180] hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
                              title="Copy previous hash"
                            >
                              {copiedField === 'prev' ? <CheckCircle2 size={12} className="text-[#34d399]" /> : <Copy size={12} />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-10 text-center bg-[rgba(255,255,255,0.01)] rounded-xl border border-dashed border-[rgba(255,255,255,0.04)]">
                  <FileText size={24} className="text-[#5d6180] mb-2" />
                  <p className="text-xs text-[#9498b0]">Select an event to view provenance</p>
                  <p className="text-[10px] text-[#5d6180] mt-0.5">Detailed actor, model metrics, and hash logs will display here.</p>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

