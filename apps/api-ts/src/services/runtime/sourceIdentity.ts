/**
 * Internal L0 identity helpers. Source-local identifiers are never authoritative
 * without the recorded execution scope that issued them.
 */
export interface SourceSpanIdentity {
  branch_id?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
}

function component(value: unknown): string {
  const text = String(value ?? '');
  return `${text.length}:${text}`;
}

export function sourceTraceKey(source: Pick<SourceSpanIdentity, 'branch_id' | 'trace_id'>): string {
  return `${component(source.branch_id ?? 'main')}|${component(source.trace_id)}`;
}

export function sourceSpanKey(source: SourceSpanIdentity): string {
  return `${sourceTraceKey(source)}|${component(source.span_id)}`;
}

export function scopedInvocationActivityId(
  kind: string,
  invocationId: string,
  source: Pick<SourceSpanIdentity, 'branch_id' | 'trace_id'>,
): string {
  return `${kind}:invocation:${sourceTraceKey(source)}|${component(invocationId)}`;
}

export function scopedSpanFallbackActivityId(kind: string, source: SourceSpanIdentity): string {
  return `${kind}:span:${sourceSpanKey(source)}`;
}
