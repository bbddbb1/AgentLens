export { mergeNativeRuntimeIdentities, normalizeSpansToFacts } from './normalize.js';
export { hasMafMarkers, mafNativeRuntimeIdentity } from './maf.js';
export { hasAmbiguousNativeIdentity } from './types.js';
export type {
  NativeRuntimeIdentity,
  NormalizationDiagnosticCode,
  NormalizationDiagnostics,
  NormalizedActivity,
  NormalizedRelationship,
  NormalizedRuntimeFacts,
  SourceReference,
} from './types.js';
