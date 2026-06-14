'use client';

import { useMemo } from 'react';
import type { RuntimeSummary } from '@agentlens/protocol';
import { projectRuntimeSummary } from '@agentlens/protocol';
import { useReplayStore } from '@/stores/replayStore';
import { useGraphStore } from '@/stores/graphStore';

interface UseRuntimeSummaryOptions {
  missionId: string;
  objective?: string;
  missionStatus?: string;
  missionPhase?: string;
  serverSummary?: RuntimeSummary | null;
}

export function useRuntimeSummary({
  missionId,
  objective = 'Mission overview',
  missionStatus = 'active',
  missionPhase = 'executing',
  serverSummary = null,
}: UseRuntimeSummaryOptions): RuntimeSummary | null {
  const { events, currentFrame, currentBranchId } = useReplayStore();
  const snapshots = useGraphStore((state) => state.snapshots);
  const frameSequenceNum = snapshots[currentFrame]?.sequence_num;

  const clientSummary = useMemo(() => {
    if (!events.length) return null;
    return projectRuntimeSummary({
      mission_id: missionId,
      branch_id: currentBranchId ?? 'main',
      objective,
      status: missionStatus,
      phase: missionPhase,
      events,
      up_to_sequence_num: frameSequenceNum,
    });
  }, [events, missionId, currentBranchId, objective, missionStatus, missionPhase, frameSequenceNum]);

  return useMemo(() => {
    if (!clientSummary) return serverSummary;
    if (!serverSummary) return clientSummary;
    if (serverSummary.sequence_num >= clientSummary.sequence_num) return serverSummary;
    return clientSummary;
  }, [clientSummary, serverSummary]);
}
