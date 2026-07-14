'use client';

import { Users } from 'lucide-react';
import { FlowLens } from './FlowLens';

interface CanvasToolbarProps {
  agentCount: number;
}

export function CanvasToolbar({
  agentCount,
}: CanvasToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-3 pt-3 lg:flex-row lg:items-start lg:gap-3">
      <div className="pointer-events-auto flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[38%]">
        <div className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px]">
          <Users size={12} className="text-[#818cf8]" />
          <span className="text-[#9498b0]">{agentCount} agents</span>
        </div>
      </div>

      <div className="pointer-events-auto min-w-0 flex-1 flex justify-end lg:justify-center">
        <FlowLens />
      </div>
    </div>
  );
}
