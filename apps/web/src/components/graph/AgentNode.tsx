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
  const summary = typeof nodeData.summary === 'string' ? nodeData.summary : undefined;
  const agentId = typeof nodeData.agentId === 'string' ? nodeData.agentId : '';
  const metadata = (nodeData.metadata as Record<string, unknown>) || {};
  const hasPendingInterrupt = metadata.hasPendingInterrupt === true;

  const [isExpanded, setIsExpanded] = useState(false);

  // Use deterministic color for agent type, otherwise fallback to standard colors
  const color = nodeType === 'agent' ? getAgentColor(agentId) : (nodeTypeColors[nodeType] || '#818cf8');
  const statusColor = statusColors[status] || '#5d6180';
  const Icon = nodeType === 'human' ? <User size={16} /> : (roleIcons[role] || <Bot size={16} />);

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      style={{
        borderColor: selected ? color : 'rgba(255,255,255,0.08)',
        boxShadow: selected ? `0 0 24px ${color}33` : '0 4px 16px rgba(0,0,0,0.3)',
        '--pulse-color': `${color}66`,
        '--pulse-color-transparent': `${color}00`,
      } as React.CSSProperties}
      className={`relative rounded-xl border bg-[#1a1b25] px-4 py-3 min-w-[180px] max-w-[220px] transition-all duration-200 hover:border-[rgba(255,255,255,0.12)] ${status === 'active' ? 'animate-[node-pulse_2s_ease-in-out_infinite]' : ''}`}
    >
      {/* Interrupt Badge */}
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
          <Tooltip content={label} side="right">
            <div className="text-[13px] font-semibold text-[#e8eaf0] truncate">
              {label}
            </div>
          </Tooltip>
          {role && (
            <div className="text-[10px] text-[#9498b0] uppercase tracking-wider">{role}</div>
          )}
        </div>
        {/* Status dot */}
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

      {/* Team badge */}
      {team && (
        <div className="text-[10px] px-2 py-0.5 mb-2 rounded-full bg-[rgba(255,255,255,0.04)] text-[#9498b0] w-fit">
          {team}
        </div>
      )}

      {/* Confidence bar */}
      {confidence != null && (
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

      {/* Summary (Inner Monologue toggle) */}
      {summary && (
        <div className="mt-2 border-t border-[rgba(255,255,255,0.05)] pt-2">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between w-full text-[10px] text-[#9498b0] hover:text-[#e8eaf0] transition-colors"
          >
            <span>Inner Monologue</span>
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
