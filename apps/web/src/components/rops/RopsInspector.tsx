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
  ProjectionProfile,
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
  buildMissionView,
  buildProfileEvidenceRows,
  buildRuntimeAgentStateView,
  deriveRelationships,
  envelopeProvenance,
  formatDurationMs,
  formatTimestamp,
  packEvidence,
  splitPayload,
  type AgentView,
  type EnvelopeProvenance,
  type MissionView,
  type RopsField,
} from '@/lib/rops/provenance';
import { collectNodeEvidence } from '@/lib/rops/nodeEvidence';
import { RopsFieldRow, RopsSection, ProvenanceTag } from './primitives';
import { safePreview } from '@/lib/safePreview';

export interface RopsInspectorInput {
  /** The selected graph node (Evidence source for non-agent objects). */
  readonly node: GraphNode | null;
  /** The agent projection, when the node is an agent (authoritative L3 source). */
  readonly agentProjection: RuntimeNodeProjection | null;
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
// Profile resolution + dispatch (spec P1 — ProjectionProfile presentation)
// ---------------------------------------------------------------------------
// `projection_profile` on `GraphNode` is presentation metadata (see
// packages/protocol/src/types.ts). It selects the inspector component and the
// first-class Evidence rows; it NEVER re-maps `GraphNode.type`, merges nodes,
// hides nodes, or invents a synthetic hierarchy (workflow topology invariants).
// When a legacy snapshot lacks a profile, the stable `NodeType` union maps to a
// default profile — this is a presentation default only, not a runtime re-map.

function resolveProfile(node: GraphNode): ProjectionProfile {
  if (node.projection_profile) return node.projection_profile;
  switch (node.type) {
    case 'tool': return 'tool';
    case 'memory': return 'memory';
    case 'artifact': return 'artifact';
    case 'task': return 'workflow_step';
    case 'human': return 'human';
    case 'agent': return 'agent';
    default: return 'generic';
  }
}

export function RopsInspector(input: RopsInspectorInput) {
  const { node } = input;
  if (!node && !input.interrupt && !input.branch && !input.snapshot && !input.mission) {
    return <EmptyInspector />;
  }

  // Determine the ROPS object type from the strongest available evidence.
  if (input.interrupt) return <InterruptInspector input={input} />;
  if (input.branch && !node) return <BranchInspector input={input} />;
  if (input.snapshot && !node) return <CheckpointInspector input={input} />;
  if (!node) {
    // A Mission record without a projected node: render the Mission view.
    if (input.mission) return <MissionInspector input={input} />;
    return <EmptyInspector />;
  }

  if (node.type === 'agent' && input.agentProjection) return <AgentInspector input={input} />;
  if (node.type === 'agent' && input.runtimeAgentState) return <RuntimeAgentStateInspector input={input} />;

  // Non-agent nodes dispatch on (type, projection_profile). Profile selects the
  // inspector + first-class rows; `GraphNode.type` remains the runtime identity.
  const profile = resolveProfile(node);
  switch (profile) {
    case 'llm': return <LlmInspector input={input} />;
    case 'retrieval': return <RetrievalInspector input={input} />;
    case 'tool': return <ToolInspector input={input} />;
    case 'memory': return <MemoryInspector input={input} />;
    case 'artifact': return <ArtifactInspector input={input} />;
    case 'workflow_step': return <WorkflowStepInspector input={input} />;
    case 'mission': return <MissionInspector input={input} />;
    case 'checkpoint': return <CheckpointNodeInspector input={input} />;
    case 'human': return <HumanInspector input={input} />;
    default: return <ProfileNodeInspector input={input} profile="generic" />;
  }
}

// ---------------------------------------------------------------------------
// Named profile inspectors — thin wrappers over the shared shell. Each names
// the profile + header label; the shell owns the 7-section rendering.
// ---------------------------------------------------------------------------

function LlmInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="llm" objectType="LLMCall" />;
}
function RetrievalInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="retrieval" objectType="Retrieval" />;
}
function ToolInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="tool" objectType="ToolInvocation" />;
}
function MemoryInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="memory" objectType="Memory" />;
}
function ArtifactInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="artifact" objectType="Artifact" />;
}
function CheckpointNodeInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="checkpoint" objectType="Checkpoint" />;
}
function HumanInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="human" objectType="Human" />;
}

// ---------------------------------------------------------------------------
// Shared profile node shell (spec 9.3 — fixed 7-section order)
// ---------------------------------------------------------------------------

function ProfileNodeInspector({
  input,
  profile,
  objectType,
}: {
  input: RopsInspectorInput;
  profile: ProjectionProfile;
  objectType?: string;
}) {
  const { node, edges, eventEnvelope, eventEnvelopes, agentProjection } = input;
  if (!node) return <EmptyInspector />;
  const view = buildGraphNodeView(node);
  const rels = deriveRelationships(node.id, edges);
  const prov = envelopeProvenance(eventEnvelope);
  const payload = (node.metadata ?? {}) as Record<string, unknown>;
  // Pure correlation: tool I/O, search query/result count, retrieval backend,
  // failure reason — pulled verbatim from envelopes sharing this node's span.
  const evidence = collectNodeEvidence(node, eventEnvelopes, agentProjection);
  // Profile rows promote standardized fields to first-class Evidence and return
  // the payload with consumed keys removed so they do not duplicate in the raw
  // section (raw boundary invariants — no PAYLOAD_WHITELIST expansion).
  const { rows, leftoverPayload } = buildProfileEvidenceRows(profile, payload, evidence, prov);
  const { recognized, unrecognized } = splitPayload(leftoverPayload);
  const hasProfileRows = rows.some((r) => !r.field.absent);
  const producedOutputs = evidence.producedOutputs ?? [];

  return (
    <PanelShell
      objectType={objectType ?? view.objectType}
      name={view.label.value ?? '—'}
      profile={profile}
    >
      <RopsSection title="Identity">
        <RopsFieldRow label="label" field={view.label} />
        <RopsFieldRow label="id" field={view.id} />
        <RopsFieldRow label="node_type" field={view.nodeType} />
        {view.role.value && <RopsFieldRow label="role" field={view.role} />}
        {view.agentId.value && <RopsFieldRow label="agent_id" field={view.agentId} />}
        {view.framework.value && <RopsFieldRow label="framework" field={view.framework} />}
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
        {hasProfileRows || recognized.length > 0 || unrecognized.length > 0 ? (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <EvidenceRow key={r.label} label={r.label} field={r.field} />
            ))}
            {recognized.length > 0 && (
              <div className={hasProfileRows ? 'pt-1.5' : ''}>
                {hasProfileRows && (
                  <div className="text-[9px] uppercase tracking-[0.12em] text-[#5d6180] mb-1">Other payload</div>
                )}
                <KeyValueList entries={recognized} />
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
          <span className="text-[10px] text-[#5d6180] italic">no recognized payload keys</span>
        )}
      </RopsSection>

      <RopsSection title="Relationships">
        <DerivedRelationshipRows rels={rels} />
        <RopsFieldRow label="span_id" field={view.spanId} />
        <RopsFieldRow label="source_span_id" field={view.sourceSpanId} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>

      <RopsSection title="Statistics">
        <RopsFieldRow label="error_count" field={view.errorCount} />
        {producedOutputs.length > 0 && (
          <RopsFieldRow
            label="produced_outputs"
            field={packEvidence('produced_outputs', producedOutputs.length)}
            formatter={String}
          />
        )}
      </RopsSection>

      <ErrorSection prov={prov} />

      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Mission inspector — Mission record (and/or a mission-profile node)
// ---------------------------------------------------------------------------

function MissionInspector({ input }: { input: RopsInspectorInput }) {
  const { mission, node, edges, eventEnvelope } = input;
  const prov = envelopeProvenance(eventEnvelope);
  if (!mission && !node) return <EmptyInspector />;

  // Mission record identity (spec 3.1) when available.
  const mview: MissionView | null = mission ? buildMissionView(mission) : null;
  // A mission-profile node contributes its raw payload (basestation.aiops.*
  // stays verbatim — nothing is promoted for the mission profile).
  const payload = (node?.metadata ?? {}) as Record<string, unknown>;
  const { recognized, unrecognized } = splitPayload(payload);
  const rels = node ? deriveRelationships(node.id, edges) : [];

  return (
    <PanelShell objectType="Mission" name={mview?.id.value ?? node?.label ?? '—'} profile="mission">
      <RopsSection title="Identity">
        {mview && <RopsFieldRow label="mission_id" field={mview.id} />}
        {mview && <RopsFieldRow label="objective" field={mview.objective} />}
        {node && <RopsFieldRow label="label" field={buildGraphNodeView(node).label} />}
        {node && <RopsFieldRow label="node_type" field={buildGraphNodeView(node).nodeType} />}
        {mview && <RopsFieldRow label="owner_id" field={mview.ownerId} />}
      </RopsSection>

      <RopsSection title="Lifecycle">
        {mview && <RopsFieldRow label="status" field={mview.status} />}
        {mview && <RopsFieldRow label="phase" field={mview.phase} />}
        {mview && <RopsFieldRow label="created_at" field={mview.createdAt} formatter={formatTimestamp} />}
        {mview && <RopsFieldRow label="updated_at" field={mview.updatedAt} formatter={formatTimestamp} />}
        {mview && <RopsFieldRow label="completed_at" field={mview.completedAt} formatter={formatTimestamp} />}
      </RopsSection>

      <RopsSection title="Payload">
        {recognized.length > 0 || unrecognized.length > 0 ? (
          <div className="space-y-1.5">
            {recognized.length > 0 && <KeyValueList entries={recognized} />}
            {unrecognized.length > 0 && (
              <div className={recognized.length > 0 ? 'pt-1.5' : ''}>
                <div className="text-[9px] text-[#6b708a] mb-1">
                  Payload keys not in the ROPS whitelist (spec 8.2). Shown verbatim, never interpreted.
                </div>
                <KeyValueList entries={unrecognized} />
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-[#5d6180] italic">no payload</span>
        )}
      </RopsSection>

      {node && (
        <RopsSection title="Relationships">
          <DerivedRelationshipRows rels={rels} />
          <RopsFieldRow label="source_span_id" field={buildGraphNodeView(node).sourceSpanId} />
        </RopsSection>
      )}

      <ErrorSection prov={prov} />

      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Error section — surfaced when the correlated envelope carries error.*
// (ErrorAttribution). Rendered as a dedicated section so failures are
// prominent rather than buried in the L4 provenance block.
// ---------------------------------------------------------------------------

function ErrorSection({ prov }: { prov: EnvelopeProvenance | null }) {
  const err = prov?.error;
  if (!err) return null;
  const hasAny =
    !err.source.absent || !err.cause.absent || !err.severity.absent ||
    !err.recoveryAction.absent || !err.originalError.absent;
  if (!hasAny) return null;
  return (
    <RopsSection title="Error">
      <RopsFieldRow label="source" field={err.source} />
      <RopsFieldRow label="cause" field={err.cause} />
      <RopsFieldRow label="severity" field={err.severity} />
      <RopsFieldRow label="recovery_action" field={err.recoveryAction} />
      <RopsFieldRow label="original_error" field={err.originalError} />
    </RopsSection>
  );
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
  const { agentProjection, node, edges, eventEnvelope } = input;
  if (!agentProjection) return <EmptyInspector />;
  const view = buildAgentView(agentProjection);
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

      <ErrorSection prov={prov} />

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
      <ErrorSection prov={prov} />
      {prov && (
        <RopsSection title="Provenance">
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// WorkflowStep inspector (profile="workflow_step") — spec 9.3
// ---------------------------------------------------------------------------

function WorkflowStepInspector({ input }: { input: RopsInspectorInput }) {
  return <ProfileNodeInspector input={input} profile="workflow_step" objectType="WorkflowStep" />;
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
      <ErrorSection prov={prov} />
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

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function PanelShell({
  objectType,
  name,
  profile,
  children,
}: {
  objectType: string;
  name: string;
  profile?: ProjectionProfile;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#818cf8]" />
          <span className="text-[9px] uppercase tracking-[0.12em] text-[#818cf8] font-bold">ROPS Inspector</span>
        </div>
        <div className="flex items-center gap-1.5">
          {profile && (
            <span className="text-[9px] bg-[rgba(45,212,191,0.08)] text-[#5eead4] border border-[#2dd4bf]/20 px-1.5 py-0.5 rounded-md font-mono lowercase tracking-wide">
              {profile}
            </span>
          )}
          <span className="text-[9px] bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] border border-[#6366f1]/20 px-2 py-0.5 rounded-md font-mono uppercase tracking-wide">
            {objectType}
          </span>
        </div>
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
  field: RopsField<unknown>;
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
