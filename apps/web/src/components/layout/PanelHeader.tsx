import { ReactNode } from 'react';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';
import { useLayoutStore } from '@/stores/layoutStore';

interface PanelHeaderProps {
  title: string;
  icon?: ReactNode;
  side: 'left' | 'right';
  actions?: ReactNode;
}

export function PanelHeader({ title, icon, side, actions }: PanelHeaderProps) {
  const { setIsLeftCollapsed, setIsRightCollapsed } = useLayoutStore();

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.5)] shrink-0">
      <div className="flex items-center gap-2">
        {icon && <span className="text-[#818cf8]">{icon}</span>}
        <h3 className="text-[13px] font-semibold text-[#e8eaf0]">{title}</h3>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button
          onClick={() => side === 'left' ? setIsLeftCollapsed(true) : setIsRightCollapsed(true)}
          className="p-1 rounded-md text-[#5d6180] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          title={`Collapse ${side} panel`}
        >
          {side === 'left' ? <PanelLeftClose size={14} /> : <PanelRightClose size={14} />}
        </button>
      </div>
    </div>
  );
}
