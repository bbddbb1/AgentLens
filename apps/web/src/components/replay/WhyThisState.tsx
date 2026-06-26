import { useMemo } from 'react';
import { ListTree } from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

function formatEventLabel(eventType: string): string {
  return eventType.replace(/[._]/g, ' ');
}

/**
 * WhyThisState — Causal Events only.
 *
 * ROPS compliance (P4): the LLM "AI Narrative" block and all `api.semantic.*`
 * calls have been removed. This surface now renders ONLY Evidence: the runtime
 * events causally adjacent to the selected node/event (filtered by agent_id /
 * target_agent_id / interrupt_id / span_id), each clickable to jump the
 * timeline (ROPS §11 Jump to Event).
 *
 * No summary, no explanation, no interpretation. The operator reads the raw
 * event sequence and decides.
 */
export function WhyThisState({ missionId: _missionId }: { missionId: string }) {
  const { snapshots, selectedNodeId } = useGraphStore();
  const { events, currentFrame, setSelectedEventId } = useReplayStore();

  const currentSnapshot = snapshots[currentFrame] ?? snapshots[snapshots.length - 1] ?? null;
  const selectedNode = currentSnapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const visibleEvent = events[currentFrame] ?? events[events.length - 1] ?? null;

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

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a5b4fc]">
        <ListTree size={12} />
        Causal Events
      </div>

      <div className="mt-3 space-y-2">
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
          <div className="flex flex-col items-center py-4 text-center bg-[rgba(255,255,255,0.01)] rounded-xl border border-dashed border-[rgba(255,255,255,0.06)]">
            <span className="text-[10px] text-[#5d6180]">No causal events available.</span>
          </div>
        )}
      </div>
    </div>
  );
}
