import type { Mission } from '@agentlens/protocol';

export type RunStatusTone = 'active' | 'success' | 'warning' | 'error' | 'neutral';

export interface RunStatusPresentation {
  label: string;
  tone: RunStatusTone;
}

const KNOWN_RUN_STATUSES: Record<string, RunStatusPresentation> = {
  active: { label: 'Active', tone: 'active' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function recordedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function formatRunToken(value: string): string {
  const normalized = value
    .trim()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function presentRunStatus(status: string): RunStatusPresentation {
  const normalized = status.trim().toLowerCase();
  return (
    KNOWN_RUN_STATUSES[normalized] ?? {
      label: formatRunToken(status),
      tone: 'neutral',
    }
  );
}

export function extractRunFramework(mission: Mission): string | null {
  const resourceAttributes = recordValue(mission.metadata, 'resource_attributes');
  const workflowFramework = recordedString(recordValue(resourceAttributes, 'gen_ai.workflow.framework'));
  if (workflowFramework) return workflowFramework;

  return recordedString(recordValue(mission.metadata, 'framework'));
}

export function filterLoadedRuns(missions: Mission[], query: string): Mission[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return missions;

  return missions.filter((mission) => mission.objective.toLowerCase().includes(normalizedQuery) || mission.id.toLowerCase().includes(normalizedQuery));
}

export function formatRunTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}
