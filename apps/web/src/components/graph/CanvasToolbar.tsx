'use client';

import { GitBranch, Loader2, Shield, Users } from 'lucide-react';
import { FlowLens } from './FlowLens';

interface CanvasToolbarProps {
  agentCount: number;
  branchCount: number;
  pendingInterrupts: number;
  activeAgents: number;
}

export function CanvasToolbar({
  agentCount,
  branchCount,
  pendingInterrupts,
  activeAgents,
}: CanvasToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-3 pt-3 lg:flex-row lg:items-start lg:gap-3">
      <div className="pointer-events-auto flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[38%]">
        <div className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px]">
          <Users size={12} className="text-[#818cf8]" />
          <span className="text-[#9498b0]">{agentCount} agents</span>
        </div>
        <div className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px]">
          <GitBranch size={12} className="text-[#67e8f9]" />
          <span className="text-[#9498b0]">{branchCount} branches</span>
        </div>
        <div className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px]">
          <Shield size={12} className="text-[#34d399]" />
          <span className="text-[#9498b0]">{pendingInterrupts} pending interrupts</span>
        </div>
        <div className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px]">
          <Loader2
            size={12}
            className={activeAgents > 0 ? 'animate-spin text-[#fbbf24]' : 'text-[#5d6180]'}
          />
          <span className="text-[#9498b0]">{activeAgents} active agents</span>
        </div>
      </div>

      <div className="pointer-events-auto min-w-0 flex-1 flex justify-end lg:justify-center">
        <FlowLens />
      </div>
    </div>
  );
}
