import { z } from 'zod';
import type { RuntimeExplanationValue } from './types.js';

/** First stable RuntimeExplanation wire version. Earlier uses were experimental. */
export const RUNTIME_EXPLANATION_VERSION = 'runtime_explanation.v1' as const;

export const RuntimeFactBasisSchema = z.enum(['recorded', 'derived', 'unknown']);
export const RuntimeEvidenceFieldConditionSchema = z.enum([
  'recorded',
  'not_recorded',
  'unavailable',
  'redacted',
  'encrypted',
  'permission_denied',
  'oversized',
  'absent',
  'recorded_empty',
  'inconsistent',
]);
export const RuntimeExplanationActivityKindSchema = z.enum([
  'agent',
  'workflow',
  'tool',
  'llm',
  'retrieval',
  'memory',
  'artifact',
  'human',
  'checkpoint',
]);
export const RuntimeExplanationRunOutcomeSchema = z.enum([
  'active',
  'waiting',
  'completed',
  'failed',
  'unknown',
]);
export const RuntimeExplanationRelationBasisSchema = z.enum([
  'explicit_link',
  'trigger_reference',
  'decision_reference',
  'parent_span',
]);
export const RuntimeExplanationConsistencyCodeSchema = z.enum([
  'missing_start',
  'orphan_terminal',
  'duplicate_terminal',
  'timestamp_conflict',
  'dangling_trigger_reference',
  'dangling_decision_reference',
  'dangling_parent_span',
  'ambiguous_parallelism',
  'shared_span_multiple_invocations',
  'branch_fork_cutoff_conflict',
  'incomplete_lifecycle',
  'run_evidence_insufficient',
  'run_evidence_conflict',
]);
export const RuntimeExplanationConsistencySeveritySchema = z.enum(['info', 'warning', 'error']);
export const RunStatusSchema = z.enum(['Active', 'Waiting', 'Completed', 'Failed', 'Unknown']);
export const RuntimePhaseLabelSchema = z.enum([
  'Queued',
  'Active Work',
  'Waiting',
  'Converging',
  'Completed',
  'Failed',
  'Unknown',
]);

const EvidenceAdmissionCursorSchema = z.number().int().nonnegative().max(2_147_483_647);

export const RuntimeJsonValueSchema: z.ZodType<RuntimeExplanationValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(RuntimeJsonValueSchema),
  z.record(z.string(), RuntimeJsonValueSchema),
]));

export const RuntimeExplanationEvidenceRefSchema = z.object({
  event_id: z.string().min(1),
  sequence_num: EvidenceAdmissionCursorSchema,
  timestamp: z.string().min(1),
  branch_id: z.string().min(1).optional(),
  span_id: z.string().min(1).optional(),
  source_event_id: z.string().min(1).optional(),
}).strict();

export const RuntimeFactProvenanceSchema = z.object({
  basis: RuntimeFactBasisSchema,
  condition: RuntimeEvidenceFieldConditionSchema,
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

const RuntimeActivityFieldSchema = z.object({
  value: RuntimeJsonValueSchema.optional(),
  condition: RuntimeEvidenceFieldConditionSchema,
  basis: RuntimeFactBasisSchema.optional(),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema).optional(),
}).strict();

const RuntimeActivityStringFieldSchema = z.object({
  value: z.string().optional(),
  condition: RuntimeEvidenceFieldConditionSchema,
  basis: RuntimeFactBasisSchema.optional(),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema).optional(),
}).strict();

export const RuntimeOperatorActivityRecordSchema = z.object({
  primary_label: z.string(),
  actor: RuntimeActivityStringFieldSchema,
  action: RuntimeActivityStringFieldSchema,
  target: RuntimeActivityStringFieldSchema,
  status_or_outcome: RuntimeActivityStringFieldSchema,
  trigger: RuntimeActivityFieldSchema,
  input: RuntimeActivityFieldSchema,
  output: RuntimeActivityFieldSchema,
  downstream_effect: RuntimeActivityFieldSchema,
  artifacts: RuntimeActivityFieldSchema,
  evidence_condition: RuntimeActivityStringFieldSchema,
  story_critical_sufficient: z.boolean(),
  limitation: z.string().optional(),
}).strict();

export const RuntimeActivitySemanticProvenanceSchema = z.object({
  identity: RuntimeFactProvenanceSchema.optional(),
  kind: RuntimeFactProvenanceSchema,
  lifecycle: RuntimeFactProvenanceSchema,
  outcome: RuntimeFactProvenanceSchema,
  duration: RuntimeFactProvenanceSchema.optional(),
}).strict();

export const RuntimeExplanationActivitySchema = z.object({
  id: z.string().min(1),
  kind: RuntimeExplanationActivityKindSchema,
  title: z.string(),
  subtitle: z.string().optional(),
  action: z.string(),
  status: RuntimeExplanationRunOutcomeSchema,
  outcome: z.string().optional(),
  started_at: z.string().min(1).optional(),
  ended_at: z.string().min(1).optional(),
  duration_ms: z.number().finite().nonnegative().optional(),
  actor: z.string().optional(),
  source_span_id: z.string().optional(),
  parent_span_id: z.string().optional(),
  sequence_num: EvidenceAdmissionCursorSchema.optional(),
  invocation_id: z.string().optional(),
  inputs: z.record(z.string(), RuntimeJsonValueSchema).optional(),
  outputs: z.record(z.string(), RuntimeJsonValueSchema).optional(),
  error: z.record(z.string(), RuntimeJsonValueSchema).optional(),
  artifacts: z.array(RuntimeJsonValueSchema).optional(),
  semantic_provenance: RuntimeActivitySemanticProvenanceSchema.optional(),
  operator_facing_record: RuntimeOperatorActivityRecordSchema.optional(),
  story_critical: z.boolean().optional(),
  story_critical_limitation: z.string().optional(),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

export const RuntimeExplanationRelationSchema = z.object({
  id: z.string().min(1),
  source_activity_id: z.string().min(1),
  target_activity_id: z.string().min(1),
  basis: RuntimeExplanationRelationBasisSchema,
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

export const RuntimeExplanationParallelGroupSchema = z.object({
  id: z.string().min(1),
  activity_ids: z.array(z.string().min(1)).min(2),
  basis: z.literal('explicit'),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

export const RuntimeExplanationMergeGroupSchema = z.object({
  id: z.string().min(1),
  predecessor_activity_ids: z.array(z.string().min(1)).min(1),
  downstream_activity_id: z.string().min(1),
  parallel_group_id: z.string().min(1),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

export const RuntimeExplanationConsistencyFlagSchema = z.object({
  code: RuntimeExplanationConsistencyCodeSchema,
  severity: RuntimeExplanationConsistencySeveritySchema,
  message: z.string(),
  activity_id: z.string().optional(),
  relation_id: z.string().optional(),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

export const RuntimeFrameV1Schema = z.object({
  mission_id: z.string().min(1),
  branch_id: z.string().min(1),
  sequence_num: EvidenceAdmissionCursorSchema,
  as_of_timestamp: z.string().min(1),
  projection_version: z.literal(RUNTIME_EXPLANATION_VERSION),
}).strict();

export const RuntimePhaseSummaryV1Schema = z.object({
  id: z.string().min(1),
  label: RuntimePhaseLabelSchema,
  basis: RuntimeFactBasisSchema,
  condition: RuntimeEvidenceFieldConditionSchema.optional(),
  start_sequence_num: EvidenceAdmissionCursorSchema.optional(),
  end_sequence_num: EvidenceAdmissionCursorSchema.optional(),
  evidence_refs: z.array(RuntimeExplanationEvidenceRefSchema),
}).strict();

export const RuntimeProgressMarkerV1Schema = z.object({
  sequence_num: EvidenceAdmissionCursorSchema,
  timestamp: z.string().min(1),
  kind: RuntimeExplanationActivityKindSchema,
  text: z.string(),
  actor: z.string().optional(),
}).strict();

export const RuntimeSelectedActivityStateV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('overview'),
    selection_basis: z.string().optional(),
    reason: z.enum(['frame_overview', 'missing_activity', 'incompatible']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('selected'),
    activity_id: z.string().min(1),
    selection_basis: z.string().optional(),
    reason: z.enum(['missing_activity', 'incompatible']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('no_activity'),
    selection_basis: z.string().optional(),
    reason: z.enum(['no_selectable_activity', 'incompatible']).optional(),
  }).strict(),
]);

function addIssue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function duplicateIds(values: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates];
}

export const RuntimeExplanationV1Schema = z.object({
  mission_id: z.string().min(1),
  branch_id: z.string().min(1),
  as_of_sequence_num: EvidenceAdmissionCursorSchema,
  as_of_timestamp: z.string().min(1),
  projection_version: z.literal(RUNTIME_EXPLANATION_VERSION),
  run_outcome: RuntimeExplanationRunOutcomeSchema,
  run_outcome_provenance: RuntimeFactProvenanceSchema,
  frame: RuntimeFrameV1Schema,
  run_status: RunStatusSchema,
  run_status_provenance: RuntimeFactProvenanceSchema,
  runtime_phase: RuntimePhaseSummaryV1Schema,
  progress_markers: z.array(RuntimeProgressMarkerV1Schema),
  selected_activity_state: RuntimeSelectedActivityStateV1Schema,
  run_duration_ms: z.number().finite().nonnegative().optional(),
  run_duration_provenance: RuntimeFactProvenanceSchema,
  activities: z.array(RuntimeExplanationActivitySchema),
  relations: z.array(RuntimeExplanationRelationSchema),
  parallel_groups: z.array(RuntimeExplanationParallelGroupSchema),
  merge_groups: z.array(RuntimeExplanationMergeGroupSchema),
  consistency_flags: z.array(RuntimeExplanationConsistencyFlagSchema),
}).strict().superRefine((projection, context) => {
  if (projection.frame.mission_id !== projection.mission_id) addIssue(context, ['frame', 'mission_id'], 'frame mission must match projection mission');
  if (projection.frame.branch_id !== projection.branch_id) addIssue(context, ['frame', 'branch_id'], 'frame branch must match projection branch');
  if (projection.frame.sequence_num !== projection.as_of_sequence_num) addIssue(context, ['frame', 'sequence_num'], 'frame cursor must match projection cursor');
  if (projection.frame.as_of_timestamp !== projection.as_of_timestamp) addIssue(context, ['frame', 'as_of_timestamp'], 'frame timestamp must match projection timestamp');

  for (const id of duplicateIds(projection.activities)) addIssue(context, ['activities'], `duplicate activity id: ${id}`);
  for (const id of duplicateIds(projection.relations)) addIssue(context, ['relations'], `duplicate relation id: ${id}`);
  for (const id of duplicateIds(projection.parallel_groups)) addIssue(context, ['parallel_groups'], `duplicate parallel group id: ${id}`);
  for (const id of duplicateIds(projection.merge_groups)) addIssue(context, ['merge_groups'], `duplicate merge group id: ${id}`);

  const activityIds = new Set(projection.activities.map((activity) => activity.id));
  const parallelIds = new Set(projection.parallel_groups.map((group) => group.id));
  for (const [index, relation] of projection.relations.entries()) {
    if (!activityIds.has(relation.source_activity_id)) addIssue(context, ['relations', index, 'source_activity_id'], 'relation source activity is missing');
    if (!activityIds.has(relation.target_activity_id)) addIssue(context, ['relations', index, 'target_activity_id'], 'relation target activity is missing');
  }
  for (const [index, group] of projection.parallel_groups.entries()) {
    for (const activityId of group.activity_ids) {
      if (!activityIds.has(activityId)) addIssue(context, ['parallel_groups', index, 'activity_ids'], 'parallel group activity is missing');
    }
  }
  for (const [index, group] of projection.merge_groups.entries()) {
    if (!parallelIds.has(group.parallel_group_id)) addIssue(context, ['merge_groups', index, 'parallel_group_id'], 'merge group parallel group is missing');
    if (!activityIds.has(group.downstream_activity_id)) addIssue(context, ['merge_groups', index, 'downstream_activity_id'], 'merge downstream activity is missing');
    for (const activityId of group.predecessor_activity_ids) {
      if (!activityIds.has(activityId)) addIssue(context, ['merge_groups', index, 'predecessor_activity_ids'], 'merge predecessor activity is missing');
    }
  }
  if (projection.selected_activity_state.kind === 'selected'
    && !activityIds.has(projection.selected_activity_state.activity_id)) {
    addIssue(context, ['selected_activity_state', 'activity_id'], 'selected activity is missing');
  }
});

const queryCursor = z.preprocess((value) => {
  if (typeof value !== 'string' || value.trim() === '') return value;
  return Number(value);
}, EvidenceAdmissionCursorSchema);

export const RuntimeExplanationQueryV1Schema = z.object({
  branch_id: z.string().min(1).optional(),
  sequence_num: queryCursor.optional(),
  projection_version: z.literal(RUNTIME_EXPLANATION_VERSION).optional(),
}).strict();

export const RuntimeExplanationUpdatedV1Schema = z.object({
  type: z.literal('runtime.explanation.updated'),
  mission_id: z.string().min(1),
  branch_id: z.string().min(1),
  projection_version: z.literal(RUNTIME_EXPLANATION_VERSION),
  runtime_explanation: RuntimeExplanationV1Schema,
}).strict().superRefine((message, context) => {
  if (message.mission_id !== message.runtime_explanation.mission_id) addIssue(context, ['mission_id'], 'message mission must match explanation mission');
  if (message.branch_id !== message.runtime_explanation.branch_id) addIssue(context, ['branch_id'], 'message branch must match explanation branch');
});

export const InterruptRequestLifecycleContractSchema = z.enum(['pending', 'resolved', 'expired', 'stale', 'unsupported']);
export const InterruptDecisionStateContractSchema = z.enum(['none', 'recorded']);
export const InterruptDeliveryStateContractSchema = z.enum(['not_requested', 'pending', 'accepted', 'failed', 'stale', 'unknown']);
export const InterruptRuntimeOutcomeContractSchema = z.enum(['awaiting_interaction', 'resumed', 'continued_with_input', 'rejected_or_terminated', 'failed', 'unknown']);
export const InterruptActionabilityContractSchema = z.enum(['actionable', 'observed_only', 'unsupported', 'identity_conflict', 'unavailable']);
export const InterruptControlModeContractSchema = z.enum(['framework_binding', 'legacy_token', 'unavailable']);
export const InterruptSupportedDecisionTypeContractSchema = z.enum(['approve', 'reject', 'structured_response']);

export const RuntimeGovernanceAxesV1Schema = z.object({
  request_lifecycle: InterruptRequestLifecycleContractSchema,
  decision_state: InterruptDecisionStateContractSchema,
  delivery_state: InterruptDeliveryStateContractSchema,
  runtime_outcome: InterruptRuntimeOutcomeContractSchema,
  actionability: InterruptActionabilityContractSchema,
  control_mode: InterruptControlModeContractSchema,
  governance_available: z.boolean(),
  supported_decision_types: z.array(InterruptSupportedDecisionTypeContractSchema),
}).strict().superRefine((state, context) => {
  if (state.actionability === 'actionable' && !state.governance_available) {
    addIssue(context, ['actionability'], 'actionable control requires an available deployment');
  }
  if (state.actionability === 'actionable' && state.control_mode === 'unavailable') {
    addIssue(context, ['control_mode'], 'unavailable control mode cannot be actionable');
  }
});

export type RuntimeExplanationV1 = z.infer<typeof RuntimeExplanationV1Schema>;
export type RuntimeExplanationUpdatedV1 = z.infer<typeof RuntimeExplanationUpdatedV1Schema>;
export type RuntimeGovernanceAxesV1 = z.infer<typeof RuntimeGovernanceAxesV1Schema>;

/** Validate and normalize the one frozen RuntimeExplanation wire payload. */
export function serializeRuntimeExplanationV1(input: unknown): RuntimeExplanationV1 {
  return RuntimeExplanationV1Schema.parse(input);
}

export function createRuntimeExplanationUpdatedV1(input: unknown): RuntimeExplanationUpdatedV1 {
  return RuntimeExplanationUpdatedV1Schema.parse(input);
}
