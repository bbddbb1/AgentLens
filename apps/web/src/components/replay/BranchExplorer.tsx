'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Plus, RefreshCw, Waypoints, Bot, AlertTriangle, Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

interface BranchExplorerProps {
  missionId: string;
  onBranchChange: (branchId: string) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

function formatEventLabel(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

export function BranchExplorer({ missionId, onBranchChange, isCollapsed, onToggleCollapsed }: BranchExplorerProps) {
  const { snapshots, selectedNodeId } = useGraphStore();
  const {
    branches,
    currentBranchId,
    events,
    currentFrame,
    currentState,
    setSelectedEventId,
  } = useReplayStore();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whyThisStateText, setWhyThisStateText] = useState<string | null>(null);
  const [isLoadingWhy, setIsLoadingWhy] = useState(false);
  const lastWhyKeyRef = useRef<string | null>(null);

  const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const selectedNode = currentSnapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const visibleEvent = events[currentFrame] ?? events[events.length - 1] ?? null;
  const visibleEventDescription =
    (visibleEvent?.payload as Record<string, unknown> | undefined)?.event_description;

  const causalEvents = useMemo(() => {
    const pivotId = selectedNode?.agent_id ?? selectedNode?.id;
    if (!pivotId) {
      return visibleEvent ? [visibleEvent] : [];
    }

    return events
      .filter((event) => {
        if (event.agent_id === pivotId) return true;
        const payload = event.payload as Record<string, unknown>;
        return (
          payload.agent_id === pivotId ||
          payload.target_agent_id === pivotId ||
          payload.interrupt_id === pivotId ||
          event.span_id === selectedNode?.span_id
        );
      })
      .slice(-6);
  }, [events, selectedNode, visibleEvent]);

  const whyKey = `${currentFrame}:${selectedNodeId ?? 'none'}:${currentBranchId ?? 'main'}`;

  const fetchWhyThisState = useCallback(async () => {
    if (lastWhyKeyRef.current === whyKey) return;
    lastWhyKeyRef.current = whyKey;

    setWhyThisStateText(null);
    setIsLoadingWhy(true);

    try {
      if (missionId === 'demo-mission') {
        const agentStates = Object.values(currentState?.agents ?? {}).map((a) => ({
          name: a.name ?? a.agent_id,
          role: a.role ?? 'unknown',
          status: a.status,
          summary: a.summary,
        }));

        const result = await api.semantic.whyThisStateDemo({
          missionId,
          phase: currentSnapshot?.phase ?? currentState?.phase,
          eventDescription: currentSnapshot?.event_description ?? visibleEvent?.event_type,
          agentStates,
          pendingInterrupts: Object.values(currentState?.interrupts ?? {}).filter((i) => i.status === 'pending').length,
        });
        setWhyThisStateText(result.summary);
      } else {
        const result = await api.semantic.whyThisState(missionId, {
          sequence_num: currentSnapshot?.sequence_num ?? currentFrame,
          branch_id: currentBranchId ?? undefined,
        });
        setWhyThisStateText(result.summary);
      }
    } catch {
      setWhyThisStateText(null);
    } finally {
      setIsLoadingWhy(false);
    }
  }, [whyKey, missionId, currentState, currentSnapshot, visibleEvent, currentFrame, currentBranchId]);

  useEffect(() => {
    void fetchWhyThisState();
  }, [fetchWhyThisState]);

  const handleCreateBranch = async () => {
    if (!missionId || missionId === 'demo-mission') return;
    setIsCreating(true);
    setError(null);
    try {
      const fromSequence = currentSnapshot?.source_event_sequence_num ?? visibleEvent?.sequence_num ?? 0;
      const branch = await api.replay.createBranch(missionId, {
        name: selectedNode ? `${selectedNode.label} fork` : `Branch @ ${fromSequence}`,
        source_branch_id: currentBranchId ?? undefined,
        forked_from_sequence_num: fromSequence,
        metadata: {
          selected_node_id: selectedNode?.id,
          selected_event_id: visibleEvent?.id,
        },
      });
      await onBranchChange(branch.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create branch.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="glass rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(10,11,16,0.82)] p-3 shadow-[0_16px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[rgba(103,232,249,0.12)] text-[#67e8f9]">
            <GitBranch size={15} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#67e8f9]">
              Branches
            </div>
            <div className="text-[12px] text-[#cfd3e6]">
              Runtime forks and replay lineage
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? 'Expand branch explorer' : 'Collapse branch explorer'}
            className="inline-flex items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] p-2 text-[#cfd3e6] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            type="button"
            onClick={handleCreateBranch}
            disabled={isCreating || !currentSnapshot || missionId === 'demo-mission'}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(255,255,255,0.08)] px-3 py-2 text-[11px] text-[#e8eaf0] transition-colors hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-40"
          >
            {isCreating ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
            Branch Here
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="mt-3 grid gap-2">
            {branches.map((branch) => {
              const isActive = branch.id === currentBranchId;
              return (
                <button
                  type="button"
                  key={branch.id}
                  onClick={() => void onBranchChange(branch.id)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-[rgba(103,232,249,0.24)] bg-[rgba(103,232,249,0.08)]'
                      : 'border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-medium text-[#e8eaf0]">{branch.name}</div>
                    <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[#8f95b2]">
                      {branch.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#6d7392]">
                    {branch.parent_branch_id ? `Forked from ${branch.parent_branch_id}` : 'Root branch'}
                    {branch.forked_from_sequence_num !== undefined ? ` at event ${branch.forked_from_sequence_num}` : ''}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_1fr]">
            <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a5b4fc]">
                <span className="flex h-3 w-3 items-center justify-center">
                  {isLoadingWhy ? <Loader2 key="loader" size={12} className="animate-spin" /> : <Sparkles key="sparkles" size={12} />}
                </span>
                Why This State
              </div>

              {isLoadingWhy && !whyThisStateText && (
                <div className="mt-3 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.015)] px-3 py-3 text-[12px] text-[#9da3bf] italic leading-relaxed">
                  Analyzing causality...
                </div>
              )}

              {whyThisStateText && (
                <div className="mt-3 rounded-xl border border-[rgba(103,232,249,0.12)] bg-[rgba(103,232,249,0.04)] px-3 py-2.5 text-[12px] text-[#eef1fa] leading-relaxed">
                  {whyThisStateText}
                </div>
              )}

              {!isLoadingWhy && !whyThisStateText && (
                <div className="mt-2 text-[12px] text-[#d7dbeb]">
                  {selectedNode ? selectedNode.label : typeof visibleEventDescription === 'string' ? visibleEventDescription : 'Select a node or event to inspect causality.'}
                </div>
              )}

              <div className="mt-3 space-y-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#7b819f]">Causal Events</div>
                {causalEvents.length > 0 ? causalEvents.map((event) => {
                  const isCurrent = event.id === visibleEvent?.id;
                  return (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => setSelectedEventId(event.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                        isCurrent
                          ? 'border-[rgba(129,140,248,0.24)] bg-[rgba(99,102,241,0.08)]'
                          : 'border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.04)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-medium text-[#eef1fa]">{formatEventLabel(event.event_type)}</div>
                        <div className="text-[10px] text-[#7c83a3]">#{event.sequence_num}</div>
                      </div>
                      <div className="mt-1 text-[10px] leading-relaxed text-[#9da3bf]">
                        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        {event.agent_id ? ` • ${event.agent_id}` : ''}
                      </div>
                    </button>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed border-[rgba(255,255,255,0.08)] px-3 py-4 text-[11px] text-[#6d7392]">
                    No causal events available for this selection yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#fbbf24]">
                <Waypoints size={12} />
                Reconstructed Runtime
              </div>
              <div className="mt-3 grid gap-2">
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">Phase</div>
                  <div className="mt-1 text-[13px] font-medium text-[#f5f7ff]">{currentSnapshot?.phase ?? currentState?.phase ?? 'executing'}</div>
                </div>
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">Mission Status</div>
                  <div className="mt-1 text-[13px] font-medium text-[#f5f7ff]">{currentState?.status ?? 'active'}</div>
                </div>
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">
                    <span>Agents in State</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {Object.values(currentState?.agents ?? {}).slice(0, 4).map((agent) => (
                      <div key={agent.agent_id} className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex min-w-0 items-center gap-2 text-[#d7dbeb]">
                          <Bot size={11} className="text-[#818cf8]" />
                          <span className="truncate">{agent.name ?? agent.agent_id}</span>
                        </div>
                        <span className="inline-flex shrink-0 items-center rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#a7aecb]">
                          {agent.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#6a718c]">
                    <AlertTriangle size={10} />
                    Pending Interrupts
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-[#f5f7ff]">
                    {Object.values(currentState?.interrupts ?? {}).filter((interrupt) => interrupt.status === 'pending').length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && <div className="mt-3 text-[11px] text-[#fca5a5]">{error}</div>}
        </>
      )}
    </div>
  );
}
