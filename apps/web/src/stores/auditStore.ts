/**
 * Audit store — shared, branch-aware cache of the `EventEnvelope` stream.
 *
 * The ROPS presentation layer correlates a selected graph node to the
 * envelopes that share its `span_id` to surface runtime evidence (tool I/O,
 * search query, result count, retrieval backend, failure reason). Those
 * envelopes are produced by the existing `GET /audit/events` endpoint and
 * filtered server-side to `sequence_num <= frame`.
 *
 * This store exists so that graph node components rendered outside the right
 * sidebar (e.g. `ToolNode` / `TaskNode` / `AgentNode` hover popovers) can read
 * the same already-fetched envelopes without re-fetching. It performs no
 * interpretation: the `events` array is the verbatim `MissionAuditEventResponse`.
 */

import { create } from 'zustand';
import type { EventEnvelope } from '@agentlens/protocol';
import { api } from '@/lib/api';

interface AuditStoreState {
  events: EventEnvelope[];
  isLoading: boolean;
  /** The (missionId, branchId, sequenceNum) tuple the current events were loaded for. */
  loadedFor: { missionId: string; branchId: string; sequenceNum: number | undefined } | null;

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
  loadedFor: null,

  load: (missionId, branchId, sequenceNum) => {
    if (!missionId || missionId === 'demo-mission') {
      return;
    }
    const resolvedBranch = branchId ?? 'main';
    const current = get().loadedFor;
    if (
      current &&
      current.missionId === missionId &&
      current.branchId === resolvedBranch &&
      current.sequenceNum === sequenceNum
    ) {
      return;
    }
    runLoad(set, missionId, resolvedBranch, sequenceNum);
  },

  refresh: () => {
    const current = get().loadedFor;
    if (!current) return;
    runLoad(set, current.missionId, current.branchId, current.sequenceNum);
  },

  clear: () =>
    set({ events: [], isLoading: false, loadedFor: null }),
}));

function runLoad(
  set: (partial: Partial<AuditStoreState>) => void,
  missionId: string,
  branchId: string,
  sequenceNum: number | undefined,
) {
  set({ events: [], isLoading: true, loadedFor: null });
  api
    .audit.events(missionId, branchId, sequenceNum)
    .then((res) => {
      set({
        events: res.events ?? [],
        isLoading: false,
        loadedFor: { missionId, branchId, sequenceNum },
      });
    })
    .catch((err) => {
      console.error('auditStore.load failed', err);
      set({ isLoading: false });
    });
}
