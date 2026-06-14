'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MissionEventRecord, RuntimeNodeProjection } from '@agentlens/protocol';
import { getRuntimeNodeProjection, projectNodeState } from '@agentlens/protocol';
import { api } from '@/lib/api';
import type { RuntimeSummary } from '@agentlens/protocol';

interface UseNodeProjectionOptions {
  missionId: string;
  agentId: string | null;
  branchId?: string;
  sequenceNum?: number;
  events: MissionEventRecord[];
  runtimeSummary?: RuntimeSummary | null;
  serverProjection?: RuntimeNodeProjection | null;
}

export function useNodeProjection({
  missionId,
  agentId,
  branchId,
  sequenceNum,
  events,
  runtimeSummary,
  serverProjection = null,
}: UseNodeProjectionOptions) {
  const [enhancedProjection, setEnhancedProjection] = useState<RuntimeNodeProjection | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);

  const clientProjection = useMemo(() => {
    if (!agentId || events.length === 0) return null;

    return projectNodeState({
      mission_id: missionId,
      branch_id: branchId ?? 'main',
      agent_id: agentId,
      events,
      up_to_sequence_num: sequenceNum,
    });
  }, [agentId, branchId, events, missionId, sequenceNum]);

  const summaryProjection = useMemo(() => {
    if (!agentId || !runtimeSummary) return null;
    return getRuntimeNodeProjection(runtimeSummary, agentId) ?? null;
  }, [agentId, runtimeSummary]);

  const projection = enhancedProjection
    ?? serverProjection
    ?? summaryProjection
    ?? clientProjection;

  useEffect(() => {
    setEnhancedProjection(null);
  }, [agentId, sequenceNum, branchId]);

  const enhance = useCallback(async () => {
    if (!agentId || missionId === 'demo-mission') return null;
    setIsEnhancing(true);
    try {
      const result = await api.nodeProjection.enhance(missionId, agentId, {
        branchId,
        sequenceNum,
      });
      setEnhancedProjection(result);
      return result;
    } finally {
      setIsEnhancing(false);
    }
  }, [agentId, branchId, missionId, sequenceNum]);

  return {
    projection,
    clientProjection,
    isEnhancing,
    enhance,
  };
}
