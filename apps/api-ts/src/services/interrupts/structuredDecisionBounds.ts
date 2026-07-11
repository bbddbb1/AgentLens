import {
  STRUCTURED_DECISION_MAX_COLLECTION_SIZE,
  STRUCTURED_DECISION_MAX_DEPTH,
  STRUCTURED_DECISION_MAX_SERIALIZED_BYTES,
} from '@agentlens/protocol';

export type StructuredDecisionValidationResult =
  | { ok: true; value: unknown; summary: Record<string, unknown> }
  | { ok: false; reason: string };

const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'boolean', 'null']);

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
    return { ok: true, value: undefined, summary: { kind: 'empty' } };
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
