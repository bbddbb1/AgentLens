'use client';

import type { RuntimeSummary } from '@agentlens/protocol';

interface UseRuntimeSummaryOptions {
  serverSummary?: RuntimeSummary | null;
}

export function useRuntimeSummary({
  serverSummary = null,
}: UseRuntimeSummaryOptions): RuntimeSummary | null {
  return serverSummary;
}
