import type { NormalizedLifecycle, NormalizedOutcome } from './types.js';

export function outcomeFromOtel(span: any): NormalizedOutcome {
  if (span?.status_code === 'ERROR') return 'failure';
  if (span?.status_code === 'OK') return 'success';
  return 'unknown';
}

export function lifecycleFromOtel(span: any): NormalizedLifecycle {
  if (outcomeFromOtel(span) === 'failure') return 'failed';
  const end = span?.end_time_unix_nano;
  if (end !== undefined && end !== null && /^\d+$/.test(String(end)) && BigInt(String(end)) > 0n) {
    return 'completed';
  }
  return 'started';
}

/**
 * Derive outcome for a span event without inheriting parent-span OK/success.
 * Explicit failure dominates; start/active-only evidence stays unknown.
 */
export function outcomeFromEventAttrs(eventName: string | undefined, attrs: Record<string, any>): NormalizedOutcome {
  const toolStatus = attrs['gen_ai.tool.status'];
  if (
    toolStatus === 'error'
    || toolStatus === 'failed'
    || eventName === 'gen_ai.error'
    || eventName?.endsWith('.failed')
    || eventName?.endsWith('.error')
  ) return 'failure';
  if (toolStatus === 'success') return 'success';
  if (toolStatus === 'active') return 'unknown';
  if (eventName === 'gen_ai.call') {
    // Terminal LLM observation when usage/completion is recorded; start-only stays unknown.
    if (
      attrs['gen_ai.usage.input_tokens'] !== undefined
      || attrs['gen_ai.usage.output_tokens'] !== undefined
      || attrs['gen_ai.completion'] !== undefined
    ) {
      return 'success';
    }
    return 'unknown';
  }
  if (eventName === 'agent.interrupt.requested' || eventName === 'agent.interrupt.resumed') {
    return 'unknown';
  }
  return 'unknown';
}

export function lifecycleFromEventAttrs(eventName: string | undefined, attrs: Record<string, any>): NormalizedLifecycle {
  const outcome = outcomeFromEventAttrs(eventName, attrs);
  if (outcome === 'failure') return 'failed';
  if (outcome === 'success') return 'completed';
  if (attrs['gen_ai.tool.status'] === 'active') return 'started';
  if (attrs['gen_ai.tool.status'] === 'completed') return 'completed';
  if (eventName === 'gen_ai.call') return 'started';
  if (eventName === 'agent.interrupt.resumed') return 'completed';
  if (
    eventName?.endsWith('.completed')
    || eventName?.endsWith('.result')
    || eventName === 'memory.written'
    || eventName === 'memory.read'
    || eventName === 'agent.memory.write'
    || eventName === 'artifact.created'
    || eventName === 'artifact.updated'
  ) return 'completed';
  return 'started';
}

export function genAiModel(attrs: Record<string, any>): string | undefined {
  const value = attrs['gen_ai.request.model'] ?? attrs['gen_ai.model.name'];
  return value === undefined || value === null ? undefined : String(value);
}

export function genAiTokenUsage(attrs: Record<string, any>): { input_tokens?: number; output_tokens?: number } | undefined {
  const input = attrs['gen_ai.usage.input_tokens'];
  const output = attrs['gen_ai.usage.output_tokens'];
  if (input === undefined && output === undefined) return undefined;
  return {
    input_tokens: input === undefined ? undefined : Number(input),
    output_tokens: output === undefined ? undefined : Number(output),
  };
}

export function genAiToolName(attrs: Record<string, any>): string | undefined {
  const value = attrs['gen_ai.tool.name'];
  return value === undefined || value === null ? undefined : String(value);
}

export function assembleModelProvenance(attrs: Record<string, any>): any {
  const structured = parseJson(attrs['agentlens.model'] ?? attrs.model);
  if (structured && typeof structured === 'object') return structured;

  const out: Record<string, any> = {};
  const provider = attrs['gen_ai.system'];
  const modelName = genAiModel(attrs);
  const modelVersion = attrs['gen_ai.model.version'];
  const tokens = genAiTokenUsage(attrs);
  const temperature = attrs['gen_ai.request.temperature'];
  const stopReason = attrs['gen_ai.response.finish_reason'];
  if (provider !== undefined) out.provider = String(provider);
  if (modelName !== undefined) out.model_name = modelName;
  if (modelVersion !== undefined) out.model_version = String(modelVersion);
  if (tokens?.input_tokens !== undefined) out.tokens_input = tokens.input_tokens;
  if (tokens?.output_tokens !== undefined) out.tokens_output = tokens.output_tokens;
  if (temperature !== undefined) out.temperature = Number(temperature);
  if (stopReason !== undefined) out.stop_reason = String(stopReason);
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseJson(value: any): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
