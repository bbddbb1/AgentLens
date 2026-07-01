import type { RuntimeExplanationActivity, RuntimeSummary } from '@agentlens/protocol';

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function authoritativeRuntimeStatus(summary: RuntimeSummary | null | undefined): string | null {
  const status = summary?.run_status?.trim() ?? summary?.status?.trim();
  if (!status) return null;
  return titleCase(status);
}

export function authoritativeRuntimePhase(
  summary: RuntimeSummary | null | undefined,
): { label: string; basis: string } | null {
  const phase = summary?.runtime_phase ?? summary?.current_phase;
  if (!phase?.label) return null;
  return {
    label: phase.label,
    basis: titleCase(phase.basis),
  };
}

export interface SelectedFrameAuthority {
  status: string | null;
  phase: { label: string; basis: string } | null;
  incompatibilities: string[];
}

function isTerminalOutcome(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'completed' || normalized === 'failed';
}

export function selectedFrameAuthority(
  summary: RuntimeSummary | null | undefined,
  selectedActivity?: Pick<RuntimeExplanationActivity, 'status' | 'outcome'> | null,
): SelectedFrameAuthority {
  const status = authoritativeRuntimeStatus(summary);
  const phase = authoritativeRuntimePhase(summary);
  const incompatibilities: string[] = [];

  if (phase?.label === 'Completed' && status === 'Active') {
    incompatibilities.push('frame phase Completed conflicts with runtime status Active');
  }

  if (selectedActivity && selectedActivity.status === 'active' && isTerminalOutcome(selectedActivity.outcome)) {
    incompatibilities.push(
      `selected activity outcome ${selectedActivity.outcome} conflicts with lifecycle status active`,
    );
  }

  return { status, phase, incompatibilities };
}
