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

export interface NormalizationDiagnostics {
  code: 'unknown_telemetry' | 'unresolved_relationship' | 'conflicting_outcome';
  message: string;
  source?: SourceReference;
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
