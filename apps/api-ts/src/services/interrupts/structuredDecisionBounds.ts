import {
  STRUCTURED_DECISION_MAX_COLLECTION_SIZE,
  STRUCTURED_DECISION_MAX_DEPTH,
  STRUCTURED_DECISION_MAX_SERIALIZED_BYTES,
} from '@agentlens/protocol';

export type StructuredDecisionValidationResult =
  | { ok: true; value: unknown; summary: Record<string, unknown> }
  | { ok: false; reason: string };

const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'boolean', 'null']);
const SUPPORTED_SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum']);

export type StructuredDecisionSchemaSupport =
  | { ok: true }
  | { ok: false; reason: string };

function inspectSchema(schema: Record<string, unknown>, depth: number): StructuredDecisionSchemaSupport {
  if (depth > STRUCTURED_DECISION_MAX_DEPTH) {
    return { ok: false, reason: `structured decision schema exceeds max nesting depth ${STRUCTURED_DECISION_MAX_DEPTH}` };
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) return { ok: false, reason: `unsupported structured decision schema keyword: ${key}` };
  }
  if (typeof schema.type !== 'string' || !ALLOWED_TYPES.has(schema.type)) {
    return { ok: false, reason: 'structured decision schema requires one supported explicit type' };
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    return { ok: false, reason: 'structured decision schema enum must be a non-empty array' };
  }
  if (schema.type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      return { ok: false, reason: 'object structured decision schema requires properties' };
    }
    if (schema.additionalProperties !== false) {
      return { ok: false, reason: 'object structured decision schema must reject undeclared properties' };
    }
    if (schema.required !== undefined && !Array.isArray(schema.required)) {
      return { ok: false, reason: 'object structured decision schema required must be an array' };
    }
    const properties = schema.properties as Record<string, unknown>;
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    if ([...required].some((key) => !(key in properties))) {
      return { ok: false, reason: 'object structured decision schema requires an undeclared property' };
    }
    for (const property of Object.values(properties)) {
      if (!property || typeof property !== 'object' || Array.isArray(property)) {
        return { ok: false, reason: 'structured decision property schema must be an object' };
      }
      const nested = inspectSchema(property as Record<string, unknown>, depth + 1);
      if (!nested.ok) return nested;
    }
  }
  if (schema.type === 'array') {
    if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) {
      return { ok: false, reason: 'array structured decision schema requires one item schema' };
    }
    return inspectSchema(schema.items as Record<string, unknown>, depth + 1);
  }
  return { ok: true };
}

export function supportsStructuredDecisionSchema(
  schema: Record<string, unknown> | undefined,
): StructuredDecisionSchemaSupport {
  if (!schema || Object.keys(schema).length === 0) {
    return { ok: false, reason: 'structured response is unavailable without an explicit safe input schema' };
  }
  return inspectSchema(schema, 0);
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function walkBounds(value: unknown, depth: number): string | undefined {
  if (depth > STRUCTURED_DECISION_MAX_DEPTH) {
    return `structured decision exceeds max nesting depth ${STRUCTURED_DECISION_MAX_DEPTH}`;
  }
  const type = jsonType(value);
  if (!ALLOWED_TYPES.has(type) || type === 'undefined' || typeof value === 'function' || typeof value === 'bigint') {
    return `unsupported structured decision value type: ${type}`;
  }
  if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(value)) {
    return 'binary structured decision payloads are not allowed';
  }
  if (Array.isArray(value)) {
    if (value.length > STRUCTURED_DECISION_MAX_COLLECTION_SIZE) {
      return `structured decision array exceeds max size ${STRUCTURED_DECISION_MAX_COLLECTION_SIZE}`;
    }
    for (const item of value) {
      const nested = walkBounds(item, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }
  if (type === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > STRUCTURED_DECISION_MAX_COLLECTION_SIZE) {
      return `structured decision object exceeds max size ${STRUCTURED_DECISION_MAX_COLLECTION_SIZE}`;
    }
    for (const [, entry] of entries) {
      const nested = walkBounds(entry, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function matchesSimpleSchema(value: unknown, schema: Record<string, unknown> | undefined): string | undefined {
  if (!schema || Object.keys(schema).length === 0) return undefined;
  const expectedType = schema.type;
  if (typeof expectedType === 'string') {
    const actual = jsonType(value);
    if (expectedType === 'object' && actual !== 'object') return 'value does not match schema type object';
    if (expectedType === 'array' && actual !== 'array') return 'value does not match schema type array';
    if (expectedType === 'string' && actual !== 'string') return 'value does not match schema type string';
    if (expectedType === 'number' && actual !== 'number') return 'value does not match schema type number';
    if (expectedType === 'boolean' && actual !== 'boolean') return 'value does not match schema type boolean';
    if (expectedType === 'null' && actual !== 'null') return 'value does not match schema type null';
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    return 'value is not one of the declared schema enum values';
  }
  if (schema.type === 'object' && schema.properties && typeof value === 'object' && value && !Array.isArray(value)) {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) return `missing required property ${key}`;
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in (value as Record<string, unknown>)) {
        const nested = matchesSimpleSchema((value as Record<string, unknown>)[key], propSchema);
        if (nested) return nested;
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!(key in properties)) return `undeclared property ${key} is not allowed`;
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    for (const item of value) {
      const nested = matchesSimpleSchema(item, schema.items as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Validate operator-supplied structured decision values before recording.
 * Rejects oversized, over-deep, binary, and non-JSON-like values.
 */
export function validateStructuredDecisionValue(
  value: unknown,
  schema?: Record<string, unknown>,
): StructuredDecisionValidationResult {
  if (value === undefined) {
    return { ok: false, reason: 'structured decision value is required' };
  }
  const boundsError = walkBounds(value, 0);
  if (boundsError) return { ok: false, reason: boundsError };

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch {
    return { ok: false, reason: 'structured decision value is not JSON-serializable' };
  }
  if (Buffer.byteLength(serialized, 'utf8') > STRUCTURED_DECISION_MAX_SERIALIZED_BYTES) {
    return {
      ok: false,
      reason: `structured decision exceeds max serialized size ${STRUCTURED_DECISION_MAX_SERIALIZED_BYTES}`,
    };
  }

  if (schema) {
    const support = supportsStructuredDecisionSchema(schema);
    if (!support.ok) return support;
  }
  const schemaError = matchesSimpleSchema(value, schema);
  if (schemaError) return { ok: false, reason: schemaError };

  const summary: Record<string, unknown> = {
    kind: jsonType(value),
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
  if (typeof value === 'string') summary.length = value.length;
  if (Array.isArray(value)) summary.size = value.length;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    summary.keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
  }

  return { ok: true, value, summary };
}
