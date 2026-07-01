'use client';

import type { RuntimeExplanationProjection } from '@agentlens/protocol';

interface UseRuntimeExplanationOptions {
  serverExplanation?: RuntimeExplanationProjection | null;
}

export function useRuntimeExplanation({
  serverExplanation = null,
}: UseRuntimeExplanationOptions): RuntimeExplanationProjection | null {
  return serverExplanation;
}
