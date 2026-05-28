'use client';

/**
 * Custom Tool Node for React Flow.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { Wrench, Database, FileText, Globe } from 'lucide-react';

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

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.1 }}
      style={{
        borderColor: selected ? color : 'rgba(255,255,255,0.05)',
        boxShadow: selected ? `0 0 16px ${color}22` : 'none',
      }}
      className="rounded-lg border bg-[#131420] px-3 py-2 min-w-[100px] transition-all duration-200"
    >
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
