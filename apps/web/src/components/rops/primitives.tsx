/**
 * ROPS presentation primitives — small shared building blocks used by every
 * disclosure level. These are presentational helpers only; they never fetch
 * data, never infer, and never read the forbidden `generated` block.
 *
 * Spec: `docs/reference/rops.md` sections 7 (Rendering Guidelines) and
 * 7.6 (Provenance labelling).
 */
'use client';

import type { RopsField, Provenance } from '@/lib/rops/provenance';
import { createContext, useContext, useId, useState } from 'react';

const ShowMissingFieldsContext = createContext(false);

export function MissingFieldsProvider({ showMissing, children }: { showMissing: boolean; children?: React.ReactNode }) {
  return <ShowMissingFieldsContext.Provider value={showMissing}>{children}</ShowMissingFieldsContext.Provider>;
}

const STATUS_TOKEN_COLORS: Record<string, string> = {
  idle: 'var(--color-status-idle)',
  active: 'var(--color-status-active)',
  completed: 'var(--color-status-completed)',
  failed: 'var(--color-status-failed)',
  waiting: 'var(--color-status-waiting)',
  reviewing: 'var(--color-status-reviewing)',
  unknown: 'var(--color-status-idle)',
};

const INTERRUPT_STATUS_COLORS: Record<string, string> = {
  pending: 'var(--color-warning)',
  approved: 'var(--color-success)',
  rejected: 'var(--color-error)',
  resumed: 'var(--color-info)',
  expired: 'var(--color-text-muted)',
  cancelled: 'var(--color-text-muted)',
};

const BRANCH_STATUS_COLORS: Record<string, string> = {
  active: 'var(--color-success)',
  archived: 'var(--color-text-muted)',
};

/** Deterministic status-dot color for a `NodeStatus` (spec 7.1). */
export function statusTokenColor(status: string | undefined): string {
  if (!status) return 'var(--color-text-muted)';
  return STATUS_TOKEN_COLORS[status] ?? 'var(--color-text-muted)';
}

export function interruptStatusColor(status: string | undefined): string {
  if (!status) return 'var(--color-text-muted)';
  return INTERRUPT_STATUS_COLORS[status] ?? 'var(--color-text-muted)';
}

export function branchStatusColor(status: string | undefined): string {
  if (!status) return 'var(--color-text-muted)';
  return BRANCH_STATUS_COLORS[status] ?? 'var(--color-text-muted)';
}

/**
 * Provenance tag (spec 7.6). Evidence => no tag. Projection => `[projection]`.
 * Heuristic => `[projection · heuristic]`.
 */
export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  if (provenance === 'evidence') return null;
  const label = provenance === 'heuristic' ? '[projection · heuristic]' : '[projection]';
  const color = provenance === 'heuristic' ? 'var(--color-warning)' : 'var(--color-text-muted)';
  return (
    <span className="ml-1.5 text-[10px] font-mono tracking-wide" style={{ color }} title={provenance === 'heuristic' ? 'Deterministic projection that invents a metric the runtime did not emit (ROPS P8).' : 'Deterministic projection over runtime evidence (ROPS P1.2).'}>
      {label}
    </span>
  );
}

/**
 * Render a RopsField value with a provenance tag, or a stable "not recorded"
 * marker when absent (spec 7.5 / P7). The `formatter` must be deterministic.
 */
export function RopsFieldValue<T>({ field, formatter, showProvenance = true }: { field: RopsField<T>; formatter?: (value: T) => string; showProvenance?: boolean }) {
  if (field.absent || field.value === undefined) {
    return <span className="text-[10px] italic text-text-muted">not recorded</span>;
  }
  const text = formatter ? formatter(field.value) : String(field.value);
  return (
    <span className="break-words text-[11px] text-text-secondary">
      {text}
      {showProvenance && <ProvenanceTag provenance={field.provenance} />}
    </span>
  );
}

/** A labeled key/value row for inspector sections (spec 9.1). */
export function RopsFieldRow<T>({ label, field, formatter, showProvenance = true }: { label: string; field: RopsField<T>; formatter?: (value: T) => string; showProvenance?: boolean }) {
  const showMissing = useContext(ShowMissingFieldsContext);
  if (field.absent && !showMissing) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle pb-1.5">
      <span className="shrink-0 text-[10px] font-semibold text-text-muted">{label}</span>
      <div className="text-right min-w-0">
        <RopsFieldValue field={field} formatter={formatter} showProvenance={showProvenance} />
      </div>
    </div>
  );
}

/** Section wrapper with a fixed title (spec 9.1 section order). */
export function RopsSection({ title, children, collapsible = false, defaultOpen = true }: { title: string; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  // Collapsibility is a presentation concern only (spec 11 Expand/Collapse);
  // no data changes. Keep it dependency-free to stay implementation-light.
  const [open, setOpen] = useToggleState(defaultOpen);
  const contentId = useId();
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{title}</span>
        {collapsible && (
          <button type="button" onClick={() => setOpen(!open)} className="rounded-sm px-1 py-0.5 text-[10px] text-text-muted hover:bg-bg-hover hover:text-text-secondary" aria-expanded={open} aria-controls={contentId} aria-label={`${open ? 'Hide' : 'Show'} ${title}`}>
            {open ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {open && (
        <div id={contentId} className="space-y-1.5">
          {children}
        </div>
      )}
    </section>
  );
}

function useToggleState(initial: boolean): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(initial);
  return [open, setOpen];
}
