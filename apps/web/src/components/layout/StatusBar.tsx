import { ReactNode } from 'react';
import { ReplayControls } from '@/components/replay/ReplayControls';

interface StatusBarProps {
  metrics?: ReactNode;
}

export function StatusBar({ metrics }: StatusBarProps) {
  return (
    <div className="h-full px-4 flex items-center justify-between gap-4">
      <div className="flex-1 flex items-center h-full">
        <ReplayControls />
      </div>
      
      {metrics && (
        <div className="flex items-center gap-3 shrink-0 h-full border-l border-[rgba(255,255,255,0.05)] pl-4">
          {metrics}
        </div>
      )}
    </div>
  );
}
