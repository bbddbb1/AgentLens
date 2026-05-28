import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X } from 'lucide-react';

export function GraphLegend() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="absolute bottom-4 left-4 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="mb-3 w-64 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(18,19,26,0.95)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl p-4"
          >
            <div className="flex items-center justify-between mb-3 border-b border-[rgba(255,255,255,0.05)] pb-2">
              <h4 className="text-[12px] font-semibold text-[#e8eaf0]">Graph Legend</h4>
              <button onClick={() => setIsOpen(false)} className="text-[#5d6180] hover:text-[#e8eaf0]">
                <X size={14} />
              </button>
            </div>
            
            <div className="space-y-4">
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
              
              <div>
                <h5 className="text-[10px] uppercase tracking-wider text-[#9498b0] mb-2">Edge Types</h5>
                <div className="space-y-1.5 text-[11px] text-[#cfd3e6]">
                  <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-[#818cf8]" /> Delegation</div>
                  <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-[#f87171] border-t border-dashed" /> Critique</div>
                  <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-[#34d399]" /> Review</div>
                  <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-[#60a5fa] border-t border-dotted" /> Data Flow</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-8 h-8 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(18,19,26,0.9)] text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.04)] shadow-lg backdrop-blur-xl transition-all"
        title="Toggle Legend"
      >
        <HelpCircle size={16} />
      </button>
    </div>
  );
}
