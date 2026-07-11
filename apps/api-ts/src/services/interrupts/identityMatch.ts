/**
 * Exact identity matching between an observed LangGraph interrupt and a private bridge binding.
 * Observational identifiers (including native_execution_key) are never match credentials.
 */

export type IdentityMatchResult =
  | { status: 'match'; required: Record<string, string>; consistency: Record<string, string> }
  | { status: 'missing_required'; field: string }
  | { status: 'conflict'; field: string; left: string; right: string; diagnostic: string }
  | { status: 'partial'; missingOptional: string[] };

export type GovernanceIdentityField =
  | 'mission_id'
  | 'branch_id'
  | 'framework'
  | 'interaction_request_id'
  | 'thread_id'
  | 'run_id'
  | 'parent_run_id'
  | 'checkpoint_id'
  | 'checkpoint_ns'
  | 'activity_correlation_id'
  | 'workflow_id'
  | 'executor_id'
  | 'request_id'
  | 'request_type'
  | 'response_type';

export interface GovernanceIdentitySide {
  mission_id?: string;
  branch_id?: string;
  framework?: string;
  interaction_request_id?: string;
  /** Alias accepted for interaction_request_id. */
  interrupt_request_id?: string;
  thread_id?: string;
  run_id?: string;
  parent_run_id?: string;
  checkpoint_id?: string;
  checkpoint_ns?: string;
  activity_correlation_id?: string;
  /** Observational only — never used for matching. */
  native_execution_key?: string;
  workflow_id?: string;
  executor_id?: string;
  request_id?: string;
  request_type?: string;
  response_type?: string;
}

export interface GovernanceIdentityPolicy {
  expectedFramework: 'langgraph' | 'ms_agent_framework';
  required: GovernanceIdentityField[];
  consistency: GovernanceIdentityField[];
}

export const LANGGRAPH_IDENTITY_POLICY: GovernanceIdentityPolicy = {
  expectedFramework: 'langgraph',
  required: ['mission_id', 'branch_id', 'framework', 'interaction_request_id', 'thread_id'],
  consistency: ['run_id', 'parent_run_id', 'checkpoint_id', 'checkpoint_ns', 'activity_correlation_id'],
};

export const MAF_IDENTITY_POLICY: GovernanceIdentityPolicy = {
  expectedFramework: 'ms_agent_framework',
  required: ['mission_id', 'branch_id', 'framework', 'workflow_id', 'request_id'],
  consistency: ['executor_id', 'request_type', 'response_type', 'activity_correlation_id'],
};

export interface MatchOptions {
  policy?: GovernanceIdentityPolicy;
  /** Legacy LangGraph-only compatibility option. */
  requireThreadId?: boolean;
}

function normalize(side: GovernanceIdentitySide): Record<string, string | undefined> {
  return {
    mission_id: side.mission_id,
    branch_id: side.branch_id,
    framework: side.framework,
    interaction_request_id: side.interaction_request_id ?? side.interrupt_request_id,
    thread_id: side.thread_id,
    run_id: side.run_id,
    parent_run_id: side.parent_run_id,
    checkpoint_id: side.checkpoint_id,
    checkpoint_ns: side.checkpoint_ns,
    activity_correlation_id: side.activity_correlation_id,
    workflow_id: side.workflow_id,
    executor_id: side.executor_id,
    request_id: side.request_id,
    request_type: side.request_type,
    response_type: side.response_type,
  };
}

/**
 * Deterministic exact identity match. Does not use names, timing, topology,
 * fuzzy inference, or native_execution_key.
 */
export function matchGovernanceIdentity(
  observed: GovernanceIdentitySide,
  binding: GovernanceIdentitySide,
  options: MatchOptions = {},
): IdentityMatchResult {
  const left = normalize(observed);
  const right = normalize(binding);
  const policy = options.policy ?? (options.requireThreadId === false
    ? { ...LANGGRAPH_IDENTITY_POLICY, required: LANGGRAPH_IDENTITY_POLICY.required.filter((field) => field !== 'thread_id') }
    : LANGGRAPH_IDENTITY_POLICY);
  const required = policy.required;

  for (const field of required) {
    const a = left[field];
    const b = right[field];
    if (!a || !b) {
      return { status: 'missing_required', field };
    }
    if (a !== b) {
      return {
        status: 'conflict',
        field,
        left: a,
        right: b,
        diagnostic: `identity_conflict:${field}:${a}!=${b}`,
      };
    }
  }

  if ((left.framework ?? right.framework) !== policy.expectedFramework) {
    return { status: 'missing_required', field: 'framework' };
  }

  const consistencyFields = policy.consistency;
  const missingOptional: string[] = [];
  const consistency: Record<string, string> = {};

  for (const field of consistencyFields) {
    const a = left[field];
    const b = right[field];
    if (a && b && a !== b) {
      return {
        status: 'conflict',
        field,
        left: a,
        right: b,
        diagnostic: `identity_conflict:${field}:${a}!=${b}`,
      };
    }
    if ((a && !b) || (!a && b)) {
      missingOptional.push(field);
      if (a) consistency[field] = a;
      if (b) consistency[field] = b;
      continue;
    }
    if (a && b) consistency[field] = a;
  }

  const requiredValues: Record<string, string> = {};
  for (const field of required) {
    requiredValues[field] = left[field]!;
  }

  if (missingOptional.length > 0) {
    return { status: 'partial', missingOptional };
  }

  return { status: 'match', required: requiredValues, consistency };
}
