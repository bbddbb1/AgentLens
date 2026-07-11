export type NormalizedActivityKind = 'agent' | 'llm' | 'tool' | 'retrieval' | 'interrupt' | 'unknown';
export type NormalizedLifecycle = 'started' | 'completed' | 'failed' | 'unknown';
export type NormalizedOutcome = 'success' | 'failure' | 'unknown';

export interface SourceReference {
  trace_id?: string;
  span_id?: string;
  event_name?: string;
  /** Stable 0-based index within the source span's events array when applicable. */
  event_index?: number;
  attribute_keys: string[];
  translator: 'otel-genai' | 'agentlens-compat' | 'langgraph';
}

export interface NativeRuntimeIdentity {
  framework?: string;
  thread_id?: string;
  run_id?: string;
  parent_run_id?: string;
  interrupt_request_id?: string;
  resume_of_interrupt_id?: string;
  checkpoint_id?: string;
  checkpoint_ns?: string;
  activity_correlation_id?: string;
  native_execution_key?: string;
}

export interface NormalizedRelationship {
  kind: 'handoff' | 'parent_child';
  source_activity_id: string;
  target_activity_id?: string;
  target_reference?: string;
  resolution: 'resolved' | 'unresolved';
  source: SourceReference;
}

export type NormalizationDiagnosticCode =
  | 'unknown_telemetry'
  | 'unresolved_relationship'
  | 'conflicting_outcome'
  | 'conflicting_native_identity';

export interface NormalizationDiagnostics {
  code: NormalizationDiagnosticCode;
  message: string;
  source?: SourceReference;
  /** Second source when two explicit native-identity values conflict. */
  conflicting_source?: SourceReference;
  /** Native identity field that conflicted, when applicable. */
  field?: keyof NativeRuntimeIdentity;
  /**
   * Machine-checkable ambiguity for governance gating.
   * True when conflicting explicit native-identity values were observed.
   */
  ambiguous_native_identity?: boolean;
}

/** True when diagnostics include an unresolved native-identity conflict. */
export function hasAmbiguousNativeIdentity(
  diagnostics: ReadonlyArray<Pick<NormalizationDiagnostics, 'ambiguous_native_identity' | 'code'>>,
): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.ambiguous_native_identity === true
      || diagnostic.code === 'conflicting_native_identity',
  );
}

export interface NormalizedActivity {
  id: string;
  kind: NormalizedActivityKind;
  lifecycle: NormalizedLifecycle;
  outcome: NormalizedOutcome;
  span_id?: string;
  trace_id?: string;
  operation_name?: string;
  correlation: {
    parent_span_id?: string;
    activity_correlation_id?: string;
    run_id?: string;
  };
  native_runtime_identity?: NativeRuntimeIdentity;
  token_usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  source_references: SourceReference[];
}

export interface NormalizedRuntimeFacts {
  activities: NormalizedActivity[];
  relationships: NormalizedRelationship[];
  diagnostics: NormalizationDiagnostics[];
}
