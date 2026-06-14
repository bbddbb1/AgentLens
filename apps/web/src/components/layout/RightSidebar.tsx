'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';
import { BranchExplorer } from '@/components/replay/BranchExplorer';
import { AiAssistant } from '@/components/ai/AiAssistant';
import { api } from '@/lib/api';
import type { MissionAuditEventResponse, EventEnvelope } from '@agentlens/protocol';
import { useRuntimeSummary } from '@/hooks/useRuntimeSummary';
import { useNodeProjection } from '@/hooks/useNodeProjection';
import { AgentNodeProjectionPanel } from '@/components/runtime/AgentNodeProjectionPanel';
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
  ShieldAlert,
  Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { EdgeInspector } from '@/components/graph/EdgeInspector';

interface RightSidebarProps {
  missionId: string;
  onBranchChange?: (branchId: string) => Promise<void>;
  missionObjective?: string;
  missionStatus?: string;
}

export function RightSidebar({ missionId, onBranchChange, missionObjective = 'Mission overview', missionStatus = 'active' }: RightSidebarProps) {
  const { setIsRightCollapsed } = useLayoutStore();
  const { snapshots, selectedNodeId } = useGraphStore();
  const { currentState, selectedEventId, currentBranchId, currentFrame, events } = useReplayStore();

  const [activeTab, setActiveTab] = useState<'run' | 'govern' | 'audit' | 'ask_pi'>('run');
  const [decisionComment, setDecisionComment] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Compact audit events & integrity state
  const [auditData, setAuditData] = useState<MissionAuditEventResponse | null>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchAuditData = useCallback(() => {
    if (!missionId || missionId === 'demo-mission') return;
    setIsAuditLoading(true);
    api.audit.events(missionId, currentBranchId ?? undefined, events[currentFrame]?.sequence_num ?? undefined)
      .then(res => {
        setTimeout(() => {
          setAuditData(res);
          setIsAuditLoading(false);
        }, 0);
      })
      .catch(err => {
        console.error(err);
        setTimeout(() => setIsAuditLoading(false), 0);
      });
  }, [missionId, currentBranchId, currentFrame, events]);

  useEffect(() => {
    fetchAuditData();
  }, [fetchAuditData]);

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
      fetchAuditData();
      if (onBranchChange && currentBranchId) {
        await onBranchChange(currentBranchId);
      }
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Failed to submit decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  // Find the selected event's hydrated envelope from audit data
  const selectedEventEnvelope = useMemo(() => {
    const targetId = selectedEventId || events[currentFrame]?.id;
    if (!targetId || !auditData?.events) return null;
    return auditData.events.find((e: any) => e.id === targetId) || null;
  }, [selectedEventId, currentFrame, events, auditData]);

  // Selected node details
  const selectedNode = useMemo(() => {
    const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
    if (!currentSnapshot || !selectedNodeId) return null;
    return currentSnapshot.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, currentFrame, snapshots]);

  const runtimeSummary = useRuntimeSummary({
    missionId,
    objective: missionObjective,
    missionStatus,
    missionPhase: currentState?.phase ?? 'executing',
  });


  const selectedAgentId = selectedNode?.type === 'agent'
    ? (selectedNode.agent_id ?? selectedNode.id ?? selectedNode.label)
    : null;

  const { projection: nodeProjection, enhance: enhanceNodeProjection, isEnhancing: isEnhancingNode } = useNodeProjection({
    missionId,
    agentId: selectedAgentId,
    branchId: currentBranchId ?? undefined,
    sequenceNum: events[currentFrame]?.sequence_num,
    events: events as unknown as import('@agentlens/protocol').MissionEventRecord[],
    runtimeSummary,
  });

  // Interrupt lists
  const pendingInterrupts = useMemo(() => {
    return Object.values(currentState?.interrupts ?? {}).filter(i => i.status === 'pending');
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
    { id: 'ask_pi' as const, label: 'Ask Pi', icon: Bot },
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
              <tab.icon size={12} className={tab.id === 'ask_pi' ? 'text-[#818cf8]' : ''} />
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
              {/* Context Summary Cards */}
              {selectedNode && <EdgeInspector />}

              {selectedNode && selectedNode.type === 'agent' && nodeProjection && (
                <AgentNodeProjectionPanel
                  projection={nodeProjection}
                  nodeType={selectedNode.type}
                  onEnhance={missionId !== 'demo-mission' ? enhanceNodeProjection : undefined}
                  isEnhancing={isEnhancingNode}
                />
              )}

              {selectedNode && selectedNode.type !== 'agent' && (
                <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.025)] p-3.5 relative overflow-hidden group transition-all duration-300">
                  <div className="border-l-3 border-[#6366f1] pl-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#818cf8]" />
                        <span className="text-[9px] uppercase tracking-[0.12em] text-[#818cf8] font-bold">Selected Node</span>
                      </div>
                      <span className="text-[9px] bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] border border-[#6366f1]/20 px-2 py-0.5 rounded-md font-mono uppercase tracking-wide">
                        {selectedNode.type}
                      </span>
                    </div>
                    <div className="text-[13px] font-semibold text-white tracking-wide">{selectedNode.label}</div>
                    {selectedNode.summary && (
                      <div className="text-[11px] text-[#9498b0] leading-relaxed">{selectedNode.summary}</div>
                    )}
                    {selectedNode.confidence !== undefined && (
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-[10px] text-[#8f95b2]">
                          <span>Confidence Metric</span>
                          <span className="text-[#34d399] font-bold">{Math.round(selectedNode.confidence * 100)}%</span>
                        </div>
                        <div className="w-full bg-[rgba(255,255,255,0.05)] rounded-full h-1">
                          <div
                            className="bg-[#34d399]/40 h-1 rounded-full transition-all duration-500"
                            style={{ width: `${Math.round(selectedNode.confidence * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
                    {pendingInterrupts.map((interrupt) => (
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
                            {interrupt.reason}
                          </p>
                        </div>

                        {/* Four-way Governance Actions */}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'approve')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#14532d] hover:bg-[#166534] px-2.5 py-1.5 text-xs font-semibold text-[#dcfce7] disabled:opacity-50 transition-colors"
                          >
                            <Check size={12} />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'reject')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#7f1d1d] hover:bg-[#991b1b] px-2.5 py-1.5 text-xs font-semibold text-[#fee2e2] disabled:opacity-50 transition-colors"
                          >
                            <X size={12} />
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'revise')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#78350f] hover:bg-[#92400e] px-2.5 py-1.5 text-xs font-semibold text-[#fef3c7] disabled:opacity-50 transition-colors"
                          >
                            <AlertTriangle size={12} className="text-[#fbbf24]" />
                            Revise
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'resume')}
                            disabled={isSubmittingDecision}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4c1d95] hover:bg-[#5b21b6] px-2.5 py-1.5 text-xs font-semibold text-[#f3e8ff] disabled:opacity-50 transition-colors"
                          >
                            <Play size={12} className="text-[#c084fc]" />
                            Resume
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-8 text-center bg-[rgba(255,255,255,0.01)] rounded-xl border border-dashed border-[rgba(255,255,255,0.04)]">
                    <CheckCircle2 size={24} className="text-[#34d399]/40 mb-2" />
                    <p className="text-xs text-[#9498b0] font-medium">No pending interrupts</p>
                    <p className="text-[10px] text-[#5d6180] mt-0.5">Runtime operations are executing normally.</p>
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
                  auditData.integrity.is_valid
                    ? 'border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.04)]'
                    : 'border-[rgba(244,63,94,0.18)] bg-[rgba(244,63,94,0.04)]'
                }`}>
                  {auditData.integrity.is_valid ? (
                    <Shield size={20} className="text-[#34d399] shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert size={20} className="text-[#f43f5e] shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-[#eef1fa] flex items-center gap-1.5">
                      Ledger Hash Chain: 
                      <span className={auditData.integrity.is_valid ? 'text-[#34d399]' : 'text-[#f43f5e]'}>
                        {auditData.integrity.is_valid ? 'SECURE' : 'COMPROMISED'}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#9498b0] leading-relaxed">
                      {auditData.integrity.is_valid 
                        ? 'All event payloads mathematically tied. Integrity cryptographically proven via SHA-256.'
                        : 'Tampering or hash broken detected in branch ledger! Verify sequence parameters.'
                      }
                    </p>
                    <div className="text-[9px] font-mono text-[#5d6180]">
                      Branch: {auditData.integrity.branch_id} • Verified: {auditData.integrity.total_events} events
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

          {activeTab === 'ask_pi' && (
            <motion.div
              key="ask_pi"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full"
            >
              <AiAssistant
                inline
                missionId={missionId}
                missionObjective={missionObjective}
                missionStatus={missionStatus}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
