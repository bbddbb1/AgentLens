import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mafInteractionFact, mafTraceWorkflowIds } from '../../src/services/runtime/normalization/mafIngestion.js';
import { projectReplay } from '../../src/services/runtime/projection.js';

const fixturePath = resolve(
  import.meta.dirname,
  '../../../../packages/sdk-maf/tests/fixtures/otlp/request/captured_telemetry.json',
);
const fixtureRoot = resolve(import.meta.dirname, '../../../../packages/sdk-maf/tests/fixtures/otlp');

function readFixture(name: string): any[] {
  return JSON.parse(readFileSync(resolve(fixtureRoot, name, 'captured_telemetry.json'), 'utf8')).spans;
}

describe('captured real MAF fixture', () => {
  it('normalizes captured native telemetry privately and projects only bounded MAF identity publicly', () => {
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
    expect(publicBlob).toContain('<workflow-id>');
    expect(publicBlob).toContain('agentlens-reference-review-executor');
    expect(publicBlob).toContain('agentlens-reference-review-request');
    expect(publicBlob).not.toContain('<redacted-workflow-definition>');
  });

  it('makes captured negative conditions explicit at the private translation boundary', () => {
    const missingIdentity = readFixture('missing_identity');
    const missingSpan = missingIdentity.find((span) => span.events?.some((event: any) => event.name === 'agentlens.maf.request_info'));
    const missingEvent = missingSpan.events.find((event: any) => event.name === 'agentlens.maf.request_info');
    expect(mafInteractionFact(missingSpan, missingEvent, mafTraceWorkflowIds(missingIdentity))).toBeUndefined();

    const conflictingIdentity = readFixture('conflicting_identity');
    const conflictSpan = conflictingIdentity.find((span) => span.events?.some((event: any) => event.name === 'agentlens.maf.request_info'));
    const conflictEvent = conflictSpan.events.find((event: any) => event.name === 'agentlens.maf.request_info');
    expect(mafInteractionFact(conflictSpan, conflictEvent, mafTraceWorkflowIds(conflictingIdentity))).toBeUndefined();

    const unknownTelemetry = readFixture('unknown_telemetry');
    expect(unknownTelemetry.flatMap((span) => span.events ?? []).some((event) => event.name === 'agentlens.maf.request_info')).toBe(false);
  });
});
