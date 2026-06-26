'use client';

/**
 * Custom Tool Node for React Flow.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { Wrench, Database, FileText, Globe } from 'lucide-react';
import { RopsHover } from '@/components/rops/RopsHover';
import { useGraphStore } from '@/stores/graphStore';
import { useAuditStore } from '@/stores/auditStore';
import { collectNodeEvidence } from '@/lib/rops/nodeEvidence';

const toolIcons: Record<string, React.ReactNode> = {
  memory: <Database size={14} />,
  artifact: <FileText size={14} />,
  api: <Globe size={14} />,
};

function ToolNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const label = String(nodeData.label ?? 'Tool');
  const nodeType = String(nodeData.nodeType ?? 'tool');
  const metadata = (nodeData.metadata as Record<string, unknown>) || {};
  const invocationCount = typeof metadata.invocationCount === 'number' ? metadata.invocationCount : undefined;
  const color = nodeType === 'memory' ? '#34d399' : nodeType === 'artifact' ? '#fb923c' : '#fbbf24';
  const Icon = toolIcons[nodeType] || <Wrench size={14} />;

  const [isHoverOpen, setIsHoverOpen] = useState(false);
  const baseNodes = useGraphStore((s) => s.baseNodes);
  const baseEdges = useGraphStore((s) => s.baseEdges);
  const auditEvents = useAuditStore((s) => s.events);
  const hoverModel = (() => {
    const gn = baseNodes.find((n) => n.label === label) ?? null;
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
        borderColor: isHighlighted ? color : (selected ? color : 'rgba(255,255,255,0.05)'),
        boxShadow: isHighlighted ? `0 0 16px ${color}` : (selected ? `0 0 16px ${color}22` : 'none'),
      }}
      className="relative rounded-lg border bg-[#131420] px-3 py-2 min-w-[100px] transition-all duration-200"
    >
      {isHoverOpen && hoverModel && (
        <div className="absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 pointer-events-none">
          <RopsHover model={hoverModel} />
        </div>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-1.5 !h-1.5 !border-[1.5px] !rounded-full !bg-[#1e2030]"
        style={{ borderColor: color }}
      />

      <div className="flex items-center gap-2">
        <div style={{ color }}>{Icon}</div>
        <span className="text-[11px] text-[#9498b0] font-medium truncate flex-1">{label}</span>
        {invocationCount !== undefined && invocationCount > 0 && (
          <div className="px-1.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[9px] text-[#cfd3e6] font-semibold">
            {invocationCount}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-1.5 !h-1.5 !border-[1.5px] !rounded-full !bg-[#1e2030]"
        style={{ borderColor: color }}
      />
    </motion.div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
