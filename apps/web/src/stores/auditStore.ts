/**
 * Audit store — shared, branch-aware cache of the `EventEnvelope` stream.
 *
 * The ROPS presentation layer correlates a selected graph node to the
 * envelopes that share its `span_id` to surface runtime evidence (tool I/O,
 * search query, result count, retrieval backend, failure reason). Those
 * envelopes are produced by the existing `GET /audit/events` endpoint and
 * filtered server-side through the exact stable frame cursor.
 *
 * This store gives the authoritative inspector and L4 evidence surface one
 * branch/frame-scoped EventEnvelope stream without duplicate requests. It
 * performs no interpretation: the `events` array is the verbatim
 * `MissionAuditEventResponse`.
 */

import { create } from 'zustand';
import type { EventEnvelope } from '@agentlens/protocol';
import { api } from '@/lib/api';

interface AuditStoreState {
  events: EventEnvelope[];
  isLoading: boolean;
  error: string | null;
  /** The (missionId, branchId, sequenceNum) tuple the current events were loaded for. */
  loadedFor: {
    missionId: string;
    branchId: string;
    sequenceNum: number | undefined;
  } | null;
  /** The tuple currently in flight. Kept separate so `loadedFor` remains truthful. */
  requestedFor: {
    missionId: string;
    branchId: string;
    sequenceNum: number | undefined;
  } | null;

  /**
   * Load audit events for the given tuple. Skips the network when the tuple
   * matches `loadedFor` (e.g. rapid re-renders). No debouncing here — the
   * caller (RightSidebar) already gates on missionId/branch/frame changes.
   */
  load: (missionId: string, branchId: string | null, sequenceNum: number | undefined) => void;
  /**
   * Force a reload for the current tuple, bypassing the cache. Used after a
   * governance decision mutates ledger content under the same tuple.
   */
  refresh: () => void;
  clear: () => void;
}

export const useAuditStore = create<AuditStoreState>((set, get) => ({
  events: [],
  isLoading: false,
  error: null,
  loadedFor: null,
  requestedFor: null,

  load: (missionId, branchId, sequenceNum) => {
    if (!missionId) {
      return;
    }
    const resolvedBranch = branchId ?? 'main';
    const key = { missionId, branchId: resolvedBranch, sequenceNum };
    if (sameTuple(get().loadedFor, key) || sameTuple(get().requestedFor, key)) {
      return;
    }
    runLoad(set, get, key);
  },

  refresh: () => {
    const current = get().requestedFor ?? get().loadedFor;
    if (!current) return;
    runLoad(set, get, current);
  },

  clear: () => {
    auditRequestVersion += 1;
    set({
      events: [],
      isLoading: false,
      error: null,
      loadedFor: null,
      requestedFor: null,
    });
  },
}));

type AuditTuple = NonNullable<AuditStoreState['loadedFor']>;
type AuditSet = (partial: Partial<AuditStoreState>) => void;
type AuditGet = () => AuditStoreState;

let auditRequestVersion = 0;

function sameTuple(left: AuditTuple | null, right: AuditTuple): boolean {
  return Boolean(left && left.missionId === right.missionId && left.branchId === right.branchId && left.sequenceNum === right.sequenceNum);
}

function runLoad(set: AuditSet, get: AuditGet, tuple: AuditTuple) {
  const version = ++auditRequestVersion;
  const preserveEvents = sameTuple(get().loadedFor, tuple);
  set({
    events: preserveEvents ? get().events : [],
    isLoading: true,
    error: null,
    loadedFor: preserveEvents ? get().loadedFor : null,
    requestedFor: tuple,
  });
  api.audit
    .events(tuple.missionId, tuple.branchId, tuple.sequenceNum)
    .then((res) => {
      if (version !== auditRequestVersion) return;
      set({
        events: res.events ?? [],
        isLoading: false,
        error: null,
        loadedFor: tuple,
        requestedFor: null,
      });
    })
    .catch((err) => {
      if (version !== auditRequestVersion) return;
      set({
        events: preserveEvents ? get().events : [],
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load recorded evidence.',
        requestedFor: null,
      });
    });
}
