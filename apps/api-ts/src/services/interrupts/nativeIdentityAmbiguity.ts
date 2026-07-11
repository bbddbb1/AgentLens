/**
 * Propagate normalization native-identity ambiguity into interrupt governance.
 *
 * Path:
 *   conflicting lifecycle identity → conflicting_native_identity diagnostic
 *   → identity_ambiguous=true on interrupt → actionability identity_conflict
 */

import {
  hasAmbiguousNativeIdentity,
  mergeNativeRuntimeIdentities,
  normalizeSpansToFacts,
  type NativeRuntimeIdentity,
  type NormalizationDiagnostics,
  type SourceReference,
} from '../runtime/normalization/index.js';

export type StoredNativeIdentity = NativeRuntimeIdentity & {
  mission_id?: string;
  branch_id?: string;
  interaction_request_id?: string;
  interrupt_request_id?: string;
};

export type InterruptIdentityAmbiguityResolution = {
  identityAmbiguous: boolean;
  fromNormalization: boolean;
  fromStoredMerge: boolean;
};

/**
 * From a span batch, return interrupt request IDs whose normalized evidence
 * carries a conflicting_native_identity / ambiguity diagnostic.
 *
 * Covers:
 * - field conflicts merged within the same activity (shared run/correlation key)
 * - the same interrupt_request_id observed across activities with conflicting fields
 */
export function interruptIdsWithAmbiguousNativeIdentity(spans: unknown[]): Set<string> {
  const facts = normalizeSpansToFacts(spans as any[]);
  const ambiguous = new Set<string>();
  const conflictDiagnostics = facts.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'conflicting_native_identity',
  );

  for (const activity of facts.activities) {
    const interruptId = activity.native_runtime_identity?.interrupt_request_id;
    if (!interruptId) continue;
    if (activityHasIdentityConflict(activity.source_references, conflictDiagnostics)) {
      ambiguous.add(interruptId);
    }
  }

  // Same interrupt request across separately keyed activities (e.g. conflicting run_id).
  const byInterrupt = new Map<string, Array<{ identity: NativeRuntimeIdentity; source?: SourceReference }>>();
  for (const activity of facts.activities) {
    const identity = activity.native_runtime_identity;
    const interruptId = identity?.interrupt_request_id;
    if (!interruptId || !identity) continue;
    const entries = byInterrupt.get(interruptId) ?? [];
    entries.push({ identity, source: activity.source_references[0] });
    byInterrupt.set(interruptId, entries);
  }
  for (const [interruptId, entries] of byInterrupt) {
    if (entries.length < 2) continue;
    const { diagnostics } = mergeNativeRuntimeIdentities(entries);
    if (hasAmbiguousNativeIdentity(diagnostics)) ambiguous.add(interruptId);
  }

  return ambiguous;
}

function activityHasIdentityConflict(
  sources: Array<{ span_id?: string; event_name?: string; event_index?: number }>,
  diagnostics: NormalizationDiagnostics[],
): boolean {
  const spanIds = new Set(sources.map((source) => source.span_id).filter(Boolean));
  return diagnostics.some((diagnostic) => {
    if (diagnostic.code !== 'conflicting_native_identity') return false;
    if (diagnostic.ambiguous_native_identity === true) {
      const left = diagnostic.source?.span_id;
      const right = diagnostic.conflicting_source?.span_id;
      // Prefer span linkage when present; otherwise trust batch-level ambiguity only
      // when both sources are absent (should not happen for merge diagnostics).
      if (!left && !right) return true;
      return (left !== undefined && spanIds.has(left)) || (right !== undefined && spanIds.has(right));
    }
    return false;
  });
}

/**
 * Merge newly observed identity with previously persisted identity.
 * Returns whether the combined evidence is ambiguous.
 */
export function combinedIdentityIsAmbiguous(
  previous: StoredNativeIdentity | null | undefined,
  next: StoredNativeIdentity | null | undefined,
): boolean {
  if (!previous && !next) return false;
  const { diagnostics } = mergeNativeRuntimeIdentities([
    { identity: previous ?? undefined },
    { identity: next ?? undefined },
  ]);
  return hasAmbiguousNativeIdentity(diagnostics);
}

/**
 * Conservative ambiguity flag for persistence.
 * Once true, a later partial observation must not clear it.
 */
export function nextIdentityAmbiguousFlag(
  previouslyAmbiguous: boolean | null | undefined,
  newlyAmbiguous: boolean,
): boolean {
  return Boolean(previouslyAmbiguous) || newlyAmbiguous;
}

/**
 * Resolve whether an interrupt should persist identity_ambiguous for this ingest.
 */
export function resolveInterruptIdentityAmbiguity(input: {
  interruptId: string;
  ambiguousInterruptIds: ReadonlySet<string>;
  previousIdentity?: StoredNativeIdentity | null;
  previouslyAmbiguous?: boolean | null;
  nextIdentity?: StoredNativeIdentity | null;
}): InterruptIdentityAmbiguityResolution {
  const fromNormalization = input.ambiguousInterruptIds.has(input.interruptId);
  const fromStoredMerge = combinedIdentityIsAmbiguous(
    input.previousIdentity,
    input.nextIdentity,
  );
  return {
    fromNormalization,
    fromStoredMerge,
    identityAmbiguous: nextIdentityAmbiguousFlag(
      input.previouslyAmbiguous,
      fromNormalization || fromStoredMerge,
    ),
  };
}
