import { describe, expect, it } from 'vitest';
import { renderRuntimeEventRef } from '@agentlens/protocol/internal';
import type { RuntimeEventRef } from '@agentlens/protocol';

describe('renderRuntimeEventRef', () => {
  it('renders task and memory events in English', () => {
    const taskRef: RuntimeEventRef = {
      event_type: 'task.completed',
      sequence_num: 3,
      timestamp: '2026-01-01T00:00:03.000Z',
      object: 'AST tracing',
    };
    expect(renderRuntimeEventRef(taskRef)).toBe('completed AST tracing');

    const memoryRef: RuntimeEventRef = {
      event_type: 'memory.written',
      sequence_num: 2,
      timestamp: '2026-01-01T00:00:02.000Z',
      object: 'finding.root_cause',
    };
    expect(renderRuntimeEventRef(memoryRef)).toBe('wrote finding.root_cause');
  });

  it('falls back to event type for unknown events', () => {
    const ref: RuntimeEventRef = {
      event_type: 'custom.event',
      sequence_num: 1,
      timestamp: '2026-01-01T00:00:01.000Z',
    };
    expect(renderRuntimeEventRef(ref)).toBe('custom event');
  });
});
