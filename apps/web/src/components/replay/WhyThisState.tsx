import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

function formatEventLabel(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

interface WhyThisStateProps {
  missionId: string;
}

export function WhyThisState({ missionId }: WhyThisStateProps) {
  const { snapshots, selectedNodeId } = useGraphStore();
  const { events, currentFrame, currentState, currentBranchId, setSelectedEventId } = useReplayStore();
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

  return (
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
  );
}
