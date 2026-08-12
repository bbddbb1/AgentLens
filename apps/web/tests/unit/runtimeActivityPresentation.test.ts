import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuntimeExplanationActivity } from '@agentlens/protocol';
import { runtimeActivityInspectorView } from '@/lib/runtimeActivityPresentation';
import { TimelineEventCard } from '@/components/timeline/TimelineEventCard';

describe('canonical activity Inspector presentation', () => {
  it('copies canonical identity lifecycle and outcome without reinterpretation', () => {
    const activity: RuntimeExplanationActivity = {
      id: 'tool:call-1',
      kind: 'tool',
      title: 'Search',
      action: 'Invoke tool',
      status: 'completed',
      outcome: 'Unknown',
      invocation_id: 'call-1',
      source_span_id: 'span-1',
      evidence_refs: [{
        event_id: 'event-1',
        sequence_num: 7,
        timestamp: '2026-01-01T00:00:00.000Z',
        branch_id: 'main',
      }],
    };

    expect(runtimeActivityInspectorView(activity)).toEqual({
      id: 'tool:call-1',
      title: 'Search',
      kind: 'tool',
      lifecycle: 'Completed',
      outcome: 'Unknown',
      invocationId: 'call-1',
      sourceSpanId: 'span-1',
      evidenceSequences: [7],
      limitation: undefined,
    });
  });

  it('renders canonical lifecycle and outcome as separate Timeline facts', () => {
    const html = renderToStaticMarkup(createElement(TimelineEventCard, {
      activity: {
        id: 'tool:call-1',
        kind: 'tool',
        label: 'Search',
        action: 'Invoke tool',
        status: 'completed',
        outcome: 'Unknown',
        provenance: 'projection',
      },
      isCurrent: false,
      onSelect: () => undefined,
    }));

    expect(html).toContain('Completed');
    expect(html).toContain('Unknown outcome');
    expect(html).not.toContain('Successful');
  });
});
