import { Bell } from 'lucide-react';
import { RuntimeInterruptState } from '@agentlens/protocol';

interface InterruptBadgeProps {
  interrupt: RuntimeInterruptState;
  onClick?: () => void;
}

export function InterruptBadge({ interrupt, onClick }: InterruptBadgeProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 rounded-lg border border-[rgba(251,191,36,0.14)] bg-[rgba(251,191,36,0.05)] px-3 py-2 cursor-pointer hover:bg-[rgba(251,191,36,0.08)] transition-colors`}
    >
      <Bell size={14} className="text-[#fbbf24] mt-0.5 shrink-0" />
      <div>
        <div className="text-[11px] font-semibold text-[#fbbf24]">Pending Interrupt</div>
        <div className="text-[11px] text-[#f7e8bf] line-clamp-2 mt-0.5">{interrupt.reason}</div>
      </div>
    </div>
  );
}
