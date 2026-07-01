'use client';

/**
 * Custom Task Node for React Flow.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react';
import { Tooltip } from '@/components/common/Tooltip';
import { RopsHover } from '@/components/rops/RopsHover';
import { useGraphStore } from '@/stores/graphStore';
import { useAuditStore } from '@/stores/auditStore';
import { collectNodeEvidence } from '@/lib/rops/nodeEvidence';
import { formatDurationMs } from '@/lib/rops/provenance';
import type { RuntimeActivity } from '@agentlens/protocol';

const statusIcons: Record<string, React.ReactNode> = {
  idle: <Circle size={14} className="text-[#5d6180]" />,
  active: <Loader2 size={14} className="text-[#67e8f9] animate-spin" />,
  completed: <CheckCircle2 size={14} className="text-[#34d399]" />,
  failed: <XCircle size={14} className="text-[#f87171]" />,
  waiting: <Circle size={14} className="text-[#fbbf24]" />,
};

function TaskNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const label = String(nodeData.label ?? 'Task');
  const status = String(nodeData.status ?? 'idle');
  const summary = typeof nodeData.summary === 'string' ? nodeData.summary : undefined;
  const metadata = (nodeData.metadata as Record<string, unknown>) || {};
  const progress = typeof metadata.progress === 'number' ? metadata.progress : undefined;
  const color = '#67e8f9';
  const activity = nodeData.activity as RuntimeActivity | undefined;

  // ROPS R-4: L1 headline metric — duration_ms (projection) when completed,
  // else error_count (evidence) when >0, else progress if present.
  const durationMs = typeof nodeData.durationMs === 'number' ? nodeData.durationMs : undefined;
  const errorCount = typeof nodeData.errorCount === 'number' ? nodeData.errorCount : undefined;
  const headlineMetric =
    status === 'completed' && durationMs !== undefined
      ? { display: formatDurationMs(durationMs), provenance: 'projection' as const }
      : errorCount !== undefined && errorCount > 0
        ? { display: `${errorCount} error${errorCount === 1 ? '' : 's'}`, provenance: 'evidence' as const }
        : null;

  const [isHoverOpen, setIsHoverOpen] = useState(false);
  const baseNodes = useGraphStore((s) => s.baseNodes);
  const baseEdges = useGraphStore((s) => s.baseEdges);
  const auditEvents = useAuditStore((s) => s.events);
  const hoverModel = (() => {
    const gn = baseNodes.find((n) => n.label === label && n.type === 'task') ?? null;
    if (!gn) return null;
    return { node: gn, edges: baseEdges, agentProjection: null, evidence: collectNodeEvidence(gn, auditEvents) };
  })();

  const isHighlighted = nodeData.highlighted === true;

  return (
    <motion.div
      initial={false}
      layout={false}
      onHoverStart={() => setIsHoverOpen(true)}
      onHoverEnd={() => setIsHoverOpen(false)}
      style={{
        borderColor: isHighlighted ? color : (selected ? color : 'rgba(255,255,255,0.06)'),
        boxShadow: isHighlighted ? `0 0 20px ${color}` : (selected ? `0 0 20px ${color}22` : '0 2px 8px rgba(0,0,0,0.2)'),
      }}
      className="rounded-lg border bg-[#151620] px-3 py-2.5 min-w-[160px] max-w-[200px] transition-all duration-200 hover:border-[rgba(255,255,255,0.1)]"
    >
      {isHoverOpen && hoverModel && (
        <div className="absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 pointer-events-none">
          <RopsHover model={hoverModel} />
        </div>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-1.5 !h-1.5 !border-2 !rounded-full !bg-[#1e2030]"
        style={{ borderColor: color }}
      />

      <div className="flex items-start gap-2">
        {statusIcons[status] || statusIcons.idle}
        <div className="flex-1 min-w-0">
          <Tooltip content={label} side="right">
            <div className="text-[12px] font-medium text-[#e8eaf0] leading-snug line-clamp-2">
              {label}
            </div>
          </Tooltip>
          {activity?.subtitle && (
            <div className="mt-0.5 truncate text-[9px] font-mono text-[#5d6180]">
              {activity.subtitle}
            </div>
          )}
          {summary && summary !== label && (
            <Tooltip content={summary} side="right">
              <div className="text-[10px] text-[#5d6180] mt-1 line-clamp-1">
                {summary}
              </div>
            </Tooltip>
          )}
          {activity ? (
            <div className="mt-1 text-[9px] text-[#9498b0]">
              <span className="text-[#cfd3e6]">{activity.action}</span>
              <span className="mx-1 text-[#4f536d]">·</span>
              <span>{activity.outcome}</span>
              {activity.duration_ms !== undefined && (
                <>
                  <span className="mx-1 text-[#4f536d]">·</span>
                  <span>{formatDurationMs(activity.duration_ms)}</span>
                </>
              )}
            </div>
          ) : headlineMetric && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[9px] text-[#9498b0]">{headlineMetric.display}</span>
              {headlineMetric.provenance !== 'evidence' && (
                <span className="text-[8px] font-mono uppercase tracking-wider text-[#6b708a]">[projection]</span>
              )}
            </div>
          )}
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-2 h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
            className="h-full bg-[#67e8f9] rounded-full"
          />
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-1.5 !h-1.5 !border-2 !rounded-full !bg-[#1e2030]"
        style={{ borderColor: color }}
      />
    </motion.div>
  );
}

export const TaskNode = memo(TaskNodeComponent);
