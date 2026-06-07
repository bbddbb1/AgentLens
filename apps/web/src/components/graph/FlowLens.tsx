'use client';

import { Focus, GitBranch, Layers, Play, Database, Eye, EyeOff } from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import type { FocusDepth, TracePreset } from '@/lib/graphVisibility';

const TRACE_OPTIONS: Array<{ id: TracePreset; label: string; icon: React.ReactNode }> = [
  { id: 'none', label: 'All paths', icon: <Layers size={12} /> },
  { id: 'orchestration', label: 'Orchestration', icon: <GitBranch size={12} /> },
  { id: 'execution', label: 'Execution', icon: <Play size={12} /> },
  { id: 'data', label: 'Data', icon: <Database size={12} /> },
];

export function FlowLens() {
  const tracePreset = useGraphStore((state) => state.tracePreset);
  const setTracePreset = useGraphStore((state) => state.setTracePreset);
  const showActiveOnly = useGraphStore((state) => state.showActiveOnly);
  const setShowActiveOnly = useGraphStore((state) => state.setShowActiveOnly);
  const focusModeEnabled = useGraphStore((state) => state.focusModeEnabled);
  const toggleFocusMode = useGraphStore((state) => state.toggleFocusMode);
  const focusDepth = useGraphStore((state) => state.focusDepth);
  const setFocusDepth = useGraphStore((state) => state.setFocusDepth);
  const visibleEdgeCount = useGraphStore((state) => state.visibleEdgeCount);
  const totalEdgeCount = useGraphStore((state) => state.totalEdgeCount);
  const zoomBand = useGraphStore((state) => state.zoomBand);

  const heavyFilter = totalEdgeCount > 0 && visibleEdgeCount / totalEdgeCount < 0.3;

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2 lg:justify-center">
      <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(18,19,26,0.92)] px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <span className="px-1 text-[9px] font-bold uppercase tracking-wider text-[#5d6180]">
          Flow Lens
        </span>

        {TRACE_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => setTracePreset(option.id)}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors ${
              tracePreset === option.id
                ? 'border border-[#6366f1]/30 bg-[rgba(99,102,241,0.15)] text-[#a5b4fc]'
                : 'text-[#8f95b2] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8eaf0]'
            }`}
            title={option.label}
          >
            {option.icon}
            <span className="hidden xl:inline">{option.label}</span>
          </button>
        ))}

        <div className="mx-0.5 h-5 w-px bg-[rgba(255,255,255,0.08)]" />

        <button
          onClick={toggleFocusMode}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors ${
            focusModeEnabled
              ? 'border border-[#34d399]/25 bg-[rgba(52,211,153,0.12)] text-[#34d399]'
              : 'text-[#8f95b2] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8eaf0]'
          }`}
          title="Toggle focus mode (F)"
        >
          {focusModeEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
          <Focus size={12} />
        </button>

        <select
          value={focusDepth}
          onChange={(e) => setFocusDepth(Number(e.target.value) as FocusDepth)}
          className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-1 text-[10px] text-[#cfd3e6] outline-none"
          title="Focus depth"
        >
          <option value={1}>1-hop</option>
          <option value={2}>2-hop</option>
        </select>

        <button
          onClick={() => setShowActiveOnly(!showActiveOnly)}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors ${
            showActiveOnly
              ? 'border border-[#fbbf24]/25 bg-[rgba(251,191,36,0.12)] text-[#fbbf24]'
              : 'text-[#8f95b2] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8eaf0]'
          }`}
          title="Show only active edges at current replay step"
        >
          <Play size={12} />
          Active
        </button>
      </div>

      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(18,19,26,0.85)] px-2.5 py-1.5 text-[10px] backdrop-blur-xl">
        <span className="capitalize text-[#5d6180]">{zoomBand}</span>
        <span className="mx-1.5 text-[#3a3d54]">•</span>
        <span className={heavyFilter ? 'text-[#fbbf24]' : 'text-[#9498b0]'}>
          {visibleEdgeCount} / {totalEdgeCount} edges
        </span>
      </div>
    </div>
  );
}
