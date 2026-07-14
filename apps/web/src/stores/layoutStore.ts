import { create } from 'zustand';

interface LayoutStore {
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;

  setIsLeftCollapsed: (collapsed: boolean) => void;
  setIsRightCollapsed: (collapsed: boolean) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  isLeftCollapsed: false,
  isRightCollapsed: false,

  setIsLeftCollapsed: (isLeftCollapsed) => set({ isLeftCollapsed }),
  setIsRightCollapsed: (isRightCollapsed) => set({ isRightCollapsed }),
}));
