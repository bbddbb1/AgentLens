'use client';

import { useCallback, useMemo, useState } from 'react';
import type { MissionEventRecord, RuntimeNodeProjection } from '@agentlens/protocol';
import { getRuntimeNodeProjection } from '@agentlens/protocol';
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
  events: _events,
  runtimeSummary,
  serverProjection = null,
}: UseNodeProjectionOptions) {
  const [enhancedProjection, setEnhancedProjection] = useState<RuntimeNodeProjection | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);

  const summaryProjection = useMemo(() => {
    if (!agentId || !runtimeSummary) return null;
    return getRuntimeNodeProjection(runtimeSummary, agentId) ?? null;
  }, [agentId, runtimeSummary]);

  const projection = enhancedProjection
    ?? serverProjection
    ?? summaryProjection;

  const [prevKey, setPrevKey] = useState<string | null>(null);
  const currentKey = `${agentId}-${sequenceNum}-${branchId}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setEnhancedProjection(null);
  }

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
    isEnhancing,
    enhance,
  };
}
