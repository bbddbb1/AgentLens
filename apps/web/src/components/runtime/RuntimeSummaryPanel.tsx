'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  PauseCircle,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { RuntimeSummary } from '@agentlens/protocol';
import { useRuntimeSummary } from '@/hooks/useRuntimeSummary';

interface RuntimeSummaryPanelProps {
  missionId: string;
  objective?: string;
  missionStatus?: string;
  missionPhase?: string;
  /** Server-provided summary (e.g. from WebSocket); overrides client projection when newer. */
  serverSummary?: RuntimeSummary | null;
  onEnhance?: () => Promise<void>;
  isEnhancing?: boolean;
}

export function RuntimeSummaryPanel({
  missionId,
  objective = 'Mission overview',
  missionStatus = 'active',
  missionPhase = 'executing',
  serverSummary = null,
  onEnhance,
  isEnhancing = false,
}: RuntimeSummaryPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showAgents, setShowAgents] = useState(true);

  const summary = useRuntimeSummary({
    missionId,
    objective,
    missionStatus,
    missionPhase,
    serverSummary,
  });

  if (!summary) {
    return (
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2 text-[11px] text-[#5d6180]">
          <Loader2 size={12} className="animate-spin" />
          <span>Building runtime summary…</span>
        </div>
      </div>
    );
  }

  const recentProgress = summary.progress.slice(-6);

  return (
    <div className="border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.6)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-[#818cf8]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9498b0]">
            Runtime Summary
          </span>
          {summary.requires_human && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[rgba(251,191,36,0.12)] text-[#fbbf24] text-[9px] font-semibold">
              <UserRound size={9} />
              HITL
            </span>
          )}
          {summary.is_blocked && !summary.requires_human && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[rgba(248,113,113,0.12)] text-[#f87171] text-[9px] font-semibold">
              <PauseCircle size={9} />
              Blocked
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-[#5d6180]" /> : <ChevronDown size={14} className="text-[#5d6180]" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-3">
              <div>
                {/* ROPS P4: `summary.narrative` is forbidden ("projection-only, never
                    authoritative"). It is no longer rendered. `headline` is a
                    deterministic projection (buildHeadline) and is shown labelled. */}
                <div className="text-[13px] font-medium text-[#eef1fa] leading-snug flex items-center gap-1.5">
                  {summary.headline}
                  <span className="text-[8px] font-mono uppercase tracking-wider text-[#6b708a]">[projection]</span>
                </div>
              </div>

              {recentProgress.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-[0.16em] text-[#5d6180]">Progress</div>
                  <ol className="space-y-1">
                    {recentProgress.map((entry) => (
                      <li key={`${entry.sequence_num}-${entry.event_type}`} className="flex gap-2 text-[10px] text-[#b4b8d0]">
                        <span className="text-[#5d6180] shrink-0">↓</span>
                        <span className="leading-relaxed">{entry.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {summary.pending_work.length > 0 && (
                <div className="rounded-lg border border-[rgba(251,191,36,0.15)] bg-[rgba(251,191,36,0.05)] px-2.5 py-2">
                  <div className="text-[9px] uppercase tracking-[0.16em] text-[#d4a574] mb-1">Pending</div>
                  {summary.pending_work.slice(0, 2).map((item, index) => (
                    <div key={index} className="text-[10px] text-[#e8d5b5] leading-relaxed">
                      {item.text}
                    </div>
                  ))}
                </div>
              )}

              {summary.agents.length > 0 && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAgents((value) => !value)}
                    className="text-[9px] uppercase tracking-[0.16em] text-[#5d6180] hover:text-[#9498b0]"
                  >
                    Agents ({summary.agents.length}) {showAgents ? '▾' : '▸'}
                  </button>
                  {showAgents && (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {summary.agents.map((agent) => (
                        <div
                          key={agent.agent_id}
                          className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-medium text-[#d0d4ea] truncate">{agent.name}</span>
                            <span className="text-[9px] text-[#5d6180] shrink-0">{agent.facts.status_label}</span>
                          </div>
                          {/* ROPS P4: `agent.generated.current_understanding` is forbidden.
                              Render only Evidence: `agent.facts.role` (absent when not emitted, P7). */}
                          <p className="mt-0.5 text-[10px] text-[#9498b0] leading-relaxed line-clamp-2">
                            {agent.facts.role ?? '—'}
                          </p>
                          {agent.facts.pending && agent.facts.status !== 'idle' && (
                            <p className="mt-0.5 text-[9px] text-[#6b708a] leading-relaxed line-clamp-1">
                              → {agent.facts.pending}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {summary.warnings.length > 0 && (
                <div className="flex items-start gap-2 text-[10px] text-[#f87171]">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  <span>{summary.warnings[summary.warnings.length - 1].text}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDetails((value) => !value)}
                  className="text-[10px] text-[#5d6180] hover:text-[#9498b0] transition-colors"
                >
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
                <div className="flex items-center gap-2 text-[9px] text-[#5d6180]">
                  <Clock size={9} />
                  <span>seq {summary.sequence_num}</span>
                  {onEnhance && (
                    <button
                      type="button"
                      onClick={() => void onEnhance()}
                      disabled={isEnhancing}
                      className="text-[#818cf8] hover:text-[#a5b4fc] disabled:opacity-50"
                    >
                      {isEnhancing ? 'Enhancing…' : 'Enhance with AI'}
                    </button>
                  )}
                </div>
              </div>

              {showDetails && (
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {summary.actions.length > 0 && (
                    <DetailBucket title="Actions" items={summary.actions.slice(-3).map((a) => a.text)} />
                  )}
                  {summary.evidence.length > 0 && (
                    <DetailBucket title="Evidence" items={summary.evidence.slice(-3).map((e) => e.text)} />
                  )}
                  {summary.observations.length > 0 && (
                    <DetailBucket title="Observations" items={summary.observations.slice(-3).map((o) => o.text)} />
                  )}
                  {summary.decisions.length > 0 && (
                    <DetailBucket title="Decisions" items={summary.decisions.slice(-3).map((d) => d.text)} />
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailBucket({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.14em] text-[#5d6180] mb-1">{title}</div>
      <ul className="space-y-0.5">
        {items.map((item, index) => (
          <li key={index} className="text-[#9498b0] leading-relaxed truncate" title={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
