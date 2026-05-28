import { create } from 'zustand';

interface LayoutStore {
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  activeRightTab: 'inspector' | 'review' | 'ai';
  isGraphFullscreen: boolean;

  setIsLeftCollapsed: (collapsed: boolean) => void;
  setIsRightCollapsed: (collapsed: boolean) => void;
  setActiveRightTab: (tab: 'inspector' | 'review' | 'ai') => void;
  setIsGraphFullscreen: (fullscreen: boolean) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  isLeftCollapsed: false,
  isRightCollapsed: false,
  activeRightTab: 'inspector',
  isGraphFullscreen: false,

  setIsLeftCollapsed: (isLeftCollapsed) => set({ isLeftCollapsed }),
  setIsRightCollapsed: (isRightCollapsed) => set({ isRightCollapsed }),
  setActiveRightTab: (activeRightTab) => set({ activeRightTab }),
  setIsGraphFullscreen: (isGraphFullscreen) => set({ isGraphFullscreen }),
}));
