'use client';

/**
 * Custom Task Node for React Flow.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react';
import { Tooltip } from '@/components/common/Tooltip';

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
  const color = '#67e8f9';

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.05 }}
      style={{
        borderColor: selected ? color : 'rgba(255,255,255,0.06)',
        boxShadow: selected ? `0 0 20px ${color}22` : '0 2px 8px rgba(0,0,0,0.2)',
      }}
      className="rounded-lg border bg-[#151620] px-3 py-2.5 min-w-[160px] max-w-[200px] transition-all duration-200 hover:border-[rgba(255,255,255,0.1)]"
    >
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
          {summary && summary !== label && (
            <Tooltip content={summary} side="right">
              <div className="text-[10px] text-[#5d6180] mt-1 line-clamp-1">
                {summary}
              </div>
            </Tooltip>
          )}
        </div>
      </div>

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
