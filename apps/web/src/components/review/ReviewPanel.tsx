'use client';

/**
 * ReviewPanel - Right panel with comments, interrupts, summaries, and anomalies.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useReviewStore, type Comment } from '@/stores/reviewStore';
import { useReplayStore } from '@/stores/replayStore';

interface InterruptPayload {
  id: string;
  interrupt_id: string;
  status: string;
  reason: string;
  created_at: string;
  decision?: string;
  decision_comment?: string;
  decided_at?: string;
  updated_at: string;
}

function normalizeInterrupts(input: unknown): InterruptPayload[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      interrupt_id: typeof item.interrupt_id === 'string' ? item.interrupt_id : '',
      status: typeof item.status === 'string' ? item.status : 'pending',
      reason: typeof item.reason === 'string' ? item.reason : 'Human review requested.',
      created_at: typeof item.created_at === 'string' ? item.created_at : '',
      decision: typeof item.decision === 'string' ? item.decision : undefined,
      decision_comment: typeof item.decision_comment === 'string' ? item.decision_comment : undefined,
      decided_at: typeof item.decided_at === 'string' ? item.decided_at : undefined,
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : '',
    }))
    .filter((item) => item.id && item.interrupt_id);
}


function commentRequestsMasking(comment: string | undefined): boolean {
  const normalized = (comment ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return ['mask', 'masked', 'masking', 'redact', 'redacted', 'anonym'].some((token) => normalized.includes(token));
}

function CommentBubble({ comment }: { comment: Comment }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 rounded-lg border transition-colors ${
        comment.resolved
          ? 'bg-[rgba(52,211,153,0.04)] border-[rgba(52,211,153,0.1)]'
          : 'bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.08)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
            <span className="text-[9px] font-bold text-white">U</span>
          </div>
          <span className="text-[11px] text-[#9498b0]">
            {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {comment.target_type && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.04)] text-[#5d6180]">
            @{comment.target_type}
          </span>
        )}
      </div>
      <p className="text-[12px] text-[#e8eaf0] leading-relaxed">{comment.body}</p>
      {comment.resolved && (
        <div className="flex items-center gap-1 mt-2 text-[10px] text-[#34d399]">
          <CheckCircle2 size={10} />
          <span>Resolved</span>
        </div>
      )}
    </motion.div>
  );
}

export function ReviewPanel() {
  const { comments, addComment } = useReviewStore();
  const currentBranchId = useReplayStore((state) => state.currentBranchId);
  // ROPS P4: the 'summary' and 'anomalies' tabs rendered server-generated
  // interpretation (`missionSummary.summary`, `.conflicts`, `.anomalies`) and are
  // forbidden. They have been removed. The ReviewPanel now surfaces only Evidence:
  // pending interrupts (`InterruptRecord`) and human comments.
  const [activeTab, setActiveTab] = useState<'comments' | 'interrupts'>('interrupts');
  const [newComment, setNewComment] = useState('');
  const [decisionComment, setDecisionComment] = useState('');
  const [interrupts, setInterrupts] = useState<InterruptPayload[]>([]);
  const [interruptError, setInterruptError] = useState<string | null>(null);
  const [isInterruptLoading, setIsInterruptLoading] = useState(false);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const params = useParams<{ id?: string }>();
  const missionId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  // ROPS P4: summary/anomaly fetching removed. `api.semantic.*` drives the
  // forbidden interpretation surfaces; it is no longer invoked from presentation.
  const loadInterrupts = useCallback(async () => {
    if (!missionId || missionId === 'demo-mission') {
      setInterrupts([]);
      setInterruptError(null);
      return;
    }

    setIsInterruptLoading(true);
    setInterruptError(null);
    try {
      const response = await api.interrupts.list(missionId, undefined, currentBranchId ?? undefined);
      setInterrupts(normalizeInterrupts(response.interrupts));
    } catch (error) {
      setInterrupts([]);
      setInterruptError(error instanceof Error ? error.message : 'Failed to load interrupts.');
    } finally {
      setIsInterruptLoading(false);
    }
  }, [missionId, currentBranchId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!missionId || missionId === 'demo-mission') {
        return;
      }
      await loadInterrupts();
    };

    void load();

    const interval = window.setInterval(() => {
      if (cancelled || !missionId || missionId === 'demo-mission') return;
      void loadInterrupts();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadInterrupts, missionId, currentBranchId]);

  const handleSubmitComment = () => {
    if (!newComment.trim()) return;
    const comment: Comment = {
      id: `local-${Date.now()}`,
      mission_id: '',
      body: newComment.trim(),
      resolved: false,
      created_at: new Date().toISOString(),
    };
    addComment(comment);
    setNewComment('');
  };

  const handleDecision = async (interruptId: string, decision: 'approve' | 'reject') => {
    if (!missionId) return;
    setIsSubmittingDecision(true);
    try {
      await api.interrupts.decide(missionId, interruptId, {
        decision,
        comment: decisionComment.trim() || undefined,
        idempotency_key: crypto.randomUUID(),
      }, currentBranchId ?? undefined);
      setDecisionComment('');
      await loadInterrupts();
    } catch (error) {
      setInterruptError(error instanceof Error ? error.message : 'Failed to submit decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  // Floating toggle button removed since it's now in RightSidebar

  const pendingInterrupts = interrupts.filter((interrupt) => interrupt.status === 'pending');
  const recentDecisions = interrupts
    .filter((interrupt) => interrupt.status !== 'pending')
    .sort((left, right) => {
      const leftTime = Date.parse(left.decided_at || left.updated_at || left.created_at || '');
      const rightTime = Date.parse(right.decided_at || right.updated_at || right.created_at || '');
      return rightTime - leftTime;
    })
    .slice(0, 3);
  const tabs = [
    { id: 'interrupts' as const, label: 'Interrupts', icon: AlertTriangle, count: pendingInterrupts.length },
    { id: 'comments' as const, label: 'Comments', icon: MessageSquare, count: comments.length },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      <div className="flex border-b border-[rgba(255,255,255,0.05)]">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-white'
                : 'text-[#8f95b2] hover:text-[#c4c7da]'
            }`}
          >
            <tab.icon size={12} />
            {tab.label}
            {tab.count > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#6366f1]/15 text-[#818cf8] text-[9px] font-bold">
                {tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-[#6366f1]"
              />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <AnimatePresence mode="wait">
          {activeTab === 'interrupts' && (
            <motion.div
              key="interrupts"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="glass-card p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-[#fbbf24]" />
                    <span className="text-[11px] font-semibold text-[#e8eaf0]">Human Review Queue</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadInterrupts()}
                    className="p-1.5 rounded-md text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)]"
                    aria-label="Refresh interrupts"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>

                <textarea
                  value={decisionComment}
                  onChange={(e) => setDecisionComment(e.target.value)}
                  placeholder="Optional reviewer comment..."
                  className="w-full min-h-[70px] resize-y px-3 py-2 text-[12px] rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] text-[#e8eaf0] placeholder:text-[#3a3d54] focus:outline-none focus:border-[#6366f1]/60 transition-colors"
                />

                {isInterruptLoading ? (
                  <div className="flex items-center gap-2 text-[12px] text-[#9498b0]">
                    <Loader2 size={14} className="animate-spin text-[#818cf8]" />
                    <span>Loading pending interrupts...</span>
                  </div>
                ) : interruptError ? (
                  <div className="space-y-2">
                    <p className="text-[12px] text-[#fda4af] leading-relaxed">
                      {interruptError}
                    </p>
                    <button
                      onClick={() => void loadInterrupts()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] px-2.5 py-1.5 text-[11px] text-[#d4d8e8] hover:bg-[rgba(255,255,255,0.04)]"
                    >
                      <RefreshCw size={11} />
                      Retry
                    </button>
                  </div>
                ) : pendingInterrupts.length > 0 ? (
                  <div className="space-y-2">
                    {pendingInterrupts.map((interrupt) => (
                      <div
                        key={interrupt.id}
                        className="rounded-lg border border-[rgba(251,191,36,0.14)] bg-[rgba(251,191,36,0.05)] px-3 py-3 space-y-3"
                      >
                        <div className="space-y-1">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-[#fbbf24]">
                            Pending interrupt
                          </div>
                          <p className="text-[12px] text-[#f7e8bf] leading-relaxed">
                            {interrupt.reason}
                          </p>
                          <div className="text-[10px] text-[#c9b98c]">
                            {new Date(interrupt.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'approve')}
                            disabled={isSubmittingDecision}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#14532d] px-3.5 py-2 text-[11px] font-medium text-[#dcfce7] hover:bg-[#166534] disabled:opacity-50"
                          >
                            <span className="relative inline-flex h-3 w-3 items-center justify-center shrink-0">
                              <Loader2 size={12} className={`absolute animate-spin transition-opacity ${isSubmittingDecision ? 'opacity-100' : 'opacity-0'}`} />
                              <Check size={12} className={`transition-opacity ${isSubmittingDecision ? 'opacity-0' : 'opacity-100'}`} />
                            </span>
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDecision(interrupt.interrupt_id, 'reject')}
                            disabled={isSubmittingDecision}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#7f1d1d] px-3.5 py-2 text-[11px] font-medium text-[#fee2e2] hover:bg-[#991b1b] disabled:opacity-50"
                          >
                            <span className="relative inline-flex h-3 w-3 items-center justify-center shrink-0">
                              <Loader2 size={12} className={`absolute animate-spin transition-opacity ${isSubmittingDecision ? 'opacity-100' : 'opacity-0'}`} />
                              <X size={12} className={`transition-opacity ${isSubmittingDecision ? 'opacity-0' : 'opacity-100'}`} />
                            </span>
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-col items-center py-6 text-center">
                      <CheckCircle2 size={28} className="text-[#34d399]/40 mb-2" />
                      <p className="text-[12px] text-[#5d6180]">No pending interrupts</p>
                      <p className="text-[10px] text-[#3a3d54] mt-1">
                        Human approval requests will appear here
                      </p>
                    </div>

                    {recentDecisions.length > 0 && (
                      <div className="space-y-2 border-t border-[rgba(255,255,255,0.05)] pt-3">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[#9498b0]">
                          Recent decisions
                        </div>
                        {recentDecisions.map((interrupt) => {
                          const isApproved = interrupt.status === 'approved' || interrupt.decision === 'approve';
                          const isRejectedWithMasking = !isApproved && commentRequestsMasking(interrupt.decision_comment);
                          const accentClass = isApproved
                            ? 'border-[rgba(52,211,153,0.14)] bg-[rgba(52,211,153,0.05)]'
                            : isRejectedWithMasking
                              ? 'border-[rgba(251,191,36,0.14)] bg-[rgba(251,191,36,0.05)]'
                              : 'border-[rgba(248,113,113,0.14)] bg-[rgba(248,113,113,0.05)]';
                          const textClass = isApproved
                            ? 'text-[#bbf7d0]'
                            : isRejectedWithMasking
                              ? 'text-[#fde68a]'
                              : 'text-[#fecaca]';
                          const label = isApproved ? 'Approved' : isRejectedWithMasking ? 'Rejected -> Remediate' : 'Rejected';

                          return (
                            <div
                              key={interrupt.id}
                              className={`rounded-lg border px-3 py-3 space-y-2 ${accentClass}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[10px] uppercase tracking-[0.14em] ${textClass}`}>
                                  {label}
                                </span>
                                <span className="text-[10px] text-[#8b90ad]">
                                  {new Date(interrupt.decided_at || interrupt.updated_at || interrupt.created_at).toLocaleString()}
                                </span>
                              </div>
                              <p className={`text-[12px] leading-relaxed ${textClass}`}>
                                {interrupt.reason}
                              </p>
                              {interrupt.decision_comment && (
                                <p className="text-[11px] text-[#cfd3e6] leading-relaxed">
                                  Reviewer note: {interrupt.decision_comment}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'comments' && (
            <motion.div
              key="comments"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {comments.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <MessageSquare size={32} className="text-[#2d2f44] mb-3" />
                  <p className="text-[12px] text-[#5d6180]">No comments yet</p>
                  <p className="text-[10px] text-[#3a3d54] mt-1">
                    Click on a node to anchor a comment
                  </p>
                </div>
              ) : (
                comments.map((comment) => (
                  <CommentBubble key={comment.id} comment={comment} />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {activeTab === 'comments' && (
        <div className="p-3 border-t border-[rgba(255,255,255,0.05)]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment()}
              placeholder="Add a comment..."
              className="flex-1 px-3 py-2 text-[12px] rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] text-[#e8eaf0] placeholder:text-[#3a3d54] focus:outline-none focus:border-[#6366f1]/40 transition-colors"
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={!newComment.trim()}
              className="p-2 rounded-lg bg-[#6366f1] text-white hover:bg-[#5558e6] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
