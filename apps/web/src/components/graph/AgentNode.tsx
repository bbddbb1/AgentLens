'use client';

/**
 * Custom Agent Node for React Flow.
 * Renders agents with role-based icons, status indicators, and confidence bars.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, User, Shield, Brain, Search, Pencil, Wrench, Zap, ChevronDown, ChevronUp, Bell } from 'lucide-react';
import { Tooltip } from '@/components/common/Tooltip';
import { getAgentColor } from '@/lib/agentColors';
import { RopsHover } from '@/components/rops/RopsHover';
import { useGraphStore } from '@/stores/graphStore';
import { formatDurationMs } from '@/lib/rops/provenance';

const roleIcons: Record<string, React.ReactNode> = {
  planner: <Brain size={16} />,
  researcher: <Search size={16} />,
  critic: <Shield size={16} />,
  writer: <Pencil size={16} />,
  executor: <Zap size={16} />,
  reviewer: <Shield size={16} />,
  tool_user: <Wrench size={16} />,
};

const statusColors: Record<string, string> = {
  active: '#818cf8',
  completed: '#34d399',
  failed: '#f87171',
  waiting: '#fbbf24',
  idle: '#5d6180',
  reviewing: '#a78bfa',
};

const nodeTypeColors: Record<string, string> = {
  agent: '#818cf8',
  human: '#f0abfc',
  team: '#a78bfa',
};

function AgentNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const label = String(nodeData.label ?? 'Agent');
  const nodeType = String(nodeData.nodeType ?? 'agent');
  const status = String(nodeData.status ?? 'idle');
  const role = String(nodeData.role ?? 'agent');
  const team = typeof nodeData.team === 'string' ? nodeData.team : undefined;
  const confidence = typeof nodeData.confidence === 'number' ? nodeData.confidence : undefined;
  // ROPS 10.3: the confidence bar is shown only when confidence is emitter-set
  // Evidence. The store sets confidenceIsEvidence=true only when GraphNode.confidence
  // was present (the graph layer never runs the scratchToFacts inferred formula).
  // The inferred fallback is surfaced only at L3 (inspector), labelled heuristic.
  const confidenceIsEvidence = nodeData.confidenceIsEvidence !== false;
  const summary = typeof nodeData.summary === 'string' ? nodeData.summary : undefined;
  const agentId = typeof nodeData.agentId === 'string' ? nodeData.agentId : '';
  const metadata = (nodeData.metadata as Record<string, unknown>) || {};
  const hasPendingInterrupt = metadata.hasPendingInterrupt === true;
  const hideLabel = nodeData.hideLabel === true;
  const satelliteCounts = nodeData.satelliteCounts as
    | { tools: number; memory: number; artifacts: number }
    | undefined;

  // ROPS R-4: exactly one L1 headline metric — duration_ms when completed,
  // else error_count when >0, else none. Deterministic, evidence/projection only.
  const durationMs = typeof nodeData.durationMs === 'number' ? nodeData.durationMs : undefined;
  const errorCount = typeof nodeData.errorCount === 'number' ? nodeData.errorCount : undefined;
  const headlineMetric =
    status === 'completed' && durationMs !== undefined
      ? { key: 'duration_ms', display: formatDurationMs(durationMs), provenance: 'projection' as const }
      : errorCount !== undefined && errorCount > 0
        ? { key: 'error_count', display: `${errorCount} error${errorCount === 1 ? '' : 's'}`, provenance: 'evidence' as const }
        : null;

  const [isExpanded, setIsExpanded] = useState(false);
  const [isHoverOpen, setIsHoverOpen] = useState(false);

  // ROPS L2: build the hover model from the current snapshot's GraphNode + edges.
  // The store is the existing source of truth; we only read, never infer.
  const baseNodes = useGraphStore((s) => s.baseNodes);
  const baseEdges = useGraphStore((s) => s.baseEdges);
  const hoverModel = (() => {
    const gn = baseNodes.find((n) => n.id === agentId) ?? baseNodes.find((n) => n.label === label);
    if (!gn) return null;
    return { node: gn, edges: baseEdges, agentProjection: null };
  })();

  // Use deterministic color for agent type, otherwise fallback to standard colors
  const color = nodeType === 'agent' ? getAgentColor(agentId) : (nodeTypeColors[nodeType] || '#818cf8');
  const statusColor = statusColors[status] || '#5d6180';
  const Icon = nodeType === 'human' ? <User size={16} /> : (roleIcons[role] || <Bot size={16} />);

  const isHighlighted = nodeData.highlighted === true;

  return (
    <motion.div
      initial={false}
      layout={false}
      onHoverStart={() => setIsHoverOpen(true)}
      onHoverEnd={() => setIsHoverOpen(false)}
      style={{
        borderColor: isHighlighted ? color : (selected ? color : 'rgba(255,255,255,0.08)'),
        boxShadow: isHighlighted ? `0 0 24px ${color}` : (selected ? `0 0 24px ${color}33` : '0 4px 16px rgba(0,0,0,0.3)'),
        '--pulse-color': `${color}66`,
        '--pulse-color-transparent': `${color}00`,
      } as React.CSSProperties}
      className={`relative rounded-xl border bg-[#1a1b25] px-4 py-3 min-w-[180px] max-w-[220px] transition-all duration-200 hover:border-[rgba(255,255,255,0.12)] ${status === 'active' || isHighlighted ? 'animate-[node-pulse_2s_ease-in-out_infinite]' : ''}`}
    >
      {/* ROPS L2 hover popover */}
      {isHoverOpen && hoverModel && (
        <div className="absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 pointer-events-none">
          <RopsHover model={hoverModel} />
        </div>
      )}

      {/* Interrupt Badge — ROPS 10.1: shown only when Evidence (metadata.hasPendingInterrupt) */}
      {hasPendingInterrupt && (
        <div className="absolute -top-2 -right-2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-[#fbbf24] text-[#78350f] shadow-[0_4px_12px_rgba(251,191,36,0.4)] animate-bounce">
          <Bell size={12} fill="currentColor" />
        </div>
      )}

      {/* Target handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !border-2 !rounded-full !bg-[#1e2030]"
        style={{ borderColor: color }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="flex items-center justify-center w-7 h-7 rounded-lg"
          style={{ background: `${color}22`, color }}
        >
          {Icon}
        </div>
        <div className="flex-1 min-w-0">
          {!hideLabel && (
            <Tooltip content={label} side="right">
              <div className="text-[13px] font-semibold text-[#e8eaf0] truncate">
                {label}
              </div>
            </Tooltip>
          )}
          {!hideLabel && role && (
            <div className="text-[10px] text-[#9498b0] uppercase tracking-wider">{role}</div>
          )}
        </div>
        {/* Status dot — ROPS 7.1 vocabulary, animation only for observed `active` (7.8) */}
        <div className="relative">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: statusColor }}
          />
          {status === 'active' && (
            <div
              className="absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping"
              style={{ background: statusColor, opacity: 0.4 }}
            />
          )}
        </div>
      </div>

      {/* Team badge — Evidence */}
      {team && (
        <div className="text-[10px] px-2 py-0.5 mb-2 rounded-full bg-[rgba(255,255,255,0.04)] text-[#9498b0] w-fit">
          {team}
        </div>
      )}

      {/* ROPS R-4: single L1 headline metric */}
      {headlineMetric && (
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[10px] text-[#9498b0]">{headlineMetric.display}</span>
          <span className="text-[8px] font-mono tracking-wider uppercase text-[#6b708a]">
            {headlineMetric.provenance === 'evidence' ? '' : '[projection]'}
          </span>
        </div>
      )}

      {/* Confidence bar — ROPS 10.3: only when emitter-set Evidence.
          The graph node never carries the inferred fallback, so this bar is
          always Evidence when shown. Heuristic confidence is L3-only. */}
      {confidence != null && confidenceIsEvidence && (
        <div className="mt-1">
          <div className="flex justify-between text-[10px] text-[#5d6180] mb-0.5">
            <span>Confidence</span>
            <span>{Math.round(confidence * 100)}%</span>
          </div>
          <div className="h-1 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${confidence * 100}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{
                background: `linear-gradient(90deg, ${color}, ${confidence > 0.7 ? '#34d399' : confidence > 0.4 ? '#fbbf24' : '#f87171'})`,
              }}
            />
          </div>
        </div>
      )}

      {/* Summary — Evidence, emitter-set on GraphNode.summary (verbatim, never narrative) */}
      {summary && (
        <div className="mt-2 border-t border-[rgba(255,255,255,0.05)] pt-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between w-full text-[10px] text-[#9498b0] hover:text-[#e8eaf0] transition-colors"
          >
            <span>Event Summary</span>
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 p-2 rounded bg-[rgba(255,255,255,0.03)] text-[10px] text-[#cfd3e6] leading-relaxed break-words">
                  {summary}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Satellite-count badges — ROPS 10.1: derived counts, muted (projection) */}
      {satelliteCounts && (satelliteCounts.tools > 0 || satelliteCounts.memory > 0 || satelliteCounts.artifacts > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {satelliteCounts.tools > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[rgba(251,191,36,0.12)] text-[#fbbf24] border border-[rgba(251,191,36,0.2)]">
              {satelliteCounts.tools} tool{satelliteCounts.tools > 1 ? 's' : ''}
            </span>
          )}
          {satelliteCounts.memory > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[rgba(52,211,153,0.12)] text-[#34d399] border border-[rgba(52,211,153,0.2)]">
              {satelliteCounts.memory} mem
            </span>
          )}
          {satelliteCounts.artifacts > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[rgba(251,146,60,0.12)] text-[#fb923c] border border-[rgba(251,146,60,0.2)]">
              {satelliteCounts.artifacts} art
            </span>
          )}
        </div>
      )}

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !border-2 !rounded-full !bg-[#1e2030]"
        style={{ borderColor: color }}
      />
    </motion.div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
