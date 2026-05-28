import { AttributeMap } from '@agentlens/protocol';

export function attr(attrs: AttributeMap | undefined, key: string): string | undefined {
  const value = attrs?.[key];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(',') : String(value);
}

export function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

export function nanoToIso(value: number | string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString();
  return new Date(Math.floor(numeric / 1_000_000)).toISOString();
}

export function compareTimestamp(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}
