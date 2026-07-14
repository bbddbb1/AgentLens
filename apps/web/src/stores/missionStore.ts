/**
 * Mission store manages mission list and active mission state.
 */

import { create } from 'zustand';

import type { Mission } from '@agentlens/protocol';
export type { Mission } from '@agentlens/protocol';

interface MissionStore {
  missions: Mission[];
  activeMission: Mission | null;
  isLoading: boolean;
  error: string | null;

  setMissions: (missions: Mission[]) => void;
  setActiveMission: (mission: Mission | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateMission: (id: string, updates: Partial<Mission>) => void;
}

export const useMissionStore = create<MissionStore>((set) => ({
  missions: [],
  activeMission: null,
  isLoading: false,
  error: null,

  setMissions: (missions) => set({ missions }),
  setActiveMission: (mission) => set({ activeMission: mission }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  updateMission: (id, updates) =>
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
      activeMission:
        state.activeMission?.id === id
          ? { ...state.activeMission, ...updates }
          : state.activeMission,
    })),
}));
