import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mafInteractionFact, mafTraceWorkflowIds } from '../../src/services/runtime/normalization/mafIngestion.js';
import { projectReplay } from '../../src/services/runtime/projection.js';

const fixturePath = resolve(
  import.meta.dirname,
  '../../../../packages/sdk-maf/tests/fixtures/otlp/request/captured_telemetry.json',
);

describe('captured real MAF fixture', () => {
  it('normalizes captured native telemetry privately and projects no native workflow data publicly', () => {
    const { spans } = JSON.parse(readFileSync(fixturePath, 'utf8')) as { spans: any[] };
    const requestSpan = spans.find((span) => span.events?.some((event: any) => event.name === 'agentlens.maf.request_info'));
    const requestEvent = requestSpan?.events.find((event: any) => event.name === 'agentlens.maf.request_info');
    const normalized = mafInteractionFact(requestSpan, requestEvent, mafTraceWorkflowIds(spans));
    expect(normalized?.nativeIdentity).toMatchObject({
      framework: 'ms_agent_framework',
      workflow_id: '<workflow-id>',
      executor_id: 'agentlens-reference-review-executor',
      request_id: 'agentlens-reference-review-request',
    });

    const replay = projectReplay('captured-maf', 'main', spans);
    const publicBlob = JSON.stringify(replay);
    expect(publicBlob).not.toContain('<workflow-id>');
    expect(publicBlob).not.toContain('<redacted-workflow-definition>');
    expect(publicBlob).not.toContain('agentlens-reference-review-executor');
  });
});
