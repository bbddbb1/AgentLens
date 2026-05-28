import { useLayoutStore } from '@/stores/layoutStore';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { StateInspector } from '@/components/state/StateInspector';
import { PanelRightClose } from 'lucide-react';

export function RightSidebar({ missionId }: { missionId: string }) {
  const { activeRightTab, setActiveRightTab, setIsRightCollapsed } = useLayoutStore();

  return (
    <div className="flex flex-col h-full bg-[#12131a]">
      <div className="flex items-center justify-between px-2 pt-2 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,11,16,0.5)]">
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setActiveRightTab('inspector')}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-t-lg transition-colors ${activeRightTab === 'inspector' ? 'bg-[#1a1b25] text-[#e8eaf0]' : 'text-[#5d6180] hover:text-[#9498b0] hover:bg-[rgba(255,255,255,0.02)]'}`}
          >
            Inspector
          </button>
          <button 
            onClick={() => setActiveRightTab('review')}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-t-lg transition-colors ${activeRightTab === 'review' ? 'bg-[#1a1b25] text-[#e8eaf0]' : 'text-[#5d6180] hover:text-[#9498b0] hover:bg-[rgba(255,255,255,0.02)]'}`}
          >
            Review
          </button>
        </div>
        <button
          onClick={() => setIsRightCollapsed(true)}
          className="p-1 rounded-md mb-1 mr-1 text-[#5d6180] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          title="Collapse right panel"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative bg-[#1a1b25]">
        {activeRightTab === 'inspector' && <StateInspector missionId={missionId} />}
        {activeRightTab === 'review' && <ReviewPanel />}
      </div>
    </div>
  );
}
