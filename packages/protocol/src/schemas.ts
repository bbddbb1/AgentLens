import { z } from 'zod';
import { AgentEvents } from './semconv.js';

export const AttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

export const AttributeMapSchema = z.record(z.string(), AttributeValueSchema);

export const OtelEventSchema = z.object({
  name: z.string().optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
  attributes: AttributeMapSchema.optional().default({}),
});

export const OtlpSpanSchema = z.object({
  trace_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_span_id: z.string().min(1).nullable().optional(),
  operation_name: z.string().min(1),
  start_time_unix_nano: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  end_time_unix_nano: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  status_code: z.string().default('OK'),
  attributes: AttributeMapSchema.optional().default({}),
  events: z.array(OtelEventSchema).optional().default([]),
});

export const OtlpIngestRequestSchema = z.object({
  mission_id: z.string().optional(),
  branch_id: z.string().min(1).optional(),
  resource_attributes: AttributeMapSchema.optional().default({}),
  spans: z.array(OtlpSpanSchema).min(1),
  batch_id: z.string().optional(),
});

export const MissionStatusSchema = z.enum(['active', 'paused', 'completed', 'failed', 'cancelled']);
export const MissionPhaseSchema = z.enum(['planning', 'executing', 'reviewing', 'waiting_for_human', 'completed', 'failed']);

export const CreateMissionSchema = z.object({
  objective: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  is_encrypted: z.boolean().optional(),
});

export const UpdateMissionSchema = z.object({
  status: MissionStatusSchema.optional(),
  phase: MissionPhaseSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MissionEventEnvelopeSchema = z.object({
  type: z.string().min(1),
  mission_id: z.string().min(1),
  sequence: z.number().int().nonnegative().optional(),
  timestamp: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const ReviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'changes_requested', 'rejected']).optional().default('pending'),
  body: z.string().optional(),
});

export const CommentSchema = z.object({
  body: z.string().min(1),
  review_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
  target_type: z.enum(['node', 'edge', 'region', 'span', 'interrupt']).optional(),
  target_id: z.string().optional(),
  target_context: z.record(z.string(), z.unknown()).optional(),
});

export const ShareSchema = z.object({
  user_email: z.string().email(),
  permission: z.enum(['viewer', 'reviewer', 'admin']).optional().default('viewer'),
  encrypted_key: z.string().min(1),
});

export const InterruptStatusSchema = z.enum(['pending', 'approved', 'rejected', 'resumed', 'expired', 'cancelled']);
export const HumanDecisionSchema = z.enum(['approve', 'reject', 'revise', 'resume']);

export const CreateInterruptSchema = z.object({
  mission_id: z.string().uuid(),
  interrupt_id: z.string().min(1).optional(),
  agent_id: z.string().optional(),
  span_id: z.string().optional(),
  reason: z.string().min(1),
  resume_url: z.string().url().optional(),
  resume_token: z.string().min(16).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  expires_at: z.string().datetime().optional(),
});

export const DecideInterruptSchema = z.object({
  decision: HumanDecisionSchema,
  comment: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().min(1),
});

export const ResumeInterruptSchema = z.object({
  resume_token: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const CreateReplayBranchSchema = z.object({
  name: z.string().min(1).optional(),
  source_branch_id: z.string().min(1).optional(),
  forked_from_sequence_num: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const BranchCapabilitySchema = z.object({
  is_branchable: z.boolean(),
  reason: z.string().optional(),
});

export const BranchPointKindSchema = z.enum(['hitl', 'routing', 'pre_tool', 'post_tool', 'review_divergence', 'other']);

export const BranchExecutorSpecSchema = z.object({
  id: z.string().uuid(),
  mission_id: z.string().min(1),
  name: z.string().min(1),
  docker_image: z.string().min(1),
  python_entrypoint: z.string().min(1),
  timeout_seconds: z.number().int().positive().default(300),
  resource_limits: z.object({
    cpu: z.string().optional(),
    memory: z.string().optional(),
    pids: z.number().int().optional(),
  }).optional(),
  env_allowlist: z.array(z.string()).optional(),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
});

export const BranchSandboxJobSchema = z.object({
  id: z.string().uuid(),
  branch_id: z.string().min(1),
  mission_id: z.string().min(1),
  executor_id: z.string().uuid(),
  status: z.enum(['queued', 'starting', 'running', 'completed', 'completed_no_events', 'failed', 'timeout', 'cancelled', 'abandoned']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  container_id: z.string().optional(),
  exit_code: z.number().optional(),
});

export const BranchSandboxLogSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  stream: z.enum(['stdout', 'stderr']),
  message: z.string(),
});

export const BranchContextSchema = z.object({
  mission_id: z.string().min(1),
  branch_id: z.string().min(1),
  source_branch_id: z.string().min(1),
  forked_from_sequence_num: z.number().int().nonnegative(),
  branch_point_kind: z.string().optional(),
  source_event: z.record(z.string(), z.unknown()).optional(),
  fork_snapshot: z.record(z.string(), z.unknown()).optional(),
  runtime_state_at_fork: z.record(z.string(), z.unknown()).optional(),
  events_until_fork: z.array(z.record(z.string(), z.unknown())).optional(),
  selected_node_id: z.string().optional(),
  selected_event_id: z.string().optional(),
  user_instructions: z.string().optional(),
  tool_policy: z.string().default('mock'),
});

export const CreateBranchResponseSchema = z.object({
  branch: z.record(z.string(), z.unknown()),
  job: BranchSandboxJobSchema,
});

export const KnownAgentEventNames = new Set<string>(Object.values(AgentEvents));

// ─── EventEnvelope Schemas ───

export const ActorTypeSchema = z.enum(['agent', 'tool', 'human', 'system', 'policy']);
export const ErrorSourceSchema = z.enum(['model', 'tool', 'human', 'policy', 'system']);
export const ErrorCauseSchema = z.enum([
  'hallucination', 'prompt_injection', 'tool_failure',
  'timeout', 'permission_denied', 'validation_error', 'unknown',
]);
export const ErrorSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const PolicyDecisionTypeSchema = z.enum(['allow', 'deny', 'require_review', 'redact']);

export const CausalContextSchema = z.object({
  parent_span_id: z.string().optional(),
  tool_call_id: z.string().optional(),
  decision_for_event_id: z.string().optional(),
  triggered_by_event_id: z.string().optional(),
}).optional();

export const ModelProvenanceSchema = z.object({
  provider: z.string().optional(),
  model_name: z.string().optional(),
  model_version: z.string().optional(),
  tokens_input: z.number().int().nonnegative().optional(),
  tokens_output: z.number().int().nonnegative().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stop_reason: z.string().optional(),
}).optional();

export const ErrorAttributionSchema = z.object({
  source: ErrorSourceSchema.optional(),
  cause: ErrorCauseSchema.optional(),
  severity: ErrorSeveritySchema.optional(),
  recovery_action: z.string().optional(),
  original_error: z.string().optional(),
}).optional();

export const PolicyDecisionSchema = z.object({
  rule_id: z.string().optional(),
  decision: PolicyDecisionTypeSchema.optional(),
  reason: z.string().optional(),
}).optional();

export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  mission_id: z.string().min(1),
  branch_id: z.string().min(1),
  sequence_num: z.number().int().nonnegative(),
  branch_sequence_num: z.number().int().nonnegative(),
  event_type: z.string().min(1),
  timestamp: z.string(),
  agent_id: z.string().optional(),
  span_id: z.string().optional(),
  trace_id: z.string().optional(),
  parent_span_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // EventEnvelope extensions
  actor_type: ActorTypeSchema.optional(),
  actor_id: z.string().optional(),
  causal: CausalContextSchema,
  origin_framework: z.string().optional(),
  model: ModelProvenanceSchema,
  error: ErrorAttributionSchema,
  policy: PolicyDecisionSchema,
  content_hash: z.string().optional(),
  previous_hash: z.string().optional(),
});

export type AttributeValue = z.infer<typeof AttributeValueSchema>;
export type AttributeMap = z.infer<typeof AttributeMapSchema>;
export type OtelEvent = z.infer<typeof OtelEventSchema>;
export type OtlpSpan = z.infer<typeof OtlpSpanSchema>;
export type OtlpIngestRequest = z.infer<typeof OtlpIngestRequestSchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type MissionPhase = z.infer<typeof MissionPhaseSchema>;
export type CreateMissionInput = z.infer<typeof CreateMissionSchema>;
export type UpdateMissionInput = z.infer<typeof UpdateMissionSchema>;
export type MissionEventEnvelope = z.infer<typeof MissionEventEnvelopeSchema>;
export type CreateInterruptInput = z.infer<typeof CreateInterruptSchema>;
export type DecideInterruptInput = z.infer<typeof DecideInterruptSchema>;
export type ResumeInterruptInput = z.infer<typeof ResumeInterruptSchema>;
export type CreateReplayBranchInput = z.infer<typeof CreateReplayBranchSchema>;
export type PolicyDecisionType = z.infer<typeof PolicyDecisionTypeSchema>;
export type ErrorSeverity = z.infer<typeof ErrorSeveritySchema>;
export type BranchCapability = z.infer<typeof BranchCapabilitySchema>;
export type BranchPointKind = z.infer<typeof BranchPointKindSchema>;
export type BranchExecutorSpec = z.infer<typeof BranchExecutorSpecSchema>;
export type BranchSandboxJob = z.infer<typeof BranchSandboxJobSchema>;
export type BranchSandboxLog = z.infer<typeof BranchSandboxLogSchema>;
export type BranchContext = z.infer<typeof BranchContextSchema>;
export type CreateBranchResponse = z.infer<typeof CreateBranchResponseSchema>;
