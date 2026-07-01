'use client';

import { useMemo } from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import type { GraphEdge } from '@agentlens/protocol';

interface ConnectionRow {
  id: string;
  direction: 'out' | 'in';
  peerId: string;
  peerLabel: string;
  edgeType: string;
  count: number;
  edgeIds: string[];
}

function aggregateConnections(
  nodeId: string,
  edges: GraphEdge[],
  nodeLabels: Map<string, string>,
): ConnectionRow[] {
  const rows = new Map<string, ConnectionRow>();

  for (const edge of edges) {
    if (edge.source === nodeId) {
      const key = `out:${edge.target}:${edge.type}`;
      const existing = rows.get(key);
      if (existing) {
        existing.count += 1;
        existing.edgeIds.push(edge.id);
      } else {
        rows.set(key, {
          id: key,
          direction: 'out',
          peerId: edge.target,
          peerLabel: nodeLabels.get(edge.target) ?? edge.target,
          edgeType: edge.type,
          count: 1,
          edgeIds: [edge.id],
        });
      }
    }

    if (edge.target === nodeId) {
      const key = `in:${edge.source}:${edge.type}`;
      const existing = rows.get(key);
      if (existing) {
        existing.count += 1;
        existing.edgeIds.push(edge.id);
      } else {
        rows.set(key, {
          id: key,
          direction: 'in',
          peerId: edge.source,
          peerLabel: nodeLabels.get(edge.source) ?? edge.source,
          edgeType: edge.type,
          count: 1,
          edgeIds: [edge.id],
        });
      }
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'out' ? -1 : 1;
    return a.peerLabel.localeCompare(b.peerLabel);
  });
}

const edgeTypeColors: Record<string, string> = {
  delegation: '#818cf8',
  critique: '#f87171',
  review: '#34d399',
  escalation: '#fbbf24',
  dependency: '#5d6180',
  data_flow: '#60a5fa',
  uses: '#fbbf24',
  produces: '#fb923c',
  approval: '#34d399',
  member_of: '#a78bfa',
};

export function EdgeInspector() {
  const {
    selectedNodeId,
    baseNodes,
    baseEdges,
    highlightedEdgeId,
    setHighlightedEdgeId,
    hiddenContext,
  } = useGraphStore();

  const connections = useMemo(() => {
    if (!selectedNodeId) return [];

    const nodeLabels = new Map(baseNodes.map((node) => [node.id, node.label]));
    return aggregateConnections(selectedNodeId, baseEdges, nodeLabels);
  }, [selectedNodeId, baseNodes, baseEdges]);

  if (!selectedNodeId) return null;

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.12em] text-[#818cf8] font-bold">
          Connections ({connections.length})
        </span>
        {highlightedEdgeId && (
          <button
            onClick={() => setHighlightedEdgeId(null)}
            className="text-[9px] text-[#5d6180] hover:text-[#e8eaf0]"
          >
            Clear highlight
          </button>
        )}
      </div>

      {connections.length === 0 ? (
        hiddenContext?.kind === 'hidden_recorded_context' ? (
          <div className="space-y-1">
            <p className="text-[11px] text-[#cfd3e6]">{hiddenContext.disclosure}</p>
            {hiddenContext.inspectHint && (
              <p className="text-[10px] text-[#8f95b2]">{hiddenContext.inspectHint}</p>
            )}
          </div>
        ) : hiddenContext?.kind === 'missing_relationship_evidence' ? (
          <p className="text-[11px] text-[#5d6180] italic">{hiddenContext.disclosure}</p>
        ) : (
          <p className="text-[11px] text-[#5d6180] italic">No connections for this node.</p>
        )
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
          {connections.map((row) => {
            const isHighlighted = row.edgeIds.includes(highlightedEdgeId ?? '');
            const color = edgeTypeColors[row.edgeType] ?? '#5d6180';

            return (
              <button
                key={row.id}
                onClick={() => setHighlightedEdgeId(row.edgeIds[0])}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                  isHighlighted
                    ? 'bg-[rgba(99,102,241,0.12)] border border-[#6366f1]/25'
                    : 'hover:bg-[rgba(255,255,255,0.03)] border border-transparent'
                }`}
              >
                {row.direction === 'out' ? (
                  <ArrowRight size={11} className="text-[#5d6180] shrink-0" />
                ) : (
                  <ArrowLeft size={11} className="text-[#5d6180] shrink-0" />
                )}
                <span className="flex-1 text-[11px] text-[#e8eaf0] truncate">{row.peerLabel}</span>
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    color,
                    backgroundColor: `${color}18`,
                    border: `1px solid ${color}33`,
                  }}
                >
                  {row.edgeType}
                  {row.count > 1 ? ` ×${row.count}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
