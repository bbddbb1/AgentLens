'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  PauseCircle,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';
import { focusRuntimeActivity } from '@/lib/runtimeFocus';
import { authoritativeRuntimeStatus } from '@/lib/runtimeAuthority';

interface RuntimeSummaryPanelProps {
  objective?: string;
  missionStatus?: string;
  missionPhase?: string;
  serverSummary?: RuntimeSummary | null;
  serverExplanation?: RuntimeExplanationProjection | null;
  onEnhance?: () => Promise<void>;
  isEnhancing?: boolean;
}

function formatTimestamp(value?: string): string | null {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
}

function frameLabel(summary: RuntimeSummary, explanation: RuntimeExplanationProjection | null): string {
  const frame = summary.frame;
  const asOfTimestamp =
    frame?.as_of_timestamp ?? explanation?.as_of_timestamp ?? summary.generated_at;
  const projectionVersion =
    frame?.projection_version ?? explanation?.projection_version ?? 'runtime_explanation.v1';
  return [
    `branch ${frame?.branch_id ?? summary.branch_id}`,
    `seq #${frame?.sequence_num ?? summary.sequence_num}`,
    asOfTimestamp ? formatTimestamp(asOfTimestamp) : null,
    projectionVersion,
  ]
    .filter(Boolean)
    .join(' · ');
}

function phaseDetails(summary: RuntimeSummary): { label: string; basis: string } {
  const phase = summary.runtime_phase ?? summary.current_phase;
  if (phase) return { label: phase.label, basis: phase.basis };
  const label = summary.phase;
  return { label, basis: 'unknown' };
}

function activityDisplayLabel(activity: NonNullable<RuntimeSummary['story_activities']>[number]): string {
  return activity.operator_facing_record?.primary_label ?? activity.title ?? activity.label;
}

function activityContextDisclosure(summary: RuntimeSummary): string {
  const state = summary.selected_activity_state;
  if (state?.kind === 'selected') {
    return state.selection_basis
      ? `Selected activity (${state.selection_basis})`
      : 'Selected activity';
  }
  if (state?.kind === 'no_activity') {
    return 'No selectable activity';
  }
  return 'Frame overview';
}

export function RuntimeSummaryPanel({
  objective: _objective = 'Mission overview',
  missionStatus: _missionStatus = 'active',
  missionPhase: _missionPhase = 'executing',
  serverSummary = null,
  serverExplanation = null,
  onEnhance,
  isEnhancing = false,
}: RuntimeSummaryPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showAgents, setShowAgents] = useState(true);
  const [showAllActivities, setShowAllActivities] = useState(false);

  const summary = serverSummary;
  const explanation = serverExplanation;
  const snapshots = useGraphStore((state) => state.snapshots);
  const setSelectedNodeId = useGraphStore((state) => state.setSelectedNodeId);
  const { events, setSelectedEventId, setSelectedActivityId, setCurrentFrame } = useReplayStore();

  if (!summary || !explanation) {
    return (
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2 text-[11px] text-[#5d6180]">
          <AlertTriangle size={12} />
          <span>Runtime explanation unavailable for this frame.</span>
        </div>
      </div>
    );
  }

  const storyActivities = summary.story_activities ?? summary.activities ?? [];
  const displayActivities = showAllActivities ? storyActivities : storyActivities.slice(0, 5);
  const recentProgress = summary.progress.slice(-6);
  const frameText = frameLabel(summary, explanation);
  const phase = phaseDetails(summary);
  const majorPhases = summary.major_phases ?? (summary.current_phase ? [summary.current_phase] : []);
  const backgroundWork = summary.background_work;

  const handleActivitySelect = (activity: NonNullable<typeof storyActivities>[number]) => {
    focusRuntimeActivity(activity, snapshots, events, {
      setSelectedEventId,
      setSelectedActivityId,
      setSelectedNodeId,
      setCurrentFrame,
    });
  };

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
          {explanation.run_outcome === 'waiting' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[rgba(251,191,36,0.12)] text-[#fbbf24] text-[9px] font-semibold">
              <UserRound size={9} />
              HITL
            </span>
          )}
          {explanation.run_outcome === 'failed' && (
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
              <div className="rounded-xl border border-[rgba(129,140,248,0.12)] bg-[rgba(129,140,248,0.04)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#5d6180]">Frame</div>
                <div className="mt-1 text-[11px] text-[#d0d4ea] leading-relaxed">{frameText}</div>
              </div>

              <div>
                <div className="text-[13px] font-medium text-[#eef1fa] leading-snug flex items-center gap-1.5">
                  {summary.headline}
                  <span className="text-[8px] font-mono uppercase tracking-wider text-[#6b708a]">[projection]</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[#8f95b2]">
                  <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">
                    status: {authoritativeRuntimeStatus(summary) ?? 'Unknown'}
                  </span>
                  <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">
                    phase: {phase.label}
                  </span>
                  <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">
                    basis: {phase.basis}
                  </span>
                  <span className="rounded-full bg-[rgba(255,255,255,0.04)] px-2 py-0.5">
                    context: {activityContextDisclosure(summary)}
                  </span>
                </div>
              </div>

              {majorPhases.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-[0.16em] text-[#5d6180]">Major phases</div>
                  <div className="flex flex-wrap gap-1.5">
                    {majorPhases.map((majorPhase, index) => (
                      <span
                        key={`${majorPhase.id}-${index}`}
                        className="rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2 py-0.5 text-[10px] text-[#d0d4ea]"
                      >
                        {majorPhase.label}
                        <span className="ml-1 text-[#6b708a]">({majorPhase.basis})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {displayActivities.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[9px] uppercase tracking-[0.16em] text-[#5d6180]">Runtime story</div>
                    {backgroundWork?.collapsed && (
                      <button
                        type="button"
                        onClick={() => setShowAllActivities((value) => !value)}
                        className="text-[9px] text-[#818cf8] hover:text-[#a5b4fc]"
                      >
                        {showAllActivities ? 'Show concise story' : 'Show background work'}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {displayActivities.map((activity, index) => (
                      <button
                        type="button"
                        key={`${activity.id}-${activity.kind}`}
                        onClick={() => handleActivitySelect(activity)}
                        className="w-full flex gap-2 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] px-2 py-1.5 text-left hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                      >
                        <span className="w-4 shrink-0 font-mono text-[10px] text-[#5d6180]">{index + 1}</span>
                        <span className="min-w-0 flex-1 text-[10px] text-[#b4b8d0] leading-relaxed">
                          {activityDisplayLabel(activity)}
                          <span className="mx-1 text-[#4f536d]">|</span>
                          <span className={activity.status === 'failed' ? 'text-[#f87171]' : activity.status === 'waiting' ? 'text-[#fbbf24]' : 'text-[#8f95b2]'}>
                            {activity.operator_facing_record?.status_or_outcome.value ?? activity.outcome ?? activity.status}
                          </span>
                          {activity.story_critical_limitation && (
                            <span className="text-[#fbbf24]"> | {activity.story_critical_limitation}</span>
                          )}
                          {activity.duration_ms !== undefined && (
                            <span className="text-[#6b708a]"> | {formatStoryDuration(activity.duration_ms)}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  {backgroundWork?.collapsed && !showAllActivities && (
                    <div className="rounded-lg border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2 text-[10px] text-[#9498b0]">
                      {backgroundWork.disclosure}
                    </div>
                  )}
                </div>
              )}

              {runtimeProgressVisible(summary, displayActivities.length) && recentProgress.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-[0.16em] text-[#5d6180]">Progress</div>
                  <ol className="space-y-1">
                    {recentProgress.map((entry) => (
                      <li key={`${entry.sequence_num}-${entry.event_type}`} className="flex gap-2 text-[10px] text-[#b4b8d0]">
                        <span className="text-[#5d6180] shrink-0">-</span>
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
                    Agents ({summary.agents.length}) {showAgents ? 'v' : '>'}
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
                          <p className="mt-0.5 text-[10px] text-[#9498b0] leading-relaxed line-clamp-2">
                            {agent.facts.role ?? '-'}
                          </p>
                          {agent.facts.pending && agent.facts.status !== 'idle' && (
                            <p className="mt-0.5 text-[9px] text-[#6b708a] leading-relaxed line-clamp-1">
                              - {agent.facts.pending}
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
                  <span>
                    as of seq #{explanation.as_of_sequence_num}
                    {explanation.as_of_timestamp ? ` | ${formatTimestamp(explanation.as_of_timestamp)}` : ''}
                    {summary.frame?.projection_version ? ` | ${summary.frame.projection_version}` : ''}
                  </span>
                  {onEnhance && (
                    <button
                      type="button"
                      onClick={() => void onEnhance()}
                      disabled={isEnhancing}
                      className="text-[#818cf8] hover:text-[#a5b4fc] disabled:opacity-50"
                    >
                      {isEnhancing ? 'Enhancing...' : 'Enhance with AI'}
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

function runtimeProgressVisible(summary: RuntimeSummary, visibleActivityCount: number): boolean {
  return visibleActivityCount === 0 ? summary.progress.length > 0 : true;
}

function formatStoryDuration(durationMs: number): string {
  if (durationMs < 1) return `${durationMs.toFixed(2)} ms`;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
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
