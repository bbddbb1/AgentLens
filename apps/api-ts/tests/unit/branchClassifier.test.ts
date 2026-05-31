import { describe, it, expect } from 'vitest';
import { BranchClassifier } from '../../src/services/runtime/BranchClassifier.js';
import { AgentEvents, MissionEventRecord } from '@agentlens/protocol';

describe('BranchClassifier', () => {
  const createMockEvent = (type: string): MissionEventRecord => ({
    id: 'test-event-id',
    mission_id: 'test-mission-id',
    sequence_num: 1,
    branch_id: 'main',
    branch_sequence_num: 1,
    event_type: type,
    timestamp: new Date().toISOString(),
    payload: {},
  });

  describe('classify', () => {
    it('classifies HITL interrupts correctly', () => {
      const event = createMockEvent(AgentEvents.INTERRUPT_REQUESTED);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(true);
      expect(result.kind).toBe('hitl');
    });

    it('classifies HUMAN_DECISION as hitl', () => {
      const event = createMockEvent(AgentEvents.HUMAN_DECISION);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(true);
      expect(result.kind).toBe('hitl');
    });

    it('classifies TOOL_CALL as pre_tool', () => {
      const event = createMockEvent(AgentEvents.TOOL_CALL);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(true);
      expect(result.kind).toBe('pre_tool');
    });

    it('classifies TOOL_RESULT as post_tool', () => {
      const event = createMockEvent(AgentEvents.TOOL_RESULT);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(true);
      expect(result.kind).toBe('post_tool');
    });

    it('classifies DECISION as routing', () => {
      const event = createMockEvent(AgentEvents.DECISION);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(true);
      expect(result.kind).toBe('routing');
    });

    it('classifies REVIEW_REJECTED as review_divergence', () => {
      const event = createMockEvent(AgentEvents.REVIEW_REJECTED);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(true);
      expect(result.kind).toBe('review_divergence');
    });

    it('classifies unbranchable events correctly', () => {
      const event = createMockEvent(AgentEvents.MISSION_STARTED);
      const result = BranchClassifier.classify(event);
      expect(result.capability.is_branchable).toBe(false);
      expect(result.capability.reason).toBe('Deterministic frame');
      expect(result.kind).toBeUndefined();
    });
  });
});
