'use client';

import { ReactNode, useEffect } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WorkspaceShellProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
  bottomPanel: ReactNode;
}

export function WorkspaceShell({ leftPanel, centerPanel, rightPanel, bottomPanel }: WorkspaceShellProps) {
  const {
    isLeftCollapsed,
    isRightCollapsed,
    setIsLeftCollapsed,
    setIsRightCollapsed,
  } = useLayoutStore();

  // Keyboard shortcuts [ and ]
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '[') {
        setIsLeftCollapsed(!useLayoutStore.getState().isLeftCollapsed);
      } else if (e.key === ']') {
        setIsRightCollapsed(!useLayoutStore.getState().isRightCollapsed);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsLeftCollapsed, setIsRightCollapsed]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative bg-[#0a0b10]">
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Panel */}
        <div 
          className={`flex flex-col bg-[#0a0b10] border-r border-[rgba(255,255,255,0.05)] transition-all duration-300 ease-in-out shrink-0 ${
            isLeftCollapsed ? 'w-0 opacity-0 overflow-hidden border-r-0' : 'w-[320px] opacity-100'
          }`}
        >
          {/* Inner fixed-width container prevents content from squishing during animation */}
          <div className="w-[320px] h-full flex flex-col">
            {leftPanel}
          </div>
        </div>

        {/* Center Panel (Graph) */}
        <div className="flex-1 flex flex-col relative min-w-0">
          {/* Toggle Left Button */}
          <button
            onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-12 bg-[rgba(255,255,255,0.03)] backdrop-blur-md border border-[rgba(255,255,255,0.1)] border-l-0 rounded-r-lg text-[#9498b0] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-all shadow-[0_0_15px_rgba(0,0,0,0.3)]"
            title={isLeftCollapsed ? "Expand timeline ([)" : "Collapse timeline ([)"}
          >
            {isLeftCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {centerPanel}

          {/* Toggle Right Button */}
          <button
            onClick={() => setIsRightCollapsed(!isRightCollapsed)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-12 bg-[rgba(255,255,255,0.03)] backdrop-blur-md border border-[rgba(255,255,255,0.1)] border-r-0 rounded-l-lg text-[#9498b0] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-all shadow-[0_0_15px_rgba(0,0,0,0.3)]"
            title={isRightCollapsed ? "Expand inspector (])" : "Collapse inspector (])"}
          >
            {isRightCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        {/* Right Panel */}
        <div 
          className={`flex flex-col bg-[#12131a] border-l border-[rgba(255,255,255,0.05)] transition-all duration-300 ease-in-out shrink-0 ${
            isRightCollapsed ? 'w-0 opacity-0 overflow-hidden border-l-0' : 'w-[340px] opacity-100'
          }`}
        >
          {/* Inner fixed-width container prevents content from squishing during animation */}
          <div className="w-[340px] h-full flex flex-col">
            {rightPanel}
          </div>
        </div>
      </div>

      {/* Bottom Panel (Status Bar) */}
      <div className="h-14 border-t border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.95)] z-40 shrink-0">
        {bottomPanel}
      </div>
    </div>
  );
}
