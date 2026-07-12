import { describe, expect, it } from 'vitest';
import { mafInteractionFact, mafOutcomeFact, mafTraceWorkflowIds } from '../../src/services/runtime/normalization/mafIngestion.js';

describe('private MAF ingestion boundary', () => {
  it('normalizes a request without exposing native attributes to Core', () => {
    const fact = mafInteractionFact({ attributes: { 'workflow.id': 'w', 'executor.id': 'e' } }, {
      name: 'agentlens.maf.request_info',
      attributes: {
        'agentlens.maf.request_id': 'r',
        'agentlens.maf.request_type': 'ReviewRequest',
        'agentlens.maf.response_type': 'ReviewResponse',
      },
    });
    expect(fact).toMatchObject({ interruptId: 'r', requestType: 'ReviewRequest' });
    expect(fact?.publicAttributes).not.toHaveProperty('workflow.definition');
  });

  it('correlates a MAF request enrichment with its workflow span by trace', () => {
    const workflowIds = mafTraceWorkflowIds([{ trace_id: 'trace-1', attributes: { 'workflow.id': 'workflow-1' } }]);
    const fact = mafInteractionFact(
      { trace_id: 'trace-1', attributes: { 'executor.id': 'executor-1' } },
      { name: 'agentlens.maf.request_info', attributes: { 'agentlens.maf.request_id': 'request-1' } },
      workflowIds,
    );
    expect(fact?.nativeIdentity).toMatchObject({ workflow_id: 'workflow-1', executor_id: 'executor-1' });
  });

  it('rejects a request event whose native workflow identity conflicts with its trace', () => {
    const workflowIds = mafTraceWorkflowIds([{ trace_id: 'trace-1', attributes: { 'workflow.id': 'workflow-1' } }]);
    expect(mafInteractionFact(
      { trace_id: 'trace-1', attributes: {} },
      {
        name: 'agentlens.maf.request_info',
        attributes: {
          'agentlens.maf.workflow_id': 'other-workflow',
          'agentlens.maf.request_id': 'request-1',
        },
      },
      workflowIds,
    )).toBeUndefined();
  });

  it('requires request and delivery correlation for a terminal MAF fact', () => {
    expect(mafOutcomeFact({ name: 'agentlens.maf.delivery_accepted', attributes: {
      'agentlens.maf.request_id': 'r', 'agentlens.maf.terminal_outcome': 'continued',
    } })).toBeUndefined();
    expect(mafOutcomeFact({ name: 'agentlens.maf.delivery_accepted', attributes: {
      'agentlens.maf.request_id': 'r', 'agentlens.maf.delivery_id': 'd', 'agentlens.maf.terminal_outcome': 'continued',
    } })).toMatchObject({ interruptId: 'r', deliveryId: 'd', outcome: 'continued_with_input' });
  });
});
