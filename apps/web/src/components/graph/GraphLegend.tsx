'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X, Filter } from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import { ALL_EDGE_TYPES } from '@/lib/graphVisibility';
import type { EdgeType } from '@agentlens/protocol';
import type { EdgeLayerPreset } from '@/lib/graphVisibility';

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  delegation: 'Delegation',
  critique: 'Critique',
  review: 'Review',
  escalation: 'Escalation',
  dependency: 'Dependency',
  uses: 'Uses',
  data_flow: 'Data Flow',
  produces: 'Produces',
  approval: 'Approval',
  member_of: 'Member Of',
};

const EDGE_TYPE_COLORS: Record<EdgeType, string> = {
  delegation: '#818cf8',
  critique: '#f87171',
  review: '#34d399',
  escalation: '#fbbf24',
  dependency: '#5d6180',
  uses: '#fbbf24',
  data_flow: '#60a5fa',
  produces: '#fb923c',
  approval: '#34d399',
  member_of: '#a78bfa',
};

const PRESETS: Array<{ id: EdgeLayerPreset; label: string }> = [
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'execution', label: 'Execution' },
  { id: 'data', label: 'Data' },
  { id: 'all', label: 'All' },
];

export function GraphLegend() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    edgeLayerPreset,
    setEdgeLayerPreset,
    edgeVisibility,
    setEdgeTypeVisible,
    bundleEdges,
    setBundleEdges,
  } = useGraphStore();

  return (
    <div className="absolute bottom-4 left-4 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="mb-3 w-72 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(18,19,26,0.95)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl p-4"
          >
            <div className="flex items-center justify-between mb-3 border-b border-[rgba(255,255,255,0.05)] pb-2">
              <h4 className="text-[12px] font-semibold text-[#e8eaf0] flex items-center gap-1.5">
                <Filter size={13} className="text-[#818cf8]" />
                Edge Layers
              </h4>
              <button onClick={() => setIsOpen(false)} className="text-[#5d6180] hover:text-[#e8eaf0]">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h5 className="text-[10px] uppercase tracking-wider text-[#9498b0] mb-2">Presets</h5>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setEdgeLayerPreset(preset.id)}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                        edgeLayerPreset === preset.id
                          ? 'bg-[rgba(99,102,241,0.15)] text-[#a5b4fc] border border-[#6366f1]/30'
                          : 'bg-[rgba(255,255,255,0.03)] text-[#8f95b2] hover:text-[#e8eaf0] border border-transparent'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h5 className="text-[10px] uppercase tracking-wider text-[#9498b0] mb-2">Edge Types</h5>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {ALL_EDGE_TYPES.map((type) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 text-[11px] text-[#cfd3e6] cursor-pointer hover:text-white"
                    >
                      <input
                        type="checkbox"
                        checked={edgeVisibility[type]}
                        onChange={(e) => setEdgeTypeVisible(type, e.target.checked)}
                        className="rounded border-[rgba(255,255,255,0.15)] bg-transparent accent-[#6366f1]"
                      />
                      <div
                        className="w-4 h-0.5 shrink-0"
                        style={{ backgroundColor: EDGE_TYPE_COLORS[type] }}
                      />
                      {EDGE_TYPE_LABELS[type]}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h5 className="text-[10px] uppercase tracking-wider text-[#9498b0] mb-2">Node Types</h5>
                <div className="space-y-1.5 text-[11px] text-[#cfd3e6]">
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#818cf8]" /> Agent</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#67e8f9]" /> Task</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#fbbf24]" /> Tool</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#34d399]" /> Memory</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#fb923c]" /> Artifact</div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[#cfd3e6] cursor-pointer pt-1 border-t border-[rgba(255,255,255,0.05)]">
                <input
                  type="checkbox"
                  checked={bundleEdges}
                  onChange={(e) => setBundleEdges(e.target.checked)}
                  className="rounded border-[rgba(255,255,255,0.15)] bg-transparent accent-[#6366f1]"
                />
                Bundle parallel edges
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-8 h-8 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(18,19,26,0.9)] text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.04)] shadow-lg backdrop-blur-xl transition-all"
        title="Toggle Edge Layers"
      >
        <HelpCircle size={16} />
      </button>
    </div>
  );
}
