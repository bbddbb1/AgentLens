'use client';

import { useEffect, useRef } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';

const speedOptions = [0.5, 1, 2, 4];

function formatDuration(secondsLike: number): string {
  const safeSeconds = Number.isFinite(secondsLike) ? Math.max(0, secondsLike) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function timestampDeltaSeconds(start: string | undefined, end: string | undefined): number {
  if (!start || !end) return 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, (endMs - startMs) / 1000);
}

export function replayFramePresentation(totalFrames: number, currentFrame: number) {
  const hasFrames = totalFrames > 0;
  const canPlay = totalFrames > 1;
  const safeFrame = hasFrames ? Math.min(Math.max(currentFrame, 0), totalFrames - 1) : 0;
  return {
    hasFrames,
    canPlay,
    progress: canPlay ? (safeFrame / (totalFrames - 1)) * 100 : 0,
    frameLabel: hasFrames ? `${safeFrame + 1}/${totalFrames}` : '0/0',
  };
}

export function ReplayControls() {
  const { isPlaying, currentFrame, totalFrames, playbackSpeed, setIsPlaying, setCurrentFrame, setPlaybackSpeed, nextFrame, prevFrame, reset } = useReplayStore();
  const snapshots = useGraphStore((state) => state.snapshots);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { hasFrames, canPlay, progress, frameLabel } = replayFramePresentation(totalFrames, currentFrame);

  useEffect(() => {
    if (isPlaying && canPlay) {
      intervalRef.current = setInterval(nextFrame, 1000 / playbackSpeed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [canPlay, isPlaying, nextFrame, playbackSpeed]);

  const firstTimestamp = snapshots[0]?.timestamp;
  const currentTimestamp = snapshots[currentFrame]?.timestamp;
  const lastTimestamp = snapshots[snapshots.length - 1]?.timestamp;
  const elapsedSeconds = timestampDeltaSeconds(firstTimestamp, currentTimestamp);
  const totalSeconds = timestampDeltaSeconds(firstTimestamp, lastTimestamp);

  return (
    <div className="flex w-full items-center gap-3" aria-label="Replay controls">
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={reset} disabled={!hasFrames || currentFrame === 0} aria-label="Reset replay to first frame" className="rounded-sm p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35">
          <RotateCcw size={14} />
        </button>
        <button type="button" onClick={prevFrame} disabled={!hasFrames || currentFrame === 0} aria-label="Previous replay frame" className="rounded-sm p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35">
          <SkipBack size={14} />
        </button>
        <button type="button" onClick={() => setIsPlaying(!isPlaying)} disabled={!canPlay} aria-label={isPlaying ? 'Pause replay' : 'Play replay'} className="rounded-sm border border-border-default bg-accent-soft p-2 text-accent-strong hover:border-border-strong hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-35">
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" onClick={nextFrame} disabled={!hasFrames || currentFrame >= totalFrames - 1} aria-label="Next replay frame" className="rounded-sm p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35">
          <SkipForward size={14} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="hidden w-10 text-right font-mono text-[10px] tabular-nums text-text-muted sm:block">{formatDuration(elapsedSeconds)}</span>
        <label className="relative flex min-w-24 flex-1 items-center" title={`Replay position: ${progress.toFixed(0)}%`}>
          <span className="sr-only">Replay frame</span>
          <input type="range" min={0} max={Math.max(totalFrames - 1, 0)} value={hasFrames ? Math.min(currentFrame, totalFrames - 1) : 0} onChange={(event) => setCurrentFrame(Number(event.target.value))} disabled={!canPlay} aria-label="Replay frame" aria-valuetext={`Frame ${frameLabel}`} className="h-1.5 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40" />
        </label>
        <span className="hidden w-10 font-mono text-[10px] tabular-nums text-text-muted md:block">{formatDuration(totalSeconds)}</span>
      </div>

      <div className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary" aria-label={`Frame ${frameLabel}`}>
        <span className="hidden text-text-muted sm:inline">Frame </span>
        {frameLabel}
      </div>

      <label className="hidden shrink-0 items-center gap-1.5 text-[11px] text-text-muted sm:flex">
        Speed
        <select aria-label="Replay speed" value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))} disabled={!canPlay} className="rounded-sm border border-border-default bg-bg-secondary px-1.5 py-1 text-[11px] text-text-primary disabled:cursor-not-allowed disabled:opacity-40">
          {speedOptions.map((speed) => (
            <option key={speed} value={speed}>
              {speed}x
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
