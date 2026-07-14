'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, CheckCircle2, PanelRightClose, Play, Shield, X, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RuntimeInterruptState, RuntimeSummary } from '@agentlens/protocol';
import { RopsEvidence } from '@/components/rops/RopsEvidence';
import { RopsInspector } from '@/components/rops/RopsInspector';
import { useNodeProjection } from '@/hooks/useNodeProjection';
import { api } from '@/lib/api';
import { eventAtFrame, findFrameForEvent, selectEnvelopeForNode, sequenceNumThroughFrame } from '@/lib/replayFrame';
import { useAuditStore } from '@/stores/auditStore';
import { useGraphStore } from '@/stores/graphStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useReplayStore } from '@/stores/replayStore';

interface RightSidebarProps {
  missionId: string;
  onBranchChange?: (branchId: string) => Promise<void>;
  runtimeSummary?: RuntimeSummary | null;
}

function supportedDecisions(interrupt: RuntimeInterruptState): string[] {
  const frameworkGovernance = interrupt.framework === 'langgraph'
    || interrupt.framework === 'ms_agent_framework'
    || Boolean(interrupt.supported_decision_types?.length)
    || interrupt.actionability !== undefined;
  return frameworkGovernance
    ? interrupt.supported_decision_types ?? []
    : ['approve', 'reject', 'revise', 'resume'];
}

function isActionableInterrupt(interrupt: RuntimeInterruptState): boolean {
  if (interrupt.governance_available === false || interrupt.decision_state === 'recorded') return false;
  if (interrupt.actionability && interrupt.actionability !== 'actionable') return false;
  const pending = interrupt.request_lifecycle
    ? interrupt.request_lifecycle === 'pending'
    : interrupt.status === 'pending';
  return pending && supportedDecisions(interrupt).length > 0;
}

function isObservedInteraction(interrupt: RuntimeInterruptState): boolean {
  if (isActionableInterrupt(interrupt) || interrupt.decision_state === 'recorded') return false;
  return interrupt.status === 'pending' || interrupt.request_lifecycle === 'pending';
}

export function RightSidebar({ missionId, onBranchChange, runtimeSummary = null }: RightSidebarProps) {
  const { setIsRightCollapsed } = useLayoutStore();
  const { snapshots, selectedNodeId, setSelectedNodeId } = useGraphStore();
  const { currentState, selectedEventId, currentBranchId, currentFrame, events } = useReplayStore();
  const auditEvents = useAuditStore((state) => state.events);
  const isEvidenceLoading = useAuditStore((state) => state.isLoading);
  const loadEvidence = useAuditStore((state) => state.load);
  const refreshEvidence = useAuditStore((state) => state.refresh);
  const [activeTab, setActiveTab] = useState<'inspect' | 'govern'>('inspect');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [decisionComment, setDecisionComment] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const frameSequenceNum = useMemo(() => sequenceNumThroughFrame(snapshots, events, currentFrame), [snapshots, events, currentFrame]);
  useEffect(() => { loadEvidence(missionId, currentBranchId, frameSequenceNum); }, [currentBranchId, frameSequenceNum, loadEvidence, missionId]);

  const selectedNode = useMemo(() => {
    const snapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
    return snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [currentFrame, selectedNodeId, snapshots]);
  const selectedEventEnvelope = useMemo(() => {
    if (selectedNode) {
      const envelope = selectEnvelopeForNode(selectedNode, auditEvents);
      if (envelope) return envelope;
    }
    if (selectedEventId) return auditEvents.find((event) => event.id === selectedEventId) ?? null;
    const frameEvent = eventAtFrame(snapshots, events, currentFrame);
    return frameEvent ? auditEvents.find((event) => event.id === frameEvent.id) ?? null : null;
  }, [auditEvents, currentFrame, events, selectedEventId, selectedNode, snapshots]);
  const selectedAgentId = selectedNode?.type === 'agent' ? selectedNode.agent_id ?? selectedNode.id : null;
  const { projection: nodeProjection } = useNodeProjection({ missionId, agentId: selectedAgentId, branchId: currentBranchId ?? undefined, sequenceNum: frameSequenceNum, runtimeSummary });
  const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const runtimeAgentState = selectedAgentId ? currentState?.agents?.[selectedAgentId] ?? null : null;
  const selectedInterrupt = useMemo(() => {
    if (!selectedNode) return null;
    if (runtimeAgentState?.pending_interrupt_id) return currentState?.interrupts?.[runtimeAgentState.pending_interrupt_id] ?? null;
    return Object.values(currentState?.interrupts ?? {}).find((interrupt) => interrupt.interrupt_id === selectedNode.id) ?? null;
  }, [currentState, runtimeAgentState, selectedNode]);
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
    onViewEvidence: () => setEvidenceOpen(true),
    onJumpToEvent: (sequenceNum: number) => {
      const event = events.find((entry) => entry.sequence_num === sequenceNum);
      if (!event) return;
      const { setSelectedEventId, setCurrentFrame } = useReplayStore.getState();
      setSelectedEventId(event.id);
      const frame = findFrameForEvent(snapshots, events, event.id);
      if (frame !== null) setCurrentFrame(frame);
    },
    onSelectNode: (nodeId: string) => setSelectedNodeId(nodeId),
  };

  const actionableInterrupts = useMemo(() => Object.values(currentState?.interrupts ?? {}).filter(isActionableInterrupt), [currentState]);
  const observedOnlyInterrupts = useMemo(() => Object.values(currentState?.interrupts ?? {}).filter(isObservedInteraction), [currentState]);
  const recentDecisions = useMemo(() => Object.values(currentState?.interrupts ?? {}).filter((interrupt) => interrupt.status !== 'pending').sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)).slice(0, 5), [currentState]);

  const handleDecision = async (interruptId: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => {
    if (!missionId) return;
    setIsSubmittingDecision(true);
    setDecisionError(null);
    try {
      await api.interrupts.decide(missionId, interruptId, { decision, comment: decisionComment.trim() || undefined, idempotency_key: crypto.randomUUID() }, currentBranchId ?? undefined);
      setDecisionComment('');
      refreshEvidence();
      if (currentBranchId && onBranchChange) await onBranchChange(currentBranchId);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Failed to submit decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  return (
    <aside className="flex flex-col h-full bg-[#12131a] border-l border-[rgba(255,255,255,0.05)] text-[#e8eaf0]">
      <div className="flex items-center justify-between px-2 pt-2 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.5)]">
        <div className="flex items-center gap-0.5">
          {([
            { id: 'inspect' as const, label: 'Inspect', icon: Activity },
            { id: 'govern' as const, label: 'Govern', icon: Shield, count: actionableInterrupts.length },
          ]).map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`px-3 py-2 text-[11px] font-semibold rounded-t-lg transition-colors flex items-center gap-1.5 ${activeTab === tab.id ? 'bg-[#1a1b25] text-white border-b-2 border-[#6366f1]' : 'text-[#8f95b2] hover:text-[#c4c7da]'}`}><tab.icon size={12} />{tab.label}{tab.count ? <span className="px-1.5 py-0.5 rounded-full bg-[#f43f5e]/15 text-[#fb7185] text-[9px] font-bold">{tab.count}</span> : null}</button>)}
        </div>
        <button type="button" onClick={() => setIsRightCollapsed(true)} className="p-1 rounded-md mb-1 mr-1 text-[#5d6180] hover:text-[#e8eaf0]" title="Collapse right panel (])"><PanelRightClose size={14} /></button>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'inspect' ? <motion.div key="inspect" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="h-full overflow-y-auto p-4 space-y-4">
            {selectedNode ? <RopsInspector {...inspectorInput} /> : selectedEventEnvelope ? <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] p-3 space-y-2"><p className="text-[10px] uppercase tracking-[0.12em] text-[#67e8f9]">Selected event</p><p className="text-[13px] font-semibold text-white">{selectedEventEnvelope.event_type.replace(/[._]/g, ' ')}</p><p className="text-[10px] font-mono text-[#8f95b2]">seq #{selectedEventEnvelope.sequence_num} | {selectedEventEnvelope.origin_framework ?? 'framework not recorded'}</p><button type="button" onClick={() => setEvidenceOpen(true)} className="text-[10px] text-[#67e8f9] hover:text-white">View recorded evidence</button></div> : <div className="py-10 text-center text-[11px] text-[#5d6180]">Select a timeline activity, graph node, or event to inspect its recorded facts.</div>}
            {isEvidenceLoading && <p className="text-[10px] text-[#5d6180]">Loading recorded evidence…</p>}
            {evidenceOpen && <RopsEvidence envelope={selectedEventEnvelope} onClose={() => setEvidenceOpen(false)} />}
          </motion.div> : <GovernPanel actionableInterrupts={actionableInterrupts} observedOnlyInterrupts={observedOnlyInterrupts} recentDecisions={recentDecisions} decisionComment={decisionComment} setDecisionComment={setDecisionComment} decisionError={decisionError} isSubmittingDecision={isSubmittingDecision} onDecision={handleDecision} />}
        </AnimatePresence>
      </div>
    </aside>
  );
}

function GovernPanel({ actionableInterrupts, observedOnlyInterrupts, recentDecisions, decisionComment, setDecisionComment, decisionError, isSubmittingDecision, onDecision }: { actionableInterrupts: RuntimeInterruptState[]; observedOnlyInterrupts: RuntimeInterruptState[]; recentDecisions: RuntimeInterruptState[]; decisionComment: string; setDecisionComment: (value: string) => void; decisionError: string | null; isSubmittingDecision: boolean; onDecision: (id: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => Promise<void> }) {
  return <motion.div key="govern" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="h-full overflow-y-auto p-4 space-y-4">
    <div className="space-y-3"><span className="text-[11px] font-bold uppercase tracking-wider text-[#fbbf24] flex items-center gap-1.5"><AlertTriangle size={13} />Govern</span>
      {actionableInterrupts.length > 0 ? <><textarea value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} placeholder="Optional decision note" aria-label="Decision note" className="w-full h-20 resize-none px-3 py-2 text-xs rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] text-[#e8eaf0]" />{decisionError && <div className="p-2 text-[11px] rounded bg-[#7f1d1d]/30 text-[#fecaca] flex items-center gap-2"><XCircle size={12} /><p>{decisionError}</p></div>}{actionableInterrupts.map((interrupt) => <InterruptCard key={interrupt.interrupt_id} interrupt={interrupt} isSubmitting={isSubmittingDecision} onDecision={onDecision} />)}</> : <div className="flex flex-col items-center py-8 text-center bg-[rgba(255,255,255,0.01)] rounded-xl border border-dashed border-[rgba(255,255,255,0.04)]"><CheckCircle2 size={24} className="text-[#34d399]/40 mb-2" /><p className="text-xs text-[#9498b0] font-medium">No actionable interaction</p><p className="text-[10px] text-[#5d6180] mt-1">Decision controls appear only for a supported, actionable request.</p></div>}
    </div>
    {observedOnlyInterrupts.length > 0 && <div className="space-y-2 border-t border-[rgba(255,255,255,0.05)] pt-4"><span className="text-[10px] uppercase font-bold tracking-wider text-[#9498b0] block">Observed interactions</span>{observedOnlyInterrupts.map((interrupt) => <InterruptCard key={interrupt.interrupt_id} interrupt={interrupt} isSubmitting={false} onDecision={onDecision} />)}</div>}
    {recentDecisions.length > 0 && <div className="space-y-2 border-t border-[rgba(255,255,255,0.05)] pt-4"><span className="text-[10px] uppercase font-bold tracking-wider text-[#9498b0] block">Recent Governance Decisions</span>{recentDecisions.map((interrupt) => <div key={interrupt.interrupt_id} className="rounded-lg border border-[rgba(255,255,255,0.04)] p-2.5 space-y-1"><p className="text-[10px] text-[#8f95b2]">request lifecycle: {interrupt.request_lifecycle ?? interrupt.status}</p><p className="text-[10px] text-[#8f95b2]">decision: {interrupt.decision_state ?? 'none'} | delivery: {interrupt.delivery_state ?? 'not_requested'} | runtime: {interrupt.runtime_outcome ?? 'unknown'}</p><p className="text-[11px] text-[#c4c7da]">{interrupt.reason}</p></div>)}</div>}
  </motion.div>;
}

function InterruptCard({ interrupt, isSubmitting, onDecision }: { interrupt: RuntimeInterruptState; isSubmitting: boolean; onDecision: (id: string, decision: 'approve' | 'reject' | 'revise' | 'resume') => Promise<void> }) {
  const frameworkGovernance = interrupt.framework === 'langgraph' || interrupt.framework === 'ms_agent_framework' || Boolean(interrupt.supported_decision_types?.length) || interrupt.actionability !== undefined;
  const supported = supportedDecisions(interrupt);
  const actionable = isActionableInterrupt(interrupt);
  return <div className="rounded-xl border border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.04)] p-3 space-y-3"><div className="space-y-1"><p className="text-[9px] font-mono text-[#fbbf24] uppercase font-bold">Interrupt ID: {interrupt.interrupt_id}</p><p className="text-xs text-[#f7e8bf] font-medium">{interrupt.safe_prompt || interrupt.reason}</p><div className="flex flex-wrap gap-1.5 text-[9px] text-[#9498b0]"><span>request lifecycle: {interrupt.request_lifecycle ?? interrupt.status}</span><span>actionability: {interrupt.actionability ?? 'legacy'}</span><span>decision: {interrupt.decision_state ?? 'none'}</span><span>delivery: {interrupt.delivery_state ?? 'not_requested'}</span><span>runtime: {interrupt.runtime_outcome ?? 'unknown'}</span></div></div>{actionable ? <div className="grid grid-cols-2 gap-2">{supported.includes('approve') && <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'approve')} disabled={isSubmitting} className="rounded-lg bg-[#14532d] px-2.5 py-1.5 text-xs font-semibold text-[#dcfce7]"><Check size={12} className="inline mr-1" />Approve</button>}{supported.includes('reject') && <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'reject')} disabled={isSubmitting} className="rounded-lg bg-[#7f1d1d] px-2.5 py-1.5 text-xs font-semibold text-[#fee2e2]"><X size={12} className="inline mr-1" />Reject</button>}{(supported.includes('structured_response') || supported.includes('revise')) && <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'revise')} disabled={isSubmitting} className="rounded-lg bg-[#78350f] px-2.5 py-1.5 text-xs font-semibold text-[#fef3c7]">Respond</button>}{supported.includes('resume') && !frameworkGovernance && <button type="button" onClick={() => void onDecision(interrupt.interrupt_id, 'resume')} disabled={isSubmitting} className="rounded-lg bg-[#4c1d95] px-2.5 py-1.5 text-xs font-semibold text-[#f3e8ff]"><Play size={12} className="inline mr-1" />Resume</button>}</div> : <p className="text-[10px] text-[#9498b0]">{interrupt.governance_available === false ? 'Governance controls unavailable for this deployment.' : interrupt.actionability === 'identity_conflict' ? 'Identity conflict — controls blocked.' : supported.length === 0 && frameworkGovernance ? 'No supported decisions declared for this request.' : 'Observation only — waiting for a live bridge binding.'}</p>}</div>;
}
