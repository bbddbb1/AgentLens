/**
 * Replay store - manages branch-aware replay playback and runtime state.
 */

import { create } from 'zustand';
import type { MissionEventRecord, ReplayBranch, ReplayStateResponse, RuntimeState } from '@agentlens/protocol';

interface ReplayStore {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  playbackSpeed: number;
  durationSeconds: number | null;
  currentBranchId: string | null;
  branches: ReplayBranch[];
  events: MissionEventRecord[];
  currentState: RuntimeState | null;
  selectedEventId: string | null;

  setIsPlaying: (playing: boolean) => void;
  setCurrentFrame: (frame: number) => void;
  setTotalFrames: (total: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setDuration: (seconds: number | null) => void;
  setCurrentBranchId: (branchId: string | null) => void;
  setSelectedEventId: (eventId: string | null) => void;
  setReplayData: (data: Pick<ReplayStateResponse, 'branch_id' | 'branches' | 'events' | 'total_frames' | 'duration_seconds' | 'current_state'>) => void;
  nextFrame: () => void;
  prevFrame: () => void;
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

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentFrame: (currentFrame) => {
    const safeFrame = Math.max(0, Math.min(currentFrame, Math.max(get().totalFrames - 1, 0)));
    const event = get().events[safeFrame];
    set({
      currentFrame: safeFrame,
      selectedEventId: event?.id ?? null,
    });
  },
  setTotalFrames: (totalFrames) => set({ totalFrames }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setDuration: (durationSeconds) => set({ durationSeconds }),
  setCurrentBranchId: (currentBranchId) => set({ currentBranchId }),
  setSelectedEventId: (selectedEventId) => {
    const eventIndex = get().events.findIndex((event) => event.id === selectedEventId);
    set({
      selectedEventId,
      currentFrame: eventIndex >= 0 ? eventIndex : get().currentFrame,
    });
  },
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
        selectedEventId: data.events[nextFrame]?.id ?? data.events[data.events.length - 1]?.id ?? null,
      };
    }),

  nextFrame: () => {
    const { currentFrame, totalFrames, events } = get();
    if (currentFrame < totalFrames - 1) {
      const nextFrame = currentFrame + 1;
      set({ currentFrame: nextFrame, selectedEventId: events[nextFrame]?.id ?? null });
    } else {
      set({ isPlaying: false });
    }
  },

  prevFrame: () => {
    const { currentFrame, events } = get();
    if (currentFrame > 0) {
      const prevFrame = currentFrame - 1;
      set({ currentFrame: prevFrame, selectedEventId: events[prevFrame]?.id ?? null });
    }
  },

  reset: () =>
    set((state) => ({
      isPlaying: false,
      currentFrame: 0,
      selectedEventId: state.events[0]?.id ?? null,
    })),
}));
