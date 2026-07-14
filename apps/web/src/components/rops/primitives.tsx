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
import { createContext, useContext, useState } from 'react';

const ShowMissingFieldsContext = createContext(false);

export function MissingFieldsProvider({
  showMissing,
  children,
}: {
  showMissing: boolean;
  children?: React.ReactNode;
}) {
  return (
    <ShowMissingFieldsContext.Provider value={showMissing}>
      {children}
    </ShowMissingFieldsContext.Provider>
  );
}

const STATUS_TOKEN_COLORS: Record<string, string> = {
  idle: '#5d6180',
  active: '#818cf8',
  completed: '#34d399',
  failed: '#f87171',
  waiting: '#fbbf24',
  reviewing: '#a78bfa',
  unknown: '#5d6180',
};

const INTERRUPT_STATUS_COLORS: Record<string, string> = {
  pending: '#fbbf24',
  approved: '#34d399',
  rejected: '#f87171',
  resumed: '#60a5fa',
  expired: '#5d6180',
  cancelled: '#5d6180',
};

const BRANCH_STATUS_COLORS: Record<string, string> = {
  active: '#34d399',
  archived: '#5d6180',
};

/** Deterministic status-dot color for a `NodeStatus` (spec 7.1). */
export function statusTokenColor(status: string | undefined): string {
  if (!status) return '#5d6180';
  return STATUS_TOKEN_COLORS[status] ?? '#5d6180';
}

export function interruptStatusColor(status: string | undefined): string {
  if (!status) return '#5d6180';
  return INTERRUPT_STATUS_COLORS[status] ?? '#5d6180';
}

export function branchStatusColor(status: string | undefined): string {
  if (!status) return '#5d6180';
  return BRANCH_STATUS_COLORS[status] ?? '#5d6180';
}

/**
 * Provenance tag (spec 7.6). Evidence => no tag. Projection => `[projection]`.
 * Heuristic => `[projection · heuristic]`.
 */
export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  if (provenance === 'evidence') return null;
  const label = provenance === 'heuristic' ? '[projection · heuristic]' : '[projection]';
  const color = provenance === 'heuristic' ? '#fbbf24' : '#6b708a';
  return (
    <span
      className="ml-1.5 text-[8px] font-mono tracking-wider uppercase"
      style={{ color }}
      title={
        provenance === 'heuristic'
          ? 'Deterministic projection that invents a metric the runtime did not emit (ROPS P8).'
          : 'Deterministic projection over runtime evidence (ROPS P1.2).'
      }
    >
      {label}
    </span>
  );
}

/**
 * Render a RopsField value with a provenance tag, or a stable "not recorded"
 * marker when absent (spec 7.5 / P7). The `formatter` must be deterministic.
 */
export function RopsFieldValue<T>({
  field,
  formatter,
  showProvenance = true,
}: {
  field: RopsField<T>;
  formatter?: (value: T) => string;
  showProvenance?: boolean;
}) {
  if (field.absent || field.value === undefined) {
    return <span className="text-[10px] text-[#5d6180] italic">not recorded</span>;
  }
  const text = formatter ? formatter(field.value) : String(field.value);
  return (
    <span className="text-[11px] text-[#d0d4ea] break-words">
      {text}
      {showProvenance && <ProvenanceTag provenance={field.provenance} />}
    </span>
  );
}

/** A labeled key/value row for inspector sections (spec 9.1). */
export function RopsFieldRow<T>({
  label,
  field,
  formatter,
  showProvenance = true,
}: {
  label: string;
  field: RopsField<T>;
  formatter?: (value: T) => string;
  showProvenance?: boolean;
}) {
  const showMissing = useContext(ShowMissingFieldsContext);
  if (field.absent && !showMissing) return null;
  return (
    <div className="flex justify-between items-start gap-3 border-b border-[rgba(255,255,255,0.04)] pb-1.5">
      <span className="text-[#8f95b2] text-[10px] font-semibold shrink-0">{label}</span>
      <div className="text-right min-w-0">
        <RopsFieldValue field={field} formatter={formatter} showProvenance={showProvenance} />
      </div>
    </div>
  );
}

/** Section wrapper with a fixed title (spec 9.1 section order). */
export function RopsSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  // Collapsibility is a presentation concern only (spec 11 Expand/Collapse);
  // no data changes. Keep it dependency-free to stay implementation-light.
  const [open, setOpen] = useToggleState(defaultOpen);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.12em] text-[#5d6180] font-semibold">{title}</span>
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-[9px] text-[#5d6180] hover:text-[#9498b0]"
            aria-expanded={open}
          >
            {open ? 'collapse' : 'expand'}
          </button>
        )}
      </div>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function useToggleState(initial: boolean): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(initial);
  return [open, setOpen];
}
