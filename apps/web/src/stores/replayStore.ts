/**
 * Replay store - manages branch-aware replay playback and runtime state.
 */

import { create } from 'zustand';
import type {
  EventEnvelope,
  ReplayBranch,
  ReplayStateResponse,
  RuntimeSelectedActivityState,
  RuntimeState,
} from '@agentlens/protocol';

interface ReplayStore {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  playbackSpeed: number;
  durationSeconds: number | null;
  currentBranchId: string | null;
  branches: ReplayBranch[];
  events: EventEnvelope[];
  currentState: RuntimeState | null;
  selectedEventId: string | null;
  selectedActivityId: string | null;
  activityContextState: RuntimeSelectedActivityState | null;

  setIsPlaying: (playing: boolean) => void;
  setCurrentFrame: (frame: number) => void;
  setTotalFrames: (total: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setDuration: (seconds: number | null) => void;
  setCurrentBranchId: (branchId: string | null) => void;
  setSelectedEventId: (eventId: string | null) => void;
  setSelectedActivityId: (activityId: string | null) => void;
  setActivityContextState: (state: RuntimeSelectedActivityState | null) => void;
  setReplayData: (data: Pick<ReplayStateResponse, 'branch_id' | 'branches' | 'events' | 'total_frames' | 'duration_seconds' | 'current_state'>) => void;
  nextFrame: () => void;
  prevFrame: () => void;
  optimisticBranchCreated: (branch: ReplayBranch) => void;
  clearWorkspace: () => void;
  reset: () => void;
}

export const useReplayStore = create<ReplayStore>((set, get) => ({
  isPlaying: false,
  currentFrame: 0,
  totalFrames: 0,
  playbackSpeed: 1,
  durationSeconds: null,
  currentBranchId: null,
  branches: [],
  events: [],
  currentState: null,
  selectedEventId: null,
  selectedActivityId: null,
  activityContextState: null,

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentFrame: (currentFrame) => {
    const safeFrame = Math.max(0, Math.min(currentFrame, Math.max(get().totalFrames - 1, 0)));
    set({ currentFrame: safeFrame });
  },
  setTotalFrames: (totalFrames) => set({ totalFrames }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setDuration: (durationSeconds) => set({ durationSeconds }),
  setCurrentBranchId: (currentBranchId) => set({ currentBranchId }),
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),
  setSelectedActivityId: (selectedActivityId) => set({ selectedActivityId }),
  setActivityContextState: (activityContextState) => set({ activityContextState }),
  setReplayData: (data) =>
    set((state) => {
      const nextFrame = Math.max(0, Math.min(state.currentFrame, Math.max(data.total_frames - 1, 0)));
      return {
        currentBranchId: data.branch_id,
        branches: data.branches,
        events: data.events,
        currentState: data.current_state,
        totalFrames: data.total_frames,
        durationSeconds: data.duration_seconds,
        currentFrame: nextFrame,
        selectedEventId: null,
        selectedActivityId: null,
        activityContextState: null,
      };
    }),

  nextFrame: () => {
    const { currentFrame, totalFrames } = get();
    if (currentFrame < totalFrames - 1) {
      set({ currentFrame: currentFrame + 1 });
    } else {
      set({ isPlaying: false });
    }
  },

  prevFrame: () => {
    const { currentFrame } = get();
    if (currentFrame > 0) {
      set({ currentFrame: currentFrame - 1 });
    }
  },

  optimisticBranchCreated: (branch) =>
    set((state) => ({
      branches: [...state.branches, branch],
      currentBranchId: branch.id,
      isPlaying: false,
    })),

  clearWorkspace: () =>
    set({
      isPlaying: false,
      currentFrame: 0,
      totalFrames: 0,
      durationSeconds: null,
      currentBranchId: null,
      branches: [],
      events: [],
      currentState: null,
      selectedEventId: null,
      selectedActivityId: null,
      activityContextState: null,
    }),

  reset: () =>
    set({
      isPlaying: false,
      currentFrame: 0,
      selectedEventId: null,
      selectedActivityId: null,
      activityContextState: null,
    }),
}));
