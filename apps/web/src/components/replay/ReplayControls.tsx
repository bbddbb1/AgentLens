'use client';

/**
 * ReplayControls — Play/pause/seek/speed controls for mission replay.
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward,
  RotateCcw, GitBranch,
} from 'lucide-react';
import { useReplayStore } from '@/stores/replayStore';
import { useGraphStore } from '@/stores/graphStore';

const speedOptions = [0.5, 1, 2, 4];

export function ReplayControls() {
  const {
    isPlaying, currentFrame, totalFrames, playbackSpeed, currentBranchId,
    setIsPlaying, setCurrentFrame, setPlaybackSpeed,
    nextFrame, prevFrame, reset,
  } = useReplayStore();

  const { snapshots, applySnapshot } = useGraphStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-advance frames when playing
  useEffect(() => {
    if (isPlaying && totalFrames > 0) {
      intervalRef.current = setInterval(() => {
        nextFrame();
      }, 1000 / playbackSpeed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, totalFrames, nextFrame]);

  // Apply snapshot when frame changes
  useEffect(() => {
    if (snapshots.length > 0 && currentFrame < snapshots.length) {
      applySnapshot(snapshots[currentFrame]);
    }
  }, [currentFrame, snapshots, applySnapshot]);

  const progress = totalFrames > 0 ? (currentFrame / (totalFrames - 1)) * 100 : 0;

  const formatTime = (secondsLike: number) => {
    const mins = Math.floor(secondsLike / 60);
    const secs = Math.floor(secondsLike % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const frameTimestamp = snapshots[currentFrame]?.timestamp;
  const elapsedSeconds =
    snapshots.length > 1
      ? (new Date(frameTimestamp ?? snapshots[0]?.timestamp ?? 0).getTime() - new Date(snapshots[0]?.timestamp ?? 0).getTime()) / 1000
      : currentFrame;
  const totalSeconds =
    snapshots.length > 1
      ? (new Date(snapshots[snapshots.length - 1]?.timestamp ?? 0).getTime() - new Date(snapshots[0]?.timestamp ?? 0).getTime()) / 1000
      : totalFrames;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 glass rounded-xl">
      {/* Transport controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={reset}
          className="p-1.5 rounded-lg text-[#5d6180] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={prevFrame}
          disabled={currentFrame === 0}
          className="p-1.5 rounded-lg text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)] transition-colors disabled:opacity-30"
          title="Previous frame"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-2 rounded-xl bg-[#6366f1] text-white hover:bg-[#5558e6] transition-colors shadow-lg shadow-[#6366f1]/20"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={nextFrame}
          disabled={currentFrame >= totalFrames - 1}
          className="p-1.5 rounded-lg text-[#9498b0] hover:text-[#e8eaf0] hover:bg-[rgba(255,255,255,0.05)] transition-colors disabled:opacity-30"
          title="Next frame"
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Timeline scrubber */}
      <div className="flex-1 flex items-center gap-3">
        <span className="text-[11px] text-[#5d6180] font-mono tabular-nums w-10 text-right">
          {formatTime(elapsedSeconds)}
        </span>
        <div className="flex-1 relative group">
          <div className="h-1 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
              style={{ width: `${progress}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(totalFrames - 1, 0)}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(parseInt(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          {/* Thumb indicator */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#6366f1] border-2 border-[#1a1b25] shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>
        <span className="text-[11px] text-[#5d6180] font-mono tabular-nums w-10">
          {formatTime(totalSeconds)}
        </span>
      </div>

      {/* Speed controls */}
      <div className="flex items-center gap-1 ml-2">
        {speedOptions.map((speed) => (
          <button
            key={speed}
            onClick={() => setPlaybackSpeed(speed)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
              playbackSpeed === speed
                ? 'bg-[#6366f1]/20 text-[#818cf8]'
                : 'text-[#5d6180] hover:text-[#9498b0]'
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>

      {/* Frame counter */}
      <div className="text-[10px] text-[#5d6180] font-mono ml-2">
        {currentFrame + 1}/{totalFrames}
      </div>

      <div className="hidden md:flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[10px] text-[#8f95b2]">
        <GitBranch size={11} className="text-[#67e8f9]" />
        <span>{currentBranchId ?? 'main'}</span>
      </div>
    </div>
  );
}
