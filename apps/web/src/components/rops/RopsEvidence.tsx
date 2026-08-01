/**
 * ROPS Level 4 — Evidence View (spec section 5.2 R-6 / 6 / 9.4 / 11).
 *
 * Shows the recorded `EventEnvelope` and its `payload` / `metadata`
 * / `model` / `causal` / `policy` / `error` verbatim. L4 compares a projection
 * with recorded span-backed evidence.
 *
 * Nothing is interpreted. Unrecognized payload/metadata keys appear verbatim
 * under "Recorded Attributes" (spec 8.2). No truncation of recorded evidence (spec 7.4):
 * wrap/scroll only.
 */
'use client';

import { useState } from 'react';
import { Copy, CheckCircle2, X, FileText } from 'lucide-react';
import type { EventEnvelope } from '@agentlens/protocol';
import { formatTimestamp, splitPayload } from '@/lib/rops/provenance';

export interface RopsEvidenceProps {
  envelope: EventEnvelope | null;
  onClose?: () => void;
}

export function RopsEvidence({ envelope, onClose }: RopsEvidenceProps) {
  if (!envelope) {
    return (
      <div className="rounded-sm border border-dashed border-border-default bg-bg-secondary p-6 text-center">
        <FileText size={20} className="mx-auto mb-2 text-text-muted" />
        <div className="text-[12px] text-text-secondary">No evidence selected.</div>
        <div className="mt-1 text-[11px] text-text-muted">Use the L4 action on an inspector field or event to open the recorded EventEnvelope.</div>
      </div>
    );
  }
  return <EvidenceBody envelope={envelope} onClose={onClose} />;
}

function EvidenceBody({ envelope, onClose }: { envelope: EventEnvelope; onClose?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const metadata = (envelope.metadata ?? {}) as Record<string, unknown>;
  const { recognized, unrecognized } = splitPayload(payload);

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="relative space-y-3 rounded-sm border border-border-default bg-bg-secondary p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-text-secondary">Recorded evidence</span>
        </div>
        <span className="rounded-sm border border-border-subtle bg-bg-tertiary px-2 py-0.5 font-mono text-[10px] text-text-secondary">seq #{envelope.sequence_num}</span>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-sm p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="Close recorded evidence">
            <X size={12} />
          </button>
        )}
      </div>

      <div className="text-[13px] font-semibold capitalize tracking-wide text-text-primary">{envelope.event_type.replace(/[._]/g, ' ')}</div>

      {/* Canonical MissionEventRecord fields (Evidence) */}
      <EvidenceSection title="Event Record">
        <EvidenceRow label="id" value={envelope.id} onCopy={copy} copied={copied} />
        <EvidenceRow label="mission_id" value={envelope.mission_id} onCopy={copy} copied={copied} />
        <EvidenceRow label="branch_id" value={envelope.branch_id} onCopy={copy} copied={copied} />
        <EvidenceRow label="sequence_num" value={String(envelope.sequence_num)} onCopy={copy} copied={copied} />
        <EvidenceRow label="branch_sequence_num" value={String(envelope.branch_sequence_num)} onCopy={copy} copied={copied} />
        <EvidenceRow label="event_type" value={envelope.event_type} onCopy={copy} copied={copied} />
        <EvidenceRow label="timestamp" value={envelope.timestamp} sub={formatTimestamp(envelope.timestamp)} onCopy={copy} copied={copied} />
        {envelope.agent_id && <EvidenceRow label="agent_id" value={envelope.agent_id} onCopy={copy} copied={copied} />}
        {envelope.span_id && <EvidenceRow label="span_id" value={envelope.span_id} onCopy={copy} copied={copied} />}
        {envelope.trace_id && <EvidenceRow label="trace_id" value={envelope.trace_id} onCopy={copy} copied={copied} />}
        {envelope.parent_span_id && <EvidenceRow label="parent_span_id" value={envelope.parent_span_id} onCopy={copy} copied={copied} />}
        {envelope.idempotency_key && <EvidenceRow label="idempotency_key" value={envelope.idempotency_key} onCopy={copy} copied={copied} />}
      </EvidenceSection>

      {(envelope.content_hash || envelope.previous_hash) && (
        <EvidenceSection title="Integrity linkage">
          {envelope.content_hash && <EvidenceRow label="content_hash" value={envelope.content_hash} onCopy={copy} copied={copied} />}
          {envelope.previous_hash && <EvidenceRow label="previous_hash" value={envelope.previous_hash} onCopy={copy} copied={copied} />}
        </EvidenceSection>
      )}

      {/* Recognized payload keys (typed extraction whitelist, spec 8.1) */}
      {recognized.length > 0 && (
        <EvidenceSection title="Payload (recognized)">
          <RawKeyValue entries={recognized} onCopy={copy} copied={copied} />
        </EvidenceSection>
      )}

      {/* Unrecognized payload keys — L4 only, verbatim (spec 8.2) */}
      {unrecognized.length > 0 && (
        <EvidenceSection title="Payload (verbatim / unrecognized)">
          <div className="mb-1 text-[10px] text-text-muted">Keys not in the ROPS whitelist. Shown verbatim; never interpreted.</div>
          <RawKeyValue entries={unrecognized} onCopy={copy} copied={copied} />
        </EvidenceSection>
      )}

      {/* Metadata — L4 only (spec 5.1 / 8.2) */}
      {metadata && Object.keys(metadata).length > 0 && (
        <EvidenceSection title="Metadata (verbatim)">
          <RawKeyValue entries={Object.entries(metadata) as Array<[string, unknown]>} onCopy={copy} copied={copied} />
        </EvidenceSection>
      )}

      {/* Provenance envelope fields — Evidence */}
      <EvidenceSection title="Provenance">
        <EvidenceRow label="actor_type" value={envelope.actor_type ?? '—'} onCopy={copy} copied={copied} />
        <EvidenceRow label="actor_id" value={envelope.actor_id ?? '—'} onCopy={copy} copied={copied} />
        <EvidenceRow label="origin_framework" value={envelope.origin_framework ?? '—'} onCopy={copy} copied={copied} />
        {envelope.model && (
          <div className="pt-1 space-y-1">
            <div className="text-[10px] text-text-muted">Model</div>
            <EvidenceRow label="provider" value={envelope.model.provider ?? '—'} onCopy={copy} copied={copied} />
            <EvidenceRow label="model_name" value={envelope.model.model_name ?? '—'} onCopy={copy} copied={copied} />
            {envelope.model.model_version && <EvidenceRow label="model_version" value={envelope.model.model_version} onCopy={copy} copied={copied} />}
            {envelope.model.tokens_input !== undefined && <EvidenceRow label="tokens_input" value={String(envelope.model.tokens_input)} onCopy={copy} copied={copied} />}
            {envelope.model.tokens_output !== undefined && <EvidenceRow label="tokens_output" value={String(envelope.model.tokens_output)} onCopy={copy} copied={copied} />}
            {envelope.model.temperature !== undefined && <EvidenceRow label="temperature" value={String(envelope.model.temperature)} onCopy={copy} copied={copied} />}
            {envelope.model.stop_reason && <EvidenceRow label="stop_reason" value={envelope.model.stop_reason} onCopy={copy} copied={copied} />}
          </div>
        )}
        {envelope.policy && (
          <div className="pt-1 space-y-1">
            <div className="text-[10px] text-text-muted">Policy</div>
            {envelope.policy.rule_id && <EvidenceRow label="rule_id" value={envelope.policy.rule_id} onCopy={copy} copied={copied} />}
            {envelope.policy.decision && <EvidenceRow label="decision" value={envelope.policy.decision} onCopy={copy} copied={copied} />}
            {envelope.policy.reason && <EvidenceRow label="reason" value={envelope.policy.reason} onCopy={copy} copied={copied} />}
          </div>
        )}
        {envelope.error && (
          <div className="pt-1 space-y-1">
            <div className="text-[10px] text-text-muted">Error</div>
            {envelope.error.source && <EvidenceRow label="source" value={envelope.error.source} onCopy={copy} copied={copied} />}
            {envelope.error.cause && <EvidenceRow label="cause" value={envelope.error.cause} onCopy={copy} copied={copied} />}
            {envelope.error.severity && <EvidenceRow label="severity" value={envelope.error.severity} onCopy={copy} copied={copied} />}
            {envelope.error.recovery_action && <EvidenceRow label="recovery_action" value={envelope.error.recovery_action} onCopy={copy} copied={copied} />}
            {envelope.error.original_error && <EvidenceRow label="original_error" value={envelope.error.original_error} onCopy={copy} copied={copied} />}
          </div>
        )}
        {envelope.causal && (
          <div className="pt-1 space-y-1">
            <div className="text-[10px] text-text-muted">Causal</div>
            {envelope.causal.parent_span_id && <EvidenceRow label="parent_span_id" value={envelope.causal.parent_span_id} onCopy={copy} copied={copied} />}
            {envelope.causal.tool_call_id && <EvidenceRow label="tool_call_id" value={envelope.causal.tool_call_id} onCopy={copy} copied={copied} />}
            {envelope.causal.decision_for_event_id && <EvidenceRow label="decision_for_event_id" value={envelope.causal.decision_for_event_id} onCopy={copy} copied={copied} />}
            {envelope.causal.triggered_by_event_id && <EvidenceRow label="triggered_by_event_id" value={envelope.causal.triggered_by_event_id} onCopy={copy} copied={copied} />}
          </div>
        )}
      </EvidenceSection>
    </div>
  );
}

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function EvidenceRow({ label, value, sub, onCopy, copied }: { label: string; value: string; sub?: string; onCopy: (text: string, key: string) => void; copied: string | null }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border-subtle pb-1">
      <span className="shrink-0 font-mono text-[10px] text-text-muted">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className="break-all text-right font-mono text-[10px] text-text-secondary" title={value}>
          {value}
          {sub && <span className="block text-[10px] text-text-muted">{sub}</span>}
        </span>
        {value && value !== '—' && (
          <button type="button" onClick={() => onCopy(value, label)} className="shrink-0 rounded-sm p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label={`Copy ${label}`}>
            {copied === label ? <CheckCircle2 size={10} className="text-success" /> : <Copy size={10} />}
          </button>
        )}
      </div>
    </div>
  );
}

function RawKeyValue({ entries, onCopy, copied }: { entries: ReadonlyArray<readonly [string, unknown]>; onCopy: (text: string, key: string) => void; copied: string | null }) {
  return (
    <ul className="space-y-1.5">
      {entries.map(([k, v]) => {
        const text = stringifyRaw(v);
        return (
          <li key={k} className="text-[10px]">
            <div className="flex items-center gap-1 font-mono text-text-muted">
              {k}
              <button type="button" onClick={() => onCopy(text, k)} className="rounded-sm p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label={`Copy ${k}`}>
                {copied === k ? <CheckCircle2 size={10} className="text-success" /> : <Copy size={10} />}
              </button>
            </div>
            <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-bg-primary p-1.5 font-mono text-[10px] text-text-secondary">{text}</pre>
          </li>
        );
      })}
    </ul>
  );
}

function stringifyRaw(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
