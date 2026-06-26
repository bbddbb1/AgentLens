/**
 * ROPS Level 2 — Quick Hover (spec section 4 / 5).
 *
 * Triggered by pointer hover over an L1 canvas card. Shows:
 *   - full Identity (id, name, type, role, team, framework)
 *   - Lifecycle (status + status_label, phase if applicable)
 *   - key payload metadata (tool name / memory key / artifact name / task name)
 *   - relationships (next_transition, producer/consumer/parent counts)
 *
 * It must NOT show: complete payload, statistics, provenance, recent events,
 * or raw envelope attributes (those are L3/L4). It must NOT show anything
 * classified X (the `generated` block, narratives).
 *
 * The hover is a pure function of the `RopsHoverModel` passed in; it never
 * fetches data. The parent node component builds the model from the same
 * `GraphNode` + (optional) `RuntimeNodeProjection.facts` it already holds.
 */
'use client';

import type { GraphNode, NodeProjectionFacts, RuntimeNodeProjection } from '@agentlens/protocol';
import {
  buildAgentView,
  buildGraphNodeView,
  deriveRelationships,
  formatDurationMs,
  nodeStatusLabel,
} from '@/lib/rops/provenance';
import { ProvenanceTag } from './primitives';

export interface RopsHoverModel {
  readonly node: GraphNode;
  readonly edges: readonly import('@agentlens/protocol').GraphEdge[];
  /** Optional agent projection facts (only for agent nodes). */
  readonly agentProjection?: RuntimeNodeProjection | null;
}

export function RopsHover({ model }: { model: RopsHoverModel }) {
  const { node, edges, agentProjection } = model;
  const nodeView = buildGraphNodeView(node);
  const rels = deriveRelationships(node.id, edges);
  const isAgent = node.type === 'agent';
  const agentView = isAgent && agentProjection ? buildAgentView(agentProjection) : null;

  const headlinePayload = pickHeadlinePayload(node, agentProjection?.facts);

  return (
    <div className="w-[260px] rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#1a1b25] p-3 shadow-xl space-y-2.5 text-left">
      {/* Identity (full) */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-[#6b708a] font-bold">
            {nodeView.objectType}
          </span>
        </div>
        <div className="text-[13px] font-semibold text-[#e8eaf0] truncate">{nodeView.label.value}</div>
        <div className="text-[10px] text-[#9498b0] space-y-0.5">
          {nodeView.id.value && <div className="font-mono break-all">id: {nodeView.id.value}</div>}
          {nodeView.role.value && <div>role: {nodeView.role.value}</div>}
          {nodeView.team.value && <div>team: {nodeView.team.value}</div>}
          {nodeView.framework.value && <div>framework: {nodeView.framework.value}</div>}
          {nodeView.agentId.value && <div className="font-mono break-all">agent_id: {nodeView.agentId.value}</div>}
        </div>
      </div>

      {/* Lifecycle */}
      <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 space-y-1">
        <div className="text-[9px] uppercase tracking-wider text-[#6b708a]">Lifecycle</div>
        <div className="flex items-center gap-2 text-[10px] text-[#d0d4ea]">
          <span className="capitalize">{nodeView.status.value ?? '—'}</span>
          <span className="text-[#5d6180]">·</span>
          <span>{nodeStatusLabel(nodeView.status.value) ?? '—'}</span>
          <ProvenanceTag provenance="projection" />
        </div>
        {agentView && (
          <div className="text-[10px] text-[#9498b0] space-y-0.5">
            {agentView.requiresHuman.value === true && <div className="text-[#fbbf24]">requires human</div>}
            {agentView.pending.value && <div>pending: {agentView.pending.value}</div>}
          </div>
        )}
      </div>

      {/* Key payload metadata (L2 only) */}
      {headlinePayload && (
        <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-[#6b708a]">Payload</div>
          <div className="text-[10px] text-[#d0d4ea] break-words">{headlinePayload}</div>
        </div>
      )}

      {/* Relationships (L2 only) */}
      {rels.length > 0 && (
        <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-[#6b708a]">Relationships</div>
          {rels.map((r) => (
            <div key={r.kind} className="text-[10px] text-[#9498b0] flex items-center gap-1.5">
              <span className="capitalize">{r.kind}</span>
              <span className="text-[#5d6180]">→</span>
              <span className="font-mono break-all">{r.nodeIds.join(', ')}</span>
              <ProvenanceTag provenance="projection" />
            </div>
          ))}
        </div>
      )}

      {agentView?.nextTransition.value && (
        <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-[#6b708a]">Next Transition</div>
          <div className="text-[10px] text-[#d0d4ea]">
            → {agentView.nextTransition.value.target} ({agentView.nextTransition.value.kind})
            {agentView.nextTransition.value.reason ? ` — ${agentView.nextTransition.value.reason}` : ''}
          </div>
        </div>
      )}

      {agentView && agentView.durationMs.value !== undefined && (
        <div className="border-t border-[rgba(255,255,255,0.05)] pt-2 text-[10px] text-[#9498b0] flex items-center gap-1.5">
          <span>duration: {formatDurationMs(agentView.durationMs.value)}</span>
          <ProvenanceTag provenance="projection" />
        </div>
      )}
    </div>
  );
}

/**
 * Pick a single headline payload string for L2 (spec 5.1 "key payload metadata").
 * Deterministic, evidence-only.
 */
function pickHeadlinePayload(
  node: GraphNode,
  facts: NodeProjectionFacts | undefined,
): string | null {
  const meta = (node.metadata ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case 'tool':
      return (meta.tool_name as string) ?? (meta.name as string) ?? node.label;
    case 'memory':
      return (meta.memory_key as string) ?? (meta.key as string) ?? node.label;
    case 'artifact':
      return (meta.artifact_name as string) ?? (meta.name as string) ?? node.label;
    case 'task':
      return (meta.task as string) ?? node.label;
    case 'agent':
      return facts?.role ?? node.agent_role ?? null;
    default:
      return null;
  }
}
