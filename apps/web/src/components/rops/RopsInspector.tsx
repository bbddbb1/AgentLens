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
import type { EventEnvelope, GraphEdge, GraphNode, ProducedOutput, ProjectionProfile, RuntimeEventRef, RuntimeNodeProjection } from '@agentlens/protocol';
import { renderRuntimeEventRef } from '@agentlens/protocol';
import { buildAgentView, buildGraphNodeView, buildInterruptView, buildInterruptViewFromState, buildBranchView, buildCheckpointView, buildMissionView, buildProfileEvidenceRows, buildRuntimeAgentStateView, deriveRelationships, envelopeProvenance, formatDurationMs, formatTimestamp, packEvidence, resolveRelationshipTargets, splitPayload, type AgentView, type EnvelopeProvenance, type MissionView, type RopsField } from '@/lib/rops/provenance';
import { collectNodeEvidence } from '@/lib/rops/nodeEvidence';
import { isRedactionValue, resolveNormalizedIoDisplay } from '@/lib/rops/fieldCondition';
import { MissingFieldsProvider, RopsFieldRow, RopsSection, ProvenanceTag } from './primitives';
import { L3_COLLAPSED_PREVIEW_MAX, L3_EXPANDED_PREVIEW_MAX, safePreview } from '@/lib/safePreview';

function displayText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function packProjection<T>(key: string, value: T | undefined | null): RopsField<T> {
  return {
    key,
    provenance: 'projection',
    value: value === null ? undefined : value,
    absent: value === undefined || value === null,
  };
}

export interface RopsInspectorInput {
  /** The selected graph node (Evidence source for non-agent objects). */
  readonly node: GraphNode | null;
  /** The agent projection, when the node is an agent (authoritative L3 source). */
  readonly agentProjection: RuntimeNodeProjection | null;
  /** Edges in the current snapshot (for relationship derivation). */
  edges: readonly GraphEdge[];
  /** Nodes in the current snapshot, used only to resolve relationship labels. */
  nodes: readonly GraphNode[];
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
  /** Navigate to a related runtime activity. */
  onSelectNode?: (nodeId: string) => void;
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
    case 'tool':
      return 'tool';
    case 'memory':
      return 'memory';
    case 'artifact':
      return 'artifact';
    case 'task':
      return 'workflow_step';
    case 'human':
      return 'human';
    case 'agent':
      return 'agent';
    default:
      return 'generic';
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
    case 'llm':
      return <LlmInspector input={input} />;
    case 'retrieval':
      return <RetrievalInspector input={input} />;
    case 'tool':
      return <ToolInspector input={input} />;
    case 'memory':
      return <MemoryInspector input={input} />;
    case 'artifact':
      return <ArtifactInspector input={input} />;
    case 'workflow_step':
      return <WorkflowStepInspector input={input} />;
    case 'mission':
      return <MissionInspector input={input} />;
    case 'checkpoint':
      return <CheckpointNodeInspector input={input} />;
    case 'human':
      return <HumanInspector input={input} />;
    default:
      return <ProfileNodeInspector input={input} profile="generic" />;
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

function ProfileNodeInspector({ input, profile, objectType }: { input: RopsInspectorInput; profile: ProjectionProfile; objectType?: string }) {
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
  const { recognized } = splitPayload(leftoverPayload);
  const hasProfileRows = rows.some((r) => !r.field.absent);
  const producedOutputs = evidence.producedOutputs ?? [];
  const openViewEvidence = input.onViewEvidence && eventEnvelope ? () => input.onViewEvidence!(eventEnvelope.sequence_num) : undefined;

  return (
    <PanelShell objectType={objectType ?? view.objectType} name={view.label.value ?? '—'} profile={profile}>
      <SelectedActivityPrioritySection node={node} view={view} evidence={evidence} rels={rels} nodes={input.nodes} />
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

      <RopsSection title="Payload" collapsible defaultOpen={false}>
        {hasProfileRows || recognized.length > 0 ? (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <EvidenceRow key={r.label} label={r.label} field={r.field} onViewEvidence={openViewEvidence} />
            ))}
            {recognized.length > 0 && (
              <div className={hasProfileRows ? 'pt-1.5' : ''}>
                {hasProfileRows && <div className="mb-1 text-[10px] uppercase tracking-[0.1em] text-text-muted">Other payload</div>}
                <KeyValueList entries={recognized} onViewEvidence={openViewEvidence} />
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] italic text-text-muted">no recognized payload keys</span>
        )}
      </RopsSection>

      <RopsSection title="Relationships" collapsible defaultOpen={false}>
        <DerivedRelationshipRows rels={rels} nodes={input.nodes} onSelectNode={input.onSelectNode} />
        <RopsFieldRow label="span_id" field={view.spanId} />
        <RopsFieldRow label="source_span_id" field={view.sourceSpanId} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>

      <RopsSection title="Statistics" collapsible defaultOpen={false}>
        <RopsFieldRow label="error_count" field={view.errorCount} />
        {producedOutputs.length > 0 && <RopsFieldRow label="produced_outputs" field={packEvidence('produced_outputs', producedOutputs.length)} formatter={String} />}
      </RopsSection>

      <ErrorSection prov={prov} />

      {prov && (
        <RopsSection title="Provenance" collapsible defaultOpen={false}>
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
  // A mission-profile node contributes raw workload payload only; Core does
  // not promote workload-specific keys.
  const payload = (node?.metadata ?? {}) as Record<string, unknown>;
  const { recognized } = splitPayload(payload);
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

      <RopsSection title="Payload" collapsible defaultOpen={false}>
        {recognized.length > 0 ? <div className="space-y-1.5">{recognized.length > 0 && <KeyValueList entries={recognized} />}</div> : <span className="text-[10px] italic text-text-muted">no payload</span>}
      </RopsSection>

      {node && (
        <RopsSection title="Relationships" collapsible defaultOpen={false}>
          <DerivedRelationshipRows rels={rels} nodes={input.nodes} onSelectNode={input.onSelectNode} />
          <RopsFieldRow label="source_span_id" field={buildGraphNodeView(node).sourceSpanId} />
        </RopsSection>
      )}

      <ErrorSection prov={prov} />

      {prov && (
        <RopsSection title="Provenance" collapsible defaultOpen={false}>
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
  const hasAny = !err.source.absent || !err.cause.absent || !err.severity.absent || !err.recoveryAction.absent || !err.originalError.absent;
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
    <div className="rounded-sm border border-border-subtle bg-bg-secondary p-6 text-center">
      <div className="text-[12px] text-text-secondary">Select a runtime object to inspect.</div>
      <div className="mt-1 text-[11px] text-text-muted">Identity, lifecycle, payload, relationships, statistics, and provenance will display here.</div>
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
      {node && <SelectedActivityPrioritySection node={node} view={view} evidence={collectNodeEvidence(node, input.eventEnvelopes, agentProjection)} rels={rels} nodes={input.nodes} />}
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

      <RopsSection title="Payload" collapsible defaultOpen={false}>
        <ProducedOutputs outputs={view.producedOutputs.value ?? []} />
      </RopsSection>

      <RopsSection title="Relationships" collapsible defaultOpen={false}>
        <RopsFieldRow label="next_transition" field={view.nextTransition} formatter={(t) => `→ ${t.target} (${t.kind})${t.reason ? ` — ${t.reason}` : ''}`} />
        <DerivedRelationshipRows rels={rels} nodes={input.nodes} onSelectNode={input.onSelectNode} />
        <RopsFieldRow label="source_span_id" field={view.sourceSpanId} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>

      <RopsSection title="Statistics" collapsible defaultOpen={false}>
        <RopsFieldRow label="error_count" field={view.errorCount} />
        <RopsFieldRow label="produced_outputs" field={view.producedOutputs} formatter={(o) => String(o.length)} />
      </RopsSection>

      <ErrorSection prov={prov} />

      {prov && (
        <RopsSection title="Provenance" collapsible defaultOpen={false}>
          <ProvenanceBlock prov={prov} />
        </RopsSection>
      )}

      <RopsSection title="Evidence" collapsible defaultOpen={false}>
        <RecentEvents events={view.recentRuntimeEvents.value ?? []} onViewEvidence={input.onViewEvidence} onJumpToEvent={input.onJumpToEvent} />
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
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle pb-1.5">
      <span className="shrink-0 text-[10px] font-semibold text-text-muted">confidence</span>
      <div className="text-right">
        <span className="text-[11px] text-text-secondary">{Math.round((f.value ?? 0) * 100)}%</span>
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
      {node && <SelectedActivityPrioritySection node={node} view={view} evidence={collectNodeEvidence(node, input.eventEnvelopes, null)} rels={rels} nodes={input.nodes} />}
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
      <RopsSection title="Payload" collapsible defaultOpen={false}>
        <RopsFieldRow label="summary" field={view.summary} />
      </RopsSection>
      <RopsSection title="Relationships" collapsible defaultOpen={false}>
        <DerivedRelationshipRows rels={rels} nodes={input.nodes} onSelectNode={input.onSelectNode} />
      </RopsSection>
      <RopsSection title="Statistics" collapsible defaultOpen={false}>
        <RopsFieldRow label="history" field={view.history} formatter={(h) => `${h.length} events`} />
      </RopsSection>
      <ErrorSection prov={prov} />
      {prov && (
        <RopsSection title="Provenance" collapsible defaultOpen={false}>
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
  const view = isRecord ? buildInterruptView(interrupt as import('@agentlens/protocol').InterruptRecord) : buildInterruptViewFromState(interrupt as import('@agentlens/protocol').RuntimeInterruptState);
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
      <RopsSection title="Payload" collapsible defaultOpen={false}>
        <RopsFieldRow label="reason" field={view.reason} />
        <RopsFieldRow label="decision" field={view.decision} />
        <RopsFieldRow label="decision_comment" field={view.decisionComment} />
        <RopsFieldRow label="resume_url" field={view.resumeUrl} />
        {view.payload.value && (
          <div className="pt-1">
            <div className="mb-1 text-[10px] text-text-muted">payload</div>
            <JsonBlock value={view.payload.value} />
          </div>
        )}
        {view.decisionPayload.value && (
          <div className="pt-1">
            <div className="mb-1 text-[10px] text-text-muted">decision_payload</div>
            <JsonBlock value={view.decisionPayload.value} />
          </div>
        )}
      </RopsSection>
      <RopsSection title="Relationships" collapsible defaultOpen={false}>
        <RopsFieldRow label="agent_id" field={view.agentId} />
        <RopsFieldRow label="span_id" field={view.spanId} />
      </RopsSection>
      <ErrorSection prov={prov} />
      {prov && (
        <RopsSection title="Provenance" collapsible defaultOpen={false}>
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
      <RopsSection title="Relationships" collapsible defaultOpen={false}>
        <RopsFieldRow label="parent_branch_id" field={view.parentBranchId} />
        <RopsFieldRow label="forked_from_sequence_num" field={view.forkedFromSequenceNum} formatter={(v) => `#${v}`} />
      </RopsSection>
      {view.metadata.value && Object.keys(view.metadata.value).length > 0 && (
        <RopsSection title="Recorded Attributes (metadata)" collapsible defaultOpen={false}>
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
      <RopsSection title="Payload" collapsible defaultOpen={false}>
        <RopsFieldRow label="event_type" field={view.triggeringEventType} />
        <RopsFieldRow label="event_description" field={view.triggeringEventDescription} />
        <RopsFieldRow label="source_event_id" field={view.sourceEventId} />
      </RopsSection>
      <RopsSection title="Statistics" collapsible defaultOpen={false}>
        <RopsFieldRow label="node_count" field={view.nodeCount} formatter={String} />
        <RopsFieldRow label="edge_count" field={view.edgeCount} formatter={String} />
      </RopsSection>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function SelectedActivityPrioritySection({
  node,
  view,
  evidence,
  rels,
  nodes,
}: {
  node: GraphNode;
  view: {
    label?: RopsField;
    name?: RopsField;
    statusLabel: RopsField;
    status: RopsField;
  };
  evidence: import('@/lib/rops/nodeEvidence').NodeCorrelatedEvidence;
  rels: ReturnType<typeof deriveRelationships>;
  nodes: readonly GraphNode[];
}) {
  const activity = node.activity;
  if (!activity && !evidence.toolInput && !evidence.toolOutput && !evidence.failureReason && rels.length === 0) {
    return null;
  }

  const downstreamNodes = rels
    .filter((rel) => rel.kind === 'children' || rel.kind === 'dependency')
    .flatMap((rel) => resolveRelationshipTargets(rel.nodeIds, nodes))
    .map((item) => item.label)
    .slice(0, 3);

  const record = activity?.operator_facing_record;
  const outcomeText = displayText(record?.status_or_outcome.value ?? activity?.outcome ?? view.statusLabel.value ?? view.status.value, 'unknown');
  const viewTitle = view.label?.value ?? view.name?.value;
  const activityTitle = displayText(record?.primary_label ?? activity?.title ?? activity?.label ?? activity?.action ?? viewTitle, 'Activity');
  const actionText = displayText(record?.action.value ?? activity?.action ?? viewTitle, 'Activity');
  const triggerValue = record?.trigger.value ?? activity?.subtitle ?? activity?.action ?? viewTitle;
  const triggerText = typeof triggerValue === 'string' && triggerValue.length > 0 ? triggerValue : undefined;
  const errorOrWaitReason = evidence.failureReason ?? evidence.failureCause;
  const errorOrWaitField = errorOrWaitReason !== undefined ? packEvidence('error_or_wait_reason', errorOrWaitReason) : packProjection('error_or_wait_reason', record?.status_or_outcome.value === 'Waiting' ? (record.evidence_condition.value ?? 'waiting') : undefined);
  const downstreamValue = record?.downstream_effect.value ?? (downstreamNodes.length > 0 ? downstreamNodes.join(', ') : undefined);
  const artifactValue = record?.artifacts.value ?? (evidence.producedOutputs !== undefined ? evidence.producedOutputs.length : undefined);
  const storySufficiency = record ? (record.story_critical_sufficient ? 'sufficient' : 'limited') : undefined;

  return (
    <RopsSection title="Selected activity">
      <div className="space-y-1.5 rounded-sm border border-accent/25 bg-accent-soft p-2">
        <div className="text-[11px] font-medium text-text-secondary">
          {activityTitle}
          <span className="mx-1.5 text-text-faint">|</span>
          <span>{actionText}</span>
          <span className="mx-1.5 text-text-faint">|</span>
          <span className={activity?.status === 'failed' ? 'text-error' : activity?.status === 'waiting' ? 'text-warning' : 'text-text-primary'}>{outcomeText}</span>
          {activity?.duration_ms !== undefined && <span className="text-text-muted"> | {formatDurationMs(activity.duration_ms)}</span>}
          <ProvenanceTag provenance="projection" />
        </div>
        {activity?.subtitle && <div className="font-mono text-[10px] text-text-muted">{activity.subtitle}</div>}
        {record?.limitation && <div className="text-[10px] text-warning">{record.limitation}</div>}
        <div className="grid gap-1.5 text-[10px]">
          <RopsFieldRow label="trigger" field={packProjection('trigger', triggerText)} />
          <NormalizedIoFieldRow label="inputs" field="input" recordField={record?.input} />
          <NormalizedIoFieldRow label="outputs" field="output" recordField={record?.output} />
          <RopsFieldRow label="error_or_wait_reason" field={errorOrWaitField} />
          <RopsFieldRow label="downstream_activity" field={packProjection('downstream_activity', downstreamValue)} />
          <RopsFieldRow label="artifacts" field={packProjection('artifacts', artifactValue)} />
          <RopsFieldRow label="story_sufficiency" field={packProjection('story_sufficiency', storySufficiency)} />
        </div>
      </div>
    </RopsSection>
  );
}

function PanelShell({ objectType, name, profile, children }: { objectType: string; name: string; profile?: ProjectionProfile; children: React.ReactNode }) {
  const [showMissing, setShowMissing] = useState(false);
  return (
    <div className="space-y-3 rounded-sm border border-border-subtle bg-bg-secondary p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Inspector</span>
        </div>
        <div className="flex items-center gap-1.5">
          {profile && <span className="font-mono text-[10px] lowercase tracking-wide text-text-muted">{profile}</span>}
          <span className="border-l border-border-default pl-1.5 font-mono text-[10px] uppercase tracking-wide text-text-secondary">{objectType}</span>
        </div>
      </div>
      <div className="text-[13px] font-semibold tracking-wide text-text-primary">{name}</div>
      <div className="flex items-center justify-between rounded-sm bg-bg-tertiary px-2 py-1 text-[10px] text-text-muted">
        <span>{showMissing ? 'Observed and absent fields' : 'Observed fields · optional gaps hidden'}</span>
        <button type="button" onClick={() => setShowMissing((value) => !value)} className="rounded-sm px-1 py-0.5 text-accent hover:bg-bg-hover hover:text-accent-strong">
          {showMissing ? 'Hide missing fields' : 'Show missing fields'}
        </button>
      </div>
      <MissingFieldsProvider showMissing={showMissing}>{children}</MissingFieldsProvider>
    </div>
  );
}

function DerivedRelationshipRows({ rels, nodes, onSelectNode }: { rels: ReturnType<typeof deriveRelationships>; nodes: readonly GraphNode[]; onSelectNode?: (nodeId: string) => void }) {
  if (rels.length === 0) {
    return <span className="text-[10px] italic text-text-muted">none derived</span>;
  }
  const relationshipLabels: Record<string, string> = {
    parent: 'Triggered by',
    children: 'Next',
    producer: 'Produced by',
    consumer: 'Produced',
    dependency: 'Called',
  };
  return (
    <>
      {rels.map((r) => (
        <div key={r.kind} className="flex items-start justify-between gap-3 border-b border-border-subtle pb-1.5">
          <span className="shrink-0 text-[10px] font-semibold text-text-muted">{relationshipLabels[r.kind] ?? r.kind}</span>
          <div className="min-w-0 space-y-1 text-right">
            {resolveRelationshipTargets(r.nodeIds, nodes).map((target) => {
              return (
                <button key={target.id} type="button" onClick={() => onSelectNode?.(target.id)} disabled={!onSelectNode || !target.resolved} className="block w-full text-right text-[10px] text-text-secondary hover:text-accent-strong disabled:hover:text-text-secondary" title={target.resolved ? `Open ${target.label}` : `Unresolved runtime id: ${target.id}`}>
                  {target.label}
                  {target.resolved && (
                    <span className="ml-1 text-[10px] text-text-muted">
                      · {target.type} · {target.status}
                    </span>
                  )}
                </button>
              );
            })}
            <ProvenanceTag provenance="projection" />
          </div>
        </div>
      ))}
    </>
  );
}

function ProducedOutputs({ outputs }: { outputs: ProducedOutput[] }) {
  if (outputs.length === 0) {
    return <span className="text-[10px] italic text-text-muted">none produced</span>;
  }
  return (
    <ul className="space-y-1.5">
      {outputs.map((output) => {
        return (
          <li key={`${output.type}-${output.id}`} className="text-[10px] text-text-secondary">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary">{output.name}</span>
              <span className="text-[10px] text-text-muted">({output.type})</span>
            </div>
            {output.value !== undefined && (
              <div className="mt-0.5">
                <JsonBlock value={output.value} />
              </div>
            )}
            <div className="mt-0.5 text-[10px] text-text-muted">
              seq #{output.sequence_num} · {formatTimestamp(output.timestamp)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RecentEvents({ events, onViewEvidence, onJumpToEvent }: { events: RuntimeEventRef[]; onViewEvidence?: (sequenceNum: number) => void; onJumpToEvent?: (sequenceNum: number) => void }) {
  if (events.length === 0) {
    return <span className="text-[10px] italic text-text-muted">no recent events</span>;
  }
  return (
    <ul className="space-y-1">
      {events.map((ref) => (
        <li key={`${ref.sequence_num}-${ref.event_type}`} className="flex items-start gap-1.5 text-[10px] text-text-muted">
          <span className="shrink-0 text-success">✓</span>
          <span className="flex-1">{renderRuntimeEventRef(ref)}</span>
          <span className="font-mono text-text-faint">#{ref.sequence_num}</span>
          {onJumpToEvent && (
            <button type="button" onClick={() => onJumpToEvent(ref.sequence_num)} className="text-[10px] text-accent hover:text-accent-strong" title="Jump to event (ROPS §11)">
              jump
            </button>
          )}
          {onViewEvidence && (
            <button type="button" onClick={() => onViewEvidence(ref.sequence_num)} className="text-[10px] text-accent hover:text-accent-strong" title="View evidence (ROPS §11 L4)">
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
          <div className="text-[10px] text-text-muted">Model</div>
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
          <div className="text-[10px] text-text-muted">Policy</div>
          <RopsFieldRow label="rule_id" field={prov.policy.ruleId} />
          <RopsFieldRow label="decision" field={prov.policy.decision} />
          <RopsFieldRow label="reason" field={prov.policy.reason} />
        </div>
      )}
      {prov.causal && (
        <div className="pt-1 space-y-1">
          <div className="text-[10px] text-text-muted">Causal</div>
          <RopsFieldRow label="parent_span_id" field={prov.causal.parentSpanId} />
          <RopsFieldRow label="tool_call_id" field={prov.causal.toolCallId} />
          <RopsFieldRow label="decision_for_event_id" field={prov.causal.decisionForEventId} />
          <RopsFieldRow label="triggered_by_event_id" field={prov.causal.triggeredByEventId} />
        </div>
      )}
    </div>
  );
}

function NormalizedIoFieldRow({ label, field, recordField }: { label: string; field: 'input' | 'output'; recordField: import('@agentlens/protocol').RuntimeActivityField | undefined }) {
  const display = resolveNormalizedIoDisplay(recordField, field);
  return (
    <RopsFieldRow
      label={label}
      field={{
        key: label,
        provenance: 'projection',
        value: display.text,
        absent: false,
      }}
    />
  );
}

function KeyValueList({ entries, onViewEvidence }: { entries: ReadonlyArray<readonly [string, unknown]>; onViewEvidence?: () => void }) {
  return (
    <ul className="space-y-1">
      {entries.map(([k, v]) => (
        <li key={k} className="text-[10px]">
          <div className="font-mono text-text-muted">{k}</div>
          <div className="mt-0.5 text-text-secondary">{typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : <JsonBlock value={v} onViewEvidence={onViewEvidence} />}</div>
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
function EvidenceRow({ label, field, onViewEvidence }: { label: string; field: RopsField<unknown>; onViewEvidence?: () => void }) {
  const v = field.value;
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return <RopsFieldRow label={label} field={field} />;
  }
  return (
    <div className="space-y-1 border-b border-border-subtle pb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-semibold text-text-muted">{label}</span>
        <ProvenanceTag provenance="evidence" />
      </div>
      <JsonBlock value={v} onViewEvidence={onViewEvidence} />
    </div>
  );
}

/** L3 JSON preview with expand + L4 fallback (rops.md §7.4 / §8.3). */
function JsonBlock({ value, onViewEvidence }: { value: unknown; onViewEvidence?: () => void }) {
  const [open, setOpen] = useState(false);
  if (isRedactionValue(value)) {
    return <span className="text-[10px] italic text-warning">redacted</span>;
  }
  const collapsed = safePreview(value, L3_COLLAPSED_PREVIEW_MAX);
  const expanded = safePreview(value, L3_EXPANDED_PREVIEW_MAX);
  const display = open ? expanded : collapsed;
  const canExpand = collapsed.truncated;
  const needsL4 = open && expanded.truncated;

  return (
    <div className="break-all rounded-sm bg-bg-primary p-1.5 font-mono text-[10px] text-text-secondary">
      {display.text}
      {!open && canExpand && (
        <button type="button" onClick={() => setOpen(true)} className="ml-1 text-accent hover:text-accent-strong">
          more
        </button>
      )}
      {open && !needsL4 && canExpand && (
        <button type="button" onClick={() => setOpen(false)} className="ml-1 text-accent hover:text-accent-strong">
          less
        </button>
      )}
      {needsL4 && onViewEvidence && (
        <button type="button" onClick={onViewEvidence} className="ml-1 text-accent hover:text-accent-strong">
          View evidence
        </button>
      )}
    </div>
  );
}
