/**
 * ROPS Level 3 — Inspector Panel (spec section 9).
 *
 * The primary L3 surface for a selected Runtime Object. Renders the fixed
 * 7-section order (Identity → Lifecycle → Payload → Relationships → Statistics
 * → Provenance → Evidence) using ONLY:
 *   - `RuntimeNodeProjection.facts` + `recent_runtime_events` (Agent), or
 *   - the mapped core records for non-Agent objects,
 * and the `EventEnvelope` provenance for the Provenance section.
 *
 * It NEVER reads `RuntimeNodeProjection.generated.*` (P4) and never renders
 * `RuntimeSummary.narrative` or any AI narrative. Every field is classified
 * Evidence / Projection / Heuristic and labelled per spec 7.6.
 *
 * This component is presentational; all data is passed in via props. The
 * parent (RightSidebar) owns fetching and selection.
 */
'use client';

import { useState } from 'react';
import type {
  EventEnvelope,
  GraphEdge,
  GraphNode,
  ProducedOutput,
  RuntimeEventRef,
  RuntimeNodeProjection,
} from '@agentlens/protocol';
import { renderRuntimeEventRef } from '@agentlens/protocol';
import {
  buildAgentView,
  buildGraphNodeView,
  buildInterruptView,
  buildInterruptViewFromState,
  buildBranchView,
  buildCheckpointView,
  buildRuntimeAgentStateView,
  classifySearch,
  deriveRelationships,
  envelopeProvenance,
  formatDurationMs,
  formatTimestamp,
  packEvidence,
  splitPayload,
  type AgentView,
} from '@/lib/rops/provenance';
import { collectNodeEvidence, type NodeCorrelatedEvidence } from '@/lib/rops/nodeEvidence';
import { RopsFieldRow, RopsSection, ProvenanceTag } from './primitives';
import { safePreview } from '@/lib/safePreview';

export interface RopsInspectorInput {
  /** The selected graph node (Evidence source for non-agent objects). */
  readonly node: GraphNode | null;
  /** The agent projection, when the node is an agent (authoritative L3 source). */
  readonly agentProjection: RuntimeNodeProjection | null;
  /** Whether an emitter `gen_ai.agent.confidence` attribute was observed. */
  readonly emitterConfidencePresent?: boolean;
  /** Edges in the current snapshot (for relationship derivation). */
  edges: readonly GraphEdge[];
  /** The mission (for Mission object type). */
  mission: import('@agentlens/protocol').Mission | null;
  /** The selected event envelope (for the Provenance section + L4 jump). */
  eventEnvelope: EventEnvelope | null;
  /** The full event-envelope stream for the current frame (Evidence source
   *  for correlating a non-agent node to its tool I/O / failure reason). */
  eventEnvelopes: readonly EventEnvelope[];
  /** The runtime agent state (in-memory replay) when available. */
  runtimeAgentState: import('@agentlens/protocol').RuntimeAgentState | null;
  /** The interrupt record (for Interrupt object type). */
  interrupt: import('@agentlens/protocol').RuntimeInterruptState | import('@agentlens/protocol').InterruptRecord | null;
  /** The branch (for Branch object type). */
  branch: import('@agentlens/protocol').ReplayBranch | null;
  /** The current snapshot (for Checkpoint object type). */
  snapshot: import('@agentlens/protocol').GraphSnapshot | null;
  /** Callback to open the L4 evidence view for an event (spec 11 View Evidence). */
  onViewEvidence?: (sequenceNum: number) => void;
  /** Callback to jump the timeline to an event (spec 11 Jump to Event/Timeline). */
  onJumpToEvent?: (sequenceNum: number) => void;
}

// ---------------------------------------------------------------------------
// Presentation priority (display order only — spec: evidence-first, no
// interpretation). These constants govern the order in which correlated
// runtime evidence rows render inside the Payload section. They never affect
// evidence content or provenance: every value is packed as Evidence via
// `packEvidence` and rendered with the shared `RopsFieldRow` primitive.
// Operationally valuable evidence (tool, query, I/O, failure, artifacts) is
// shown before the remaining recognized metadata keys.
// ---------------------------------------------------------------------------

/** Render order for tool/memory/artifact Payload evidence. */
const TOOL_EVIDENCE_ORDER = [
  'tool_name',
  'tool_input',
  'tool_output',
  'tool_status',
  'search_query',
  'result_count',
  'retrieval_backend',
  'failure_reason',
  'failure_cause',
] as const;

/** Render order for task (workflow step) Payload evidence. */
const TASK_EVIDENCE_ORDER = [
  'task',
  'gen_ai.agent.task.description',
  'progress',
  'failure_reason',
  'failure_cause',
] as const;

/** No-schema fields omitted entirely when absent (never fabricated). */
const OMIT_WHEN_ABSENT: ReadonlySet<string> = new Set<string>([
  'search_query',
  'result_count',
  'retrieval_backend',
]);

/**
 * Build the ordered list of Evidence rows for a tool/memory/artifact node from
 * the raw correlated evidence bundle + node metadata. Returns rows in
 * presentation-priority order; the caller renders them with `RopsFieldRow`.
 */
function buildToolEvidenceRows(
  evidence: NodeCorrelatedEvidence,
): Array<{ label: string; field: ReturnType<typeof packEvidence> }> {
  const rows: Array<{ label: string; field: ReturnType<typeof packEvidence> }> = [];
  const push = (label: string, value: unknown) => {
    const field = packEvidence(label, value);
    if (field.absent && OMIT_WHEN_ABSENT.has(label)) return;
    rows.push({ label, field });
  };

  for (const key of TOOL_EVIDENCE_ORDER) {
    switch (key) {
      case 'tool_name': push('tool_name', evidence.toolName); break;
      case 'tool_input': push('tool_input', evidence.toolInput); break;
      case 'tool_output': push('tool_output', evidence.toolOutput); break;
      case 'tool_status': push('tool_status', evidence.toolStatus); break;
      case 'search_query': push('search_query', evidence.searchQuery); break;
      case 'result_count': push('result_count', evidence.resultCount); break;
      case 'retrieval_backend': push('retrieval_backend', evidence.retrievalBackend); break;
      case 'failure_reason': push('failure_reason', evidence.failureReason); break;
      case 'failure_cause': push('failure_cause', evidence.failureCause); break;
    }
  }
  return rows;
}

export function RopsInspector(input: RopsInspectorInput) {
  const { node } = input;
  if (!node && !input.interrupt && !input.branch && !input.snapshot && !input.mission) {
    return <EmptyInspector />;
  }

  // Determine the ROPS object type from the strongest available evidence.
  if (input.interrupt) {
    return <InterruptInspector input={input} />;
  }
  if (input.branch && !node) {
    return <BranchInspector input={input} />;
  }
  if (input.snapshot && !node) {
    return <CheckpointInspector input={input} />;
  }
  if (!node) return <EmptyInspector />;

  if (node.type === 'agent' && input.agentProjection) {
    return <AgentInspector input={input} />;
  }
  if (node.type === 'agent' && input.runtimeAgentState) {
    return <RuntimeAgentStateInspector input={input} />;
  }
  if (node.type === 'tool' || node.type === 'memory' || node.type === 'artifact') {
    return <PayloadObjectInspector input={input} />;
  }
  if (node.type === 'task') {
    return <WorkflowStepInspector input={input} />;
  }
  // Fallback: a minimal identity/lifecycle view for any other node type.
  return <GenericNodeInspector input={input} />;
}

function EmptyInspector() {
  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] p-6 text-center">
      <div className="text-[11px] text-[#9498b0]">Select a runtime object to inspect.</div>
      <div className="text-[10px] text-[#5d6180] mt-1">Identity, lifecycle, payload, relationships, statistics, and provenance will display here.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent inspector (spec 9.3 — Agent: full section order)
// ---------------------------------------------------------------------------

function AgentInspector({ input }: { input: RopsInspectorInput }) {
  const { agentProjection, emitterConfidencePresent, node, edges, eventEnvelope } = input;
  if (!agentProjection) return <EmptyInspector />;
  const view = buildAgentView(agentProjection, emitterConfidencePresent);
  const rels = deriveRelationships(node?.id ?? agentProjection.agent_id, edges);
  const prov = envelopeProvenance(eventEnvelope);

  return (
    <PanelShell objectType={view.objectType} name={view.name.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="name" field={view.name} />
        <RopsFieldRow label="agent_id" field={view.agentId} />
        <RopsFieldRow label="node_type" field={view.nodeType} />
        <RopsFieldRow label="role" field={view.role} />
        <RopsFieldRow label="agent_type" field={view.agentType} />
        <RopsFieldRow label="framework" field={view.framework} />
        <RopsFieldRow label="team" field={view.team} />
      </RopsSection>

      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="status_label" field={view.statusLabel} />
        <RopsFieldRow label="iteration" field={view.iteration} />
        <RopsFieldRow label="start_time" field={view.startTime} formatter={formatTimestamp} />
        <RopsFieldRow label="end_time" field={view.endTime} formatter={formatTimestamp} />
        <RopsFieldRow label="duration_ms" field={view.durationMs} formatter={formatDurationMs} />
        <RopsFieldRow label="error_count" field={view.errorCount} />
        <RopsFieldRow label="requires_human" field={view.requiresHuman} formatter={String} />
        <RopsFieldRow label="pending" field={view.pending} />
        <RopsFieldRow label="drift_score" field={view.driftScore} formatter={(v) => String(v)} />
        {/* Confidence: render with provenance. Heuristic -> visible caveat tag (10.3/P8). */}
        <ConfidenceRow view={view} />
      </RopsSection>

      <RopsSection title="Payload">
        <ProducedOutputs outputs={view.producedOutputs.value ?? []} />
      </RopsSection>

      <RopsSection title="Relationships">
        <RopsFieldRow label="next_transition" field={view.nextTransition} formatter={(t) => `→ ${t.target} (${t.kind})${t.reason ? ` — ${t.reason}` : ''}`} />
        <DerivedRelationshipRows rels={rels} />
        <RopsFieldRow label="source_span_id" field={view.sourceSpanId} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>

      <RopsSection title="Statistics">
        <RopsFieldRow label="error_count" field={view.errorCount} />
        <RopsFieldRow label="produced_outputs" field={view.producedOutputs} formatter={(o) => String(o.length)} />
      </RopsSection>

      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}

      <RopsSection title="Evidence" collapsible defaultOpen={false}>
        <RecentEvents
          events={view.recentRuntimeEvents.value ?? []}
          onViewEvidence={input.onViewEvidence}
          onJumpToEvent={input.onJumpToEvent}
        />
      </RopsSection>
    </PanelShell>
  );
}

function ConfidenceRow({ view }: { view: AgentView }) {
  const f = view.confidence;
  if (f.absent) {
    return <RopsFieldRow label="confidence" field={f} />;
  }
  return (
    <div className="flex justify-between items-start gap-3 border-b border-[rgba(255,255,255,0.04)] pb-1.5">
      <span className="text-[#8f95b2] text-[10px] font-semibold shrink-0">confidence</span>
      <div className="text-right">
        <span className="text-[11px] text-[#d0d4ea]">{Math.round((f.value ?? 0) * 100)}%</span>
        <ProvenanceTag provenance={f.provenance} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuntimeAgentState inspector (agent without a server projection — uses
// the in-memory RuntimeAgentState, evidence only).
// ---------------------------------------------------------------------------

function RuntimeAgentStateInspector({ input }: { input: RopsInspectorInput }) {
  const { runtimeAgentState, node, edges, eventEnvelope } = input;
  if (!runtimeAgentState) return <EmptyInspector />;
  const view = buildRuntimeAgentStateView(runtimeAgentState);
  const rels = deriveRelationships(node?.id ?? runtimeAgentState.agent_id, edges);
  const prov = envelopeProvenance(eventEnvelope);
  return (
    <PanelShell objectType={view.objectType} name={view.name.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="name" field={view.name} />
        <RopsFieldRow label="agent_id" field={view.agentId} />
        <RopsFieldRow label="role" field={view.role} />
        <RopsFieldRow label="team" field={view.team} />
      </RopsSection>
      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="status_label" field={view.statusLabel} />
        <RopsFieldRow label="confidence" field={view.confidence} formatter={(v) => `${Math.round(v * 100)}%`} />
        <RopsFieldRow label="current_task_id" field={view.currentTaskId} />
        <RopsFieldRow label="current_span_id" field={view.currentSpanId} />
        <RopsFieldRow label="pending_interrupt_id" field={view.pendingInterruptId} />
        <RopsFieldRow label="last_event_sequence_num" field={view.lastEventSequenceNum} formatter={String} />
        <RopsFieldRow label="last_reason" field={view.lastReason} />
      </RopsSection>
      <RopsSection title="Payload">
        <RopsFieldRow label="summary" field={view.summary} />
      </RopsSection>
      <RopsSection title="Relationships">
        <DerivedRelationshipRows rels={rels} />
      </RopsSection>
      <RopsSection title="Statistics">
        <RopsFieldRow label="history" field={view.history} formatter={(h) => `${h.length} events`} />
      </RopsSection>
      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Payload object inspector (Tool / Memory / Artifact) — spec 9.3
// ---------------------------------------------------------------------------

function PayloadObjectInspector({ input }: { input: RopsInspectorInput }) {
  const { node, edges, eventEnvelope, eventEnvelopes, agentProjection } = input;
  if (!node) return <EmptyInspector />;
  const view = buildGraphNodeView(node);
  const rels = deriveRelationships(node.id, edges);
  const prov = envelopeProvenance(eventEnvelope);
  const payload = (node.metadata ?? {}) as Record<string, unknown>;
  const { recognized, unrecognized } = splitPayload(payload);
  // Search classification (spec 3.6) — only relevant for tool nodes.
  const search = node.type === 'tool'
    ? classifySearch((payload.tool_name as string) ?? node.label, payload)
    : { isSearch: false } as const;

  // Correlate runtime evidence (tool I/O, search query, result count,
  // retrieval backend, failure reason) from the envelopes sharing this node's
  // span_id. Pure correlation — the rows below own packing + display order.
  const evidence = collectNodeEvidence(node, eventEnvelopes, agentProjection);
  const evidenceRows = buildToolEvidenceRows(evidence);
  // Metadata keys already surfaced as structured Evidence rows above are
  // excluded from the remaining recognized list to avoid duplication.
  const evidenceLabels = new Set(evidenceRows.map((r) => r.label));
  const metadataAliasKeys = new Set([
    'tool_name', 'gen_ai.tool.name', 'name',
    'tool_input', 'gen_ai.tool.input', 'input',
    'tool_output', 'gen_ai.tool.output', 'output',
    'tool_status', 'gen_ai.tool.status', 'status',
    'search_query', 'search.query', 'query',
    'result_count', 'search.result_count', 'resultCount',
    'retrieval_backend', 'retrieval.backend', 'retrievalBackend',
  ]);
  const remainingRecognized = recognized.filter(
    ([k]) => !evidenceLabels.has(k) && !metadataAliasKeys.has(k),
  );

  return (
    <PanelShell objectType={view.objectType} name={view.label.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="label" field={view.label} />
        <RopsFieldRow label="id" field={view.id} />
        <RopsFieldRow label="node_type" field={view.nodeType} />
        {view.role.value && <RopsFieldRow label="role" field={view.role} />}
        {view.agentId.value && <RopsFieldRow label="agent_id" field={view.agentId} />}
        {view.framework.value && <RopsFieldRow label="framework" field={view.framework} />}
        {search.isSearch && (
          <div className="flex justify-between items-start gap-3 border-b border-[rgba(255,255,255,0.04)] pb-1.5">
            <span className="text-[#8f95b2] text-[10px] font-semibold shrink-0">search</span>
            <div className="text-right">
              <span className="text-[11px] text-[#d0d4ea]">detected</span>
              <ProvenanceTag provenance={search.provenance} />
            </div>
          </div>
        )}
      </RopsSection>

      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="status_label" field={view.statusLabel} />
        <RopsFieldRow label="start_time" field={view.startTime} formatter={formatTimestamp} />
        <RopsFieldRow label="end_time" field={view.endTime} formatter={formatTimestamp} />
        <RopsFieldRow label="duration_ms" field={view.durationMs} formatter={formatDurationMs} />
        <RopsFieldRow label="error_count" field={view.errorCount} />
      </RopsSection>

      <RopsSection title="Payload">
        {evidenceRows.length === 0 && remainingRecognized.length === 0 ? (
          <span className="text-[10px] text-[#5d6180] italic">no recognized payload keys</span>
        ) : (
          <div className="space-y-1.5">
            {evidenceRows.map((r) => (
              <EvidenceRow key={r.label} label={r.label} field={r.field} />
            ))}
            {remainingRecognized.length > 0 && (
              <div className={evidenceRows.length > 0 ? 'pt-1.5' : ''}>
                {remainingRecognized.length > 0 && evidenceRows.length > 0 && (
                  <div className="text-[9px] uppercase tracking-[0.12em] text-[#5d6180] mb-1">Other payload</div>
                )}
                <KeyValueList entries={remainingRecognized} />
              </div>
            )}
          </div>
        )}
      </RopsSection>

      <RopsSection title="Relationships">
        <DerivedRelationshipRows rels={rels} />
        <RopsFieldRow label="span_id" field={view.spanId} />
        <RopsFieldRow label="source_span_id" field={view.sourceSpanId} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>

      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}

      {unrecognized.length > 0 && (
        <RopsSection title="Raw Attributes (unrecognized)" collapsible defaultOpen={false}>
          <div className="text-[9px] text-[#6b708a] mb-1">
            Payload keys not in the ROPS whitelist (spec 8.2). Shown verbatim, never interpreted.
          </div>
          <KeyValueList entries={unrecognized} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// WorkflowStep inspector — spec 9.3
// ---------------------------------------------------------------------------

function WorkflowStepInspector({ input }: { input: RopsInspectorInput }) {
  const { node, edges, eventEnvelope, eventEnvelopes } = input;
  if (!node) return <EmptyInspector />;
  const view = buildGraphNodeView(node);
  const rels = deriveRelationships(node.id, edges);
  const prov = envelopeProvenance(eventEnvelope);
  const payload = (node.metadata ?? {}) as Record<string, unknown>;

  // Correlate runtime evidence (failure reason from the span.failed envelope
  // sharing this node's span_id). Tool I/O is not expected for task nodes,
  // but the correlation is harmless and the rows are omitted when absent.
  const evidence = collectNodeEvidence(node, eventEnvelopes);

  // Presentation-priority rows: task description fields from metadata, then
  // failure reason/cause from correlated evidence. Schema-backed absent
  // fields keep the existing "not recorded" marker; no-schema fields are
  // omitted (none in the task order today).
  const taskRows: Array<{ label: string; field: ReturnType<typeof packEvidence> }> = [];
  for (const key of TASK_EVIDENCE_ORDER) {
    let value: unknown;
    switch (key) {
      case 'task': value = payload.task; break;
      case 'gen_ai.agent.task.description': value = payload['gen_ai.agent.task.description']; break;
      case 'progress': value = payload.progress; break;
      case 'failure_reason': value = evidence.failureReason; break;
      case 'failure_cause': value = evidence.failureCause; break;
      default: value = undefined;
    }
    taskRows.push({ label: key, field: packEvidence(key, value) });
  }
  const { recognized, unrecognized } = splitPayload(payload);
  const shownKeys: Set<string> = new Set<string>(TASK_EVIDENCE_ORDER);
  const remainingRecognized = recognized.filter(([k]) => !shownKeys.has(k));
  const hasAnyPayload =
    taskRows.some((r) => !r.field.absent) ||
    remainingRecognized.length > 0 ||
    unrecognized.length > 0;

  return (
    <PanelShell objectType={view.objectType} name={view.label.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="label" field={view.label} />
        <RopsFieldRow label="id" field={view.id} />
        <RopsFieldRow label="node_type" field={view.nodeType} />
        {view.agentId.value && <RopsFieldRow label="owning_agent" field={view.agentId} />}
      </RopsSection>
      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="status_label" field={view.statusLabel} />
        <RopsFieldRow label="start_time" field={view.startTime} formatter={formatTimestamp} />
        <RopsFieldRow label="end_time" field={view.endTime} formatter={formatTimestamp} />
        <RopsFieldRow label="duration_ms" field={view.durationMs} formatter={formatDurationMs} />
        <RopsFieldRow label="error_count" field={view.errorCount} />
      </RopsSection>
      <RopsSection title="Payload">
        {hasAnyPayload ? (
          <div className="space-y-1.5">
            {taskRows.map((r) => (
              <EvidenceRow key={r.label} label={r.label} field={r.field} />
            ))}
            {remainingRecognized.length > 0 && (
              <div className={taskRows.some((r) => !r.field.absent) ? 'pt-1.5' : ''}>
                {taskRows.some((r) => !r.field.absent) && (
                  <div className="text-[9px] uppercase tracking-[0.12em] text-[#5d6180] mb-1">Other payload</div>
                )}
                <KeyValueList entries={remainingRecognized} />
              </div>
            )}
            {unrecognized.length > 0 && (
              <div className="pt-1.5">
                <div className="text-[9px] text-[#6b708a] mb-1">
                  Payload keys not in the ROPS whitelist (spec 8.2). Shown verbatim, never interpreted.
                </div>
                <KeyValueList entries={unrecognized} />
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-[#5d6180] italic">no task payload</span>
        )}
      </RopsSection>
      <RopsSection title="Relationships">
        <DerivedRelationshipRows rels={rels} />
        <RopsFieldRow label="source_span_id" field={view.sourceSpanId} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>
      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Interrupt / Branch / Checkpoint inspectors — spec 9.3
// ---------------------------------------------------------------------------

function InterruptInspector({ input }: { input: RopsInspectorInput }) {
  const { interrupt, eventEnvelope } = input;
  if (!interrupt) return <EmptyInspector />;
  const isRecord = 'interrupt_id' in interrupt && 'created_at' in interrupt && 'mission_id' in interrupt;
  const view = isRecord
    ? buildInterruptView(interrupt as import('@agentlens/protocol').InterruptRecord)
    : buildInterruptViewFromState(interrupt as import('@agentlens/protocol').RuntimeInterruptState);
  const prov = envelopeProvenance(eventEnvelope);
  return (
    <PanelShell objectType={view.objectType} name={view.interruptId.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="interrupt_id" field={view.interruptId} />
      </RopsSection>
      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="created_at" field={view.createdAt} formatter={formatTimestamp} />
        <RopsFieldRow label="updated_at" field={view.updatedAt} formatter={formatTimestamp} />
        <RopsFieldRow label="expires_at" field={view.expiresAt} formatter={formatTimestamp} />
        <RopsFieldRow label="decided_at" field={view.decidedAt} formatter={formatTimestamp} />
        <RopsFieldRow label="resumed_at" field={view.resumedAt} formatter={formatTimestamp} />
      </RopsSection>
      <RopsSection title="Payload">
        <RopsFieldRow label="reason" field={view.reason} />
        <RopsFieldRow label="decision" field={view.decision} />
        <RopsFieldRow label="decision_comment" field={view.decisionComment} />
        <RopsFieldRow label="resume_url" field={view.resumeUrl} />
        {view.payload.value && (
          <div className="pt-1">
            <div className="text-[9px] text-[#6b708a] mb-1">payload</div>
            <JsonBlock value={view.payload.value} />
          </div>
        )}
        {view.decisionPayload.value && (
          <div className="pt-1">
            <div className="text-[9px] text-[#6b708a] mb-1">decision_payload</div>
            <JsonBlock value={view.decisionPayload.value} />
          </div>
        )}
      </RopsSection>
      <RopsSection title="Relationships">
        <RopsFieldRow label="agent_id" field={view.agentId} />
        <RopsFieldRow label="span_id" field={view.spanId} />
      </RopsSection>
      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

function BranchInspector({ input }: { input: RopsInspectorInput }) {
  const { branch } = input;
  if (!branch) return <EmptyInspector />;
  const view = buildBranchView(branch);
  return (
    <PanelShell objectType={view.objectType} name={view.name.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="name" field={view.name} />
        <RopsFieldRow label="id" field={view.id} />
      </RopsSection>
      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="created_at" field={view.createdAt} formatter={formatTimestamp} />
        <RopsFieldRow label="updated_at" field={view.updatedAt} formatter={formatTimestamp} />
      </RopsSection>
      <RopsSection title="Relationships">
        <RopsFieldRow label="parent_branch_id" field={view.parentBranchId} />
        <RopsFieldRow label="forked_from_sequence_num" field={view.forkedFromSequenceNum} formatter={(v) => `#${v}`} />
      </RopsSection>
      {view.metadata.value && Object.keys(view.metadata.value).length > 0 && (
        <RopsSection title="Raw Attributes (metadata)" collapsible defaultOpen={false}>
          <JsonBlock value={view.metadata.value} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

function CheckpointInspector({ input }: { input: RopsInspectorInput }) {
  const { snapshot } = input;
  if (!snapshot) return <EmptyInspector />;
  const view = buildCheckpointView(snapshot);
  return (
    <PanelShell objectType={view.objectType} name={`Checkpoint #${view.sequenceNum.value ?? '?'}`}>
      <RopsSection title="Identity">
        <RopsFieldRow label="sequence_num" field={view.sequenceNum} formatter={(v) => `#${v}`} />
        <RopsFieldRow label="timestamp" field={view.timestamp} formatter={formatTimestamp} />
        <RopsFieldRow label="branch_id" field={view.branchId} />
      </RopsSection>
      <RopsSection title="Lifecycle">
        <RopsFieldRow label="phase" field={view.phase} />
      </RopsSection>
      <RopsSection title="Payload">
        <RopsFieldRow label="event_type" field={view.triggeringEventType} />
        <RopsFieldRow label="event_description" field={view.triggeringEventDescription} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>
      <RopsSection title="Statistics">
        <RopsFieldRow label="node_count" field={view.nodeCount} formatter={String} />
        <RopsFieldRow label="edge_count" field={view.edgeCount} formatter={String} />
      </RopsSection>
    </PanelShell>
  );
}

function GenericNodeInspector({ input }: { input: RopsInspectorInput }) {
  const { node, edges, eventEnvelope } = input;
  if (!node) return <EmptyInspector />;
  const view = buildGraphNodeView(node);
  const rels = deriveRelationships(node.id, edges);
  const prov = envelopeProvenance(eventEnvelope);
  return (
    <PanelShell objectType={view.objectType} name={view.label.value ?? '—'}>
      <RopsSection title="Identity">
        <RopsFieldRow label="label" field={view.label} />
        <RopsFieldRow label="id" field={view.id} />
        <RopsFieldRow label="node_type" field={view.nodeType} />
      </RopsSection>
      <RopsSection title="Lifecycle">
        <RopsFieldRow label="status" field={view.status} />
        <RopsFieldRow label="status_label" field={view.statusLabel} />
      </RopsSection>
      <RopsSection title="Relationships">
        <DerivedRelationshipRows rels={rels} />
      </RopsSection>
      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function PanelShell({ objectType, name, children }: { objectType: string; name: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#818cf8]" />
          <span className="text-[9px] uppercase tracking-[0.12em] text-[#818cf8] font-bold">ROPS Inspector</span>
        </div>
        <span className="text-[9px] bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] border border-[#6366f1]/20 px-2 py-0.5 rounded-md font-mono uppercase tracking-wide">
          {objectType}
        </span>
      </div>
      <div className="text-[13px] font-semibold text-white tracking-wide">
        {name}
      </div>
      {children}
    </div>
  );
}

function DerivedRelationshipRows({ rels }: { rels: ReturnType<typeof deriveRelationships> }) {
  if (rels.length === 0) {
    return <span className="text-[10px] text-[#5d6180] italic">none derived</span>;
  }
  return (
    <>
      {rels.map((r) => (
        <div key={r.kind} className="flex justify-between items-start gap-3 border-b border-[rgba(255,255,255,0.04)] pb-1.5">
          <span className="text-[#8f95b2] text-[10px] font-semibold shrink-0">{r.kind}</span>
          <div className="text-right min-w-0">
            <span className="text-[11px] text-[#d0d4ea] font-mono break-all">{r.nodeIds.join(', ')}</span>
            <ProvenanceTag provenance="projection" />
          </div>
        </div>
      ))}
    </>
  );
}

function ProducedOutputs({ outputs }: { outputs: ProducedOutput[] }) {
  if (outputs.length === 0) {
    return <span className="text-[10px] text-[#5d6180] italic">none produced</span>;
  }
  return (
    <ul className="space-y-1.5">
      {outputs.map((output) => {
        return (
          <li key={`${output.type}-${output.id}`} className="text-[10px] text-[#9498b0]">
            <div className="flex items-center gap-2">
              <span className="text-[#d0d4ea] font-medium">{output.name}</span>
              <span className="text-[9px] text-[#5d6180]">({output.type})</span>
            </div>
            {output.value !== undefined && (
              <div className="mt-0.5">
                <JsonBlock value={output.value} />
              </div>
            )}
            <div className="text-[9px] text-[#6b708a] mt-0.5">seq #{output.sequence_num} · {formatTimestamp(output.timestamp)}</div>
          </li>
        );
      })}
    </ul>
  );
}

function RecentEvents({
  events,
  onViewEvidence,
  onJumpToEvent,
}: {
  events: RuntimeEventRef[];
  onViewEvidence?: (sequenceNum: number) => void;
  onJumpToEvent?: (sequenceNum: number) => void;
}) {
  if (events.length === 0) {
    return <span className="text-[10px] text-[#5d6180] italic">no recent events</span>;
  }
  return (
    <ul className="space-y-1">
      {events.map((ref) => (
        <li key={`${ref.sequence_num}-${ref.event_type}`} className="text-[10px] text-[#7b819f] flex items-start gap-1.5">
          <span className="text-[#34d399] shrink-0">✓</span>
          <span className="flex-1">{renderRuntimeEventRef(ref)}</span>
          <span className="text-[#5d6180] font-mono">#{ref.sequence_num}</span>
          {onJumpToEvent && (
            <button
              type="button"
              onClick={() => onJumpToEvent(ref.sequence_num)}
              className="text-[#818cf8] hover:text-[#a5b4fc] text-[9px]"
              title="Jump to event (ROPS §11)"
            >
              jump
            </button>
          )}
          {onViewEvidence && (
            <button
              type="button"
              onClick={() => onViewEvidence(ref.sequence_num)}
              className="text-[#06b6d4] hover:text-[#22d3ee] text-[9px]"
              title="View evidence (ROPS §11 L4)"
            >
              L4
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProvenanceBlock({ prov }: { prov: NonNullable<ReturnType<typeof envelopeProvenance>> }) {
  return (
    <div className="space-y-1.5 text-[10px]">
      <RopsFieldRow label="actor_type" field={prov.actorType} />
      <RopsFieldRow label="actor_id" field={prov.actorId} />
      <RopsFieldRow label="origin_framework" field={prov.originFramework} />
      {prov.model && (
        <div className="pt-1 space-y-1">
          <div className="text-[9px] text-[#6b708a]">Model</div>
          <RopsFieldRow label="provider" field={prov.model.provider} />
          <RopsFieldRow label="model_name" field={prov.model.modelName} />
          <RopsFieldRow label="model_version" field={prov.model.modelVersion} />
          <RopsFieldRow label="tokens_input" field={prov.model.tokensInput} formatter={String} />
          <RopsFieldRow label="tokens_output" field={prov.model.tokensOutput} formatter={String} />
          <RopsFieldRow label="temperature" field={prov.model.temperature} formatter={String} />
          <RopsFieldRow label="stop_reason" field={prov.model.stopReason} />
        </div>
      )}
      {prov.policy && (
        <div className="pt-1 space-y-1">
          <div className="text-[9px] text-[#6b708a]">Policy</div>
          <RopsFieldRow label="rule_id" field={prov.policy.ruleId} />
          <RopsFieldRow label="decision" field={prov.policy.decision} />
          <RopsFieldRow label="reason" field={prov.policy.reason} />
        </div>
      )}
      {prov.error && (
        <div className="pt-1 space-y-1">
          <div className="text-[9px] text-[#6b708a]">Error</div>
          <RopsFieldRow label="source" field={prov.error.source} />
          <RopsFieldRow label="cause" field={prov.error.cause} />
          <RopsFieldRow label="severity" field={prov.error.severity} />
          <RopsFieldRow label="recovery_action" field={prov.error.recoveryAction} />
        </div>
      )}
      {prov.causal && (
        <div className="pt-1 space-y-1">
          <div className="text-[9px] text-[#6b708a]">Causal</div>
          <RopsFieldRow label="parent_span_id" field={prov.causal.parentSpanId} />
          <RopsFieldRow label="tool_call_id" field={prov.causal.toolCallId} />
          <RopsFieldRow label="decision_for_event_id" field={prov.causal.decisionForEventId} />
          <RopsFieldRow label="triggered_by_event_id" field={prov.causal.triggeredByEventId} />
        </div>
      )}
      <div className="pt-1 space-y-1">
        <div className="text-[9px] text-[#6b708a]">Cryptographic Linkage</div>
        <RopsFieldRow label="content_hash" field={prov.contentHash} />
        <RopsFieldRow label="previous_hash" field={prov.previousHash} />
      </div>
    </div>
  );
}

function KeyValueList({ entries }: { entries: ReadonlyArray<readonly [string, unknown]> }) {
  return (
    <ul className="space-y-1">
      {entries.map(([k, v]) => (
        <li key={k} className="text-[10px]">
          <div className="text-[#8f95b2] font-mono">{k}</div>
          <div className="text-[#d0d4ea] mt-0.5">
            {typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : <JsonBlock value={v} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Render one correlated Evidence row in presentation-priority order. Scalar
 * values use the shared `RopsFieldRow` (with `not recorded` + provenance tag);
 * object/array values render the value via `JsonBlock` with a labeled header
 * and an Evidence provenance tag. All provenance is Evidence — packed by the
 * caller via `packEvidence`.
 */
function EvidenceRow({
  label,
  field,
}: {
  label: string;
  field: ReturnType<typeof packEvidence>;
}) {
  const v = field.value;
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return <RopsFieldRow label={label} field={field} />;
  }
  return (
    <div className="space-y-1 border-b border-[rgba(255,255,255,0.04)] pb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[#8f95b2] text-[10px] font-semibold shrink-0">{label}</span>
        <ProvenanceTag provenance="evidence" />
      </div>
      <JsonBlock value={v} />
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const preview = safePreview(value, 240);
  const isTruncated = preview.truncated;
  return (
    <div className="font-mono text-[9px] text-[#9da3bf] bg-[rgba(0,0,0,0.18)] rounded p-1.5 break-all">
      {open || !isTruncated ? preview.text : preview.text}
      {isTruncated && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="ml-1 text-[#818cf8] hover:text-[#a5b4fc]"
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}
