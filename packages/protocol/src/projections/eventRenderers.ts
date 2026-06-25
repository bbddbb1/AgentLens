import type { RuntimeEventRef } from '../types.js';

export type EventRenderMode = 'default' | 'compact';

const RENDERERS: Record<string, (ref: RuntimeEventRef, mode: EventRenderMode) => string> = {
  'task.started': (ref) => `started ${ref.object ?? 'task'}`,
  'task.completed': (ref) => `completed ${ref.object ?? 'task'}`,
  'task.failed': (ref) => `failed ${ref.object ?? 'task'}`,
  'tool.called': (ref) => `called ${ref.object ?? 'tool'}`,
  'tool.completed': (ref) => `finished ${ref.object ?? 'tool'}`,
  'tool.failed': (ref) => `tool failed: ${ref.object ?? 'tool'}`,
  'memory.written': (ref) => `wrote ${ref.object ?? 'memory'}`,
  'memory.read': (ref) => `read ${ref.object ?? 'memory'}`,
  'artifact.created': (ref) => `created ${ref.object ?? 'artifact'}`,
  'artifact.updated': (ref) => `updated ${ref.object ?? 'artifact'}`,
  'handoff.requested': (ref) => `requested handoff${ref.object ? ` to ${ref.object}` : ''}`,
  'handoff.accepted': (ref) => `accepted handoff${ref.object ? ` to ${ref.object}` : ''}`,
  'handoff.rejected': () => 'rejected handoff',
  'delegation': (ref) => `delegated${ref.object ? ` to ${ref.object}` : ''}`,
  'interrupt.requested': () => 'requested human intervention',
  'interrupt.resumed': () => 'resumed after human decision',
  'observation.recorded': () => 'recorded observation',
  'agent.registered': () => 'joined execution',
  'critique': (ref) => `critiqued ${ref.object ?? 'peer'}`,
  'review.started': () => 'started review',
  'review.approved': () => 'approved review',
  'review.changes_requested': () => 'requested review changes',
  'review.rejected': () => 'rejected in review',
  'escalation': (ref) => `escalated${ref.object ? ` to ${ref.object}` : ''}`,
  'span.failed': () => 'span failed',
};

export function renderRuntimeEventRef(
  ref: RuntimeEventRef,
  _locale = 'en',
  mode: EventRenderMode = 'default',
): string {
  const renderer = RENDERERS[ref.event_type];
  if (renderer) {
    return renderer(ref, mode);
  }
  return ref.event_type.replace(/[._]/g, ' ');
}
