/**
 * Repository-internal projection implementation surface.
 *
 * This subpath is not a public wire contract. Public Runtime Core contracts are
 * exported from the package root as schemas, constants, and schema-derived DTOs.
 */
export * from './projections/runtimeProjection.js';
export * from './projections/projectionScratch.js';
export * from './projections/deterministicUnderstanding.js';
export * from './projections/eventRenderers.js';
export * from './projections/nodeStateProjection.js';
export * from './projections/summaryProjection.js';
export * from './projections/explanationProjection.js';
