import { describe, expect, it } from 'vitest';
import { classifySpan, projectTraceSnapshot, projectReplay } from '../../src/services/runtime/projection.js';

describe('classifySpan', () => {
  it('classifies a basic span as L1', () => {
    const span = {
      span_id: 's1',
      name: 'http.request',
      attributes: {
        'http.method': 'GET',
      },
    };
    expect(classifySpan(span)).toBe('L1');
  });

  it('classifies standard GenAI span as L2', () => {
    const span = {
      span_id: 's1',
      name: 'llm.completion',
      attributes: {
        'gen_ai.system': 'openai',
        'gen_ai.request.model': 'gpt-4o',
      },
    };
    expect(classifySpan(span)).toBe('L2');
  });

  it('classifies AgentLens span as L3', () => {
    const span = {
      span_id: 's1',
      name: 'agent.run',
      attributes: {
        'agentlens.node.id': 'agent-1',
        'agentlens.agent.name': 'Orchestrator',
      },
    };
    expect(classifySpan(span)).toBe('L3');
  });

  it('classifies BSOps span as L3', () => {
    const span = {
      span_id: 's1',
      name: 'agent.run',
      attributes: {
        'basestation.aiops.agent.id': 'agent-1',
        'basestation.aiops.agent.name': 'Orchestrator',
      },
    };
    expect(classifySpan(span)).toBe('L3');
  });
});

describe('projectTraceSnapshot', () => {
  const spans = [
    {
      span_id: 'span1',
      trace_id: 'trace1',
      parent_span_id: null,
      name: 'root',
      start_time_unix_nano: '1000000',
      end_time_unix_nano: '5000000',
      status_code: 'OK',
      attributes: {
        'agentlens.node.type': 'agent',
        'agentlens.agent.name': 'SuperAgent',
      },
    },
    {
      span_id: 'span2',
      trace_id: 'trace1',
      parent_span_id: 'span1',
      name: 'child_tool',
      start_time_unix_nano: '2000000',
      end_time_unix_nano: '4000000',
      status_code: 'OK',
      attributes: {
        'gen_ai.system': 'openai',
        'gen_ai.request.model': 'gpt-4o',
      },
    },
    {
      span_id: 'span3',
      trace_id: 'trace1',
      parent_span_id: 'span1',
      name: 'transition_span',
      start_time_unix_nano: '3000000',
      end_time_unix_nano: '3500000',
      status_code: 'OK',
      attributes: {
        'agentlens.edge.source': 'span1',
        'agentlens.edge.target': 'span2',
        'agentlens.edge.type': 'delegation',
      },
    },
  ];

  it('projects trace to nodes and edges', () => {
    const snapshot = projectTraceSnapshot('m1', 'main', spans);
    
    // Explicit L3 edge span is not a node, so there should be 2 nodes (L3 agent + L2 tool)
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0].id).toBe('span1');
    expect(snapshot.nodes[0].type).toBe('agent');
    expect(snapshot.nodes[0].label).toBe('SuperAgent');
    expect(snapshot.nodes[0].maturityTier).toBe('L3');

    expect(snapshot.nodes[1].id).toBe('span2');
    expect(snapshot.nodes[1].type).toBe('tool');
    expect(snapshot.nodes[1].maturityTier).toBe('L2');

    // Should have 2 edges: 1 explicit L3 transition, and 1 fallback dependency from L2 parent-child relation
    expect(snapshot.edges).toHaveLength(2);
    const transitionEdge = snapshot.edges.find(e => e.type === 'delegation');
    expect(transitionEdge).toBeDefined();
    expect(transitionEdge!.source).toBe('span1');
    expect(transitionEdge!.target).toBe('span2');
  });

  it('filters out future spans when maxTimeNs is provided', () => {
    // At 1.5ms, only the root span has started
    const snapshot = projectTraceSnapshot('m1', 'main', spans, 1500000);
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.nodes[0].id).toBe('span1');
  });

  it('masks end_time_unix_nano and status of running spans at maxTimeNs', () => {
    // At 3ms, child_tool (span2) started at 2ms and ends at 4ms, so it is in-progress
    const snapshot = projectTraceSnapshot('m1', 'main', spans, 3000000);
    expect(snapshot.nodes).toHaveLength(2);
    const childNode = snapshot.nodes.find(n => n.id === 'span2');
    expect(childNode!.status).toBe('active');
  });
});

describe('projectReplay', () => {
  const spans = [
    {
      span_id: 'span1',
      trace_id: 'trace1',
      parent_span_id: null,
      name: 'root',
      start_time_unix_nano: '1780272001000000000',
      end_time_unix_nano: '1780272005000000000',
      status_code: 'OK',
      attributes: {
        'gen_ai.agent.id': 'agent1',
      },
    },
  ];

  const interrupts = [
    {
      interrupt_id: 'int1',
      agent_id: 'agent1',
      span_id: 'span1',
      reason: 'Need user confirmation',
      status: 'pending',
      created_at: '2026-06-01T00:00:02.000Z',
    },
  ];

  it('produces snapshots and chronological virtual events', () => {
    const replay = projectReplay('m1', 'main', spans, interrupts);
    
    // We expect events for:
    // 1. span1 started (at 1ms, L3 so task.started)
    // 2. interrupt int1 requested (at 2s / 2000ms)
    // 3. span1 completed (at 5ms)
    expect(replay.events).toHaveLength(3);
    expect(replay.events[0].event_type).toBe('task.started');
    expect(replay.events[1].event_type).toBe('interrupt.requested');
    expect(replay.events[2].event_type).toBe('span.completed');

    expect(replay.snapshots).toHaveLength(1); // One start timestamp for spans
  });

  it('Scenario 1: Planner -> Researcher -> Writer delegation chain', () => {
    const scenarioSpans = [
      {
        span_id: 'span-planner',
        trace_id: 'trace-scenario1',
        name: 'Planner execution',
        start_time_unix_nano: '1000000000',
        end_time_unix_nano: '2000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'planner-agent',
          'gen_ai.agent.name': 'Planner',
          'gen_ai.agent.role': 'Planning supervisor',
          'gen_ai.agent.framework': 'langgraph',
        },
        events: [
          {
            name: 'agent.handoff.requested',
            time: '2026-06-24T13:00:01.000Z',
            attributes: {
              'gen_ai.agent.handoff.target': 'researcher-agent',
              'gen_ai.agent.handoff.reason': 'Need research data',
            }
          }
        ]
      },
      {
        span_id: 'span-researcher',
        trace_id: 'trace-scenario1',
        name: 'Researcher execution',
        start_time_unix_nano: '3000000000',
        end_time_unix_nano: '4000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'researcher-agent',
          'gen_ai.agent.name': 'Researcher',
          'gen_ai.agent.role': 'Information lookup',
          'gen_ai.agent.framework': 'crewai',
        },
        events: [
          {
            name: 'agent.handoff.requested',
            time: '2026-06-24T13:00:03.000Z',
            attributes: {
              'gen_ai.agent.handoff.target': 'writer-agent',
              'gen_ai.agent.handoff.reason': 'Submit findings',
            }
          }
        ]
      },
      {
        span_id: 'span-writer',
        trace_id: 'trace-scenario1',
        name: 'Writer execution',
        start_time_unix_nano: '5000000000',
        end_time_unix_nano: '6000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'writer-agent',
          'gen_ai.agent.name': 'Writer',
          'gen_ai.agent.role': 'Document drafting',
          'gen_ai.agent.framework': 'custom',
        },
        events: []
      }
    ];

    const snapshot = projectTraceSnapshot('m-scen1', 'main', scenarioSpans);

    // Verify nodes were created with proper identity and state attributes
    expect(snapshot.nodes).toHaveLength(3);
    const plannerNode = snapshot.nodes.find(n => n.id === 'span-planner');
    expect(plannerNode).toBeDefined();
    expect(plannerNode!.agent_id).toBe('planner-agent');
    expect(plannerNode!.agent_role).toBe('Planning supervisor');
    expect(plannerNode!.framework).toBe('langgraph');
    expect(plannerNode!.start_time).toBeDefined();
    expect(plannerNode!.duration_ms).toBe(1000); // 2000 - 1000 = 1000ms

    const researcherNode = snapshot.nodes.find(n => n.id === 'span-researcher');
    expect(researcherNode).toBeDefined();
    expect(researcherNode!.agent_id).toBe('researcher-agent');
    expect(researcherNode!.framework).toBe('crewai');

    // Verify delegation edges exist
    expect(snapshot.edges).toHaveLength(2);
    const delegationEdges = snapshot.edges.filter(e => e.type === 'delegation');
    expect(delegationEdges).toHaveLength(2);

    const edge1 = delegationEdges.find(e => e.source === 'span-planner');
    expect(edge1).toBeDefined();
    expect(edge1!.target).toBe('span-researcher');
    expect(edge1!.source_span_id).toBe('span-planner');
    expect(edge1!.source_event_id).toBe('agent.handoff.requested');

    const edge2 = delegationEdges.find(e => e.source === 'span-researcher');
    expect(edge2).toBeDefined();
    expect(edge2!.target).toBe('span-writer');
    expect(edge2!.source_span_id).toBe('span-researcher');
    expect(edge2!.source_event_id).toBe('agent.handoff.requested');
  });

  it('Scenario 2: Writer <-> Reviewer review loop with strict targets', () => {
    const scenarioSpans = [
      {
        span_id: 'span-writer',
        trace_id: 'trace-scenario2',
        name: 'Writer execution',
        start_time_unix_nano: '1000000000',
        end_time_unix_nano: '2000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'writer-agent',
          'gen_ai.agent.name': 'Writer',
        },
        events: []
      },
      {
        span_id: 'span-reviewer-ok',
        trace_id: 'trace-scenario2',
        name: 'Reviewer execution OK',
        start_time_unix_nano: '3000000000',
        end_time_unix_nano: '4000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'reviewer-agent',
          'gen_ai.agent.name': 'Reviewer',
        },
        events: [
          {
            name: 'agent.review.approved',
            time: '2026-06-24T13:00:04.000Z',
            attributes: {
              'gen_ai.agent.review.target': 'writer-agent',
              'gen_ai.agent.review.result': 'approved',
            }
          }
        ]
      },
      {
        span_id: 'span-reviewer-missing',
        trace_id: 'trace-scenario2',
        name: 'Reviewer execution Missing Target',
        start_time_unix_nano: '5000000000',
        end_time_unix_nano: '6000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'reviewer-agent',
          'gen_ai.agent.name': 'Reviewer',
        },
        events: [
          {
            name: 'agent.review.rejected',
            time: '2026-06-24T13:00:05.000Z',
            attributes: {
              // Target is missing here
              'gen_ai.agent.review.result': 'rejected',
            }
          }
        ]
      }
    ];

    const snapshot = projectTraceSnapshot('m-scen2', 'main', scenarioSpans);

    // Verify reviewer-ok -> writer review edge is created
    const reviewEdges = snapshot.edges.filter(e => e.type === 'review');
    // It should ONLY project the review edge that has a target.
    // The missing target review must NOT generate an edge (no self-loops).
    expect(reviewEdges).toHaveLength(1);
    expect(reviewEdges[0].source).toBe('span-reviewer-ok');
    expect(reviewEdges[0].target).toBe('span-writer');
    expect(reviewEdges[0].source_span_id).toBe('span-reviewer-ok');
    expect(reviewEdges[0].source_event_id).toBe('agent.review.approved');
  });

  it('Scenario 3: Interrupt -> Approval -> Resume HITL lifecycle', () => {
    const scenarioSpans = [
      {
        span_id: 'span-writer',
        trace_id: 'trace-scenario3',
        name: 'Writer execution',
        start_time_unix_nano: '1000000000',
        end_time_unix_nano: '5000000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'writer-agent',
          'gen_ai.agent.name': 'Writer',
        },
        events: [
          {
            name: 'agent.interrupt.requested',
            time: '2026-06-24T13:00:02.000Z',
            attributes: {
              'gen_ai.agent.interrupt.id': 'int-123',
              'gen_ai.agent.interrupt.reason': 'Need payment confirmation',
            }
          },
          {
            name: 'agent.interrupt.resumed',
            time: '2026-06-24T13:00:04.000Z',
            attributes: {
              'gen_ai.agent.interrupt.id': 'int-123',
            }
          }
        ]
      }
    ];

    const interrupts = [
      {
        interrupt_id: 'int-123',
        mission_id: 'm-scen3',
        agent_id: 'writer-agent',
        span_id: 'span-writer',
        status: 'resumed',
        reason: 'Need payment confirmation',
        created_at: '2026-06-24T13:00:02.000Z',
        resumed_at: '2026-06-24T13:00:04.000Z',
        decided_at: '2026-06-24T13:00:04.000Z',
        decision: 'approve',
      }
    ];

    const replay = projectReplay('m-scen3', 'main', scenarioSpans, interrupts);

    // Verify no human node or approval edge is created in the snapshot
    const lastSnapshot = replay.snapshots[replay.snapshots.length - 1];
    const humanNodes = lastSnapshot.nodes.filter(n => n.type === 'human');
    const approvalEdges = lastSnapshot.edges.filter(e => e.type === 'approval');
    expect(humanNodes).toHaveLength(0);
    expect(approvalEdges).toHaveLength(0);

    // Verify chronological events on the timeline
    expect(replay.events).toHaveLength(7); // span start, end, 2 internal events, and 3 interrupt table events
    
    const reqEvent = replay.events.find(e => e.event_type === 'interrupt.requested');
    expect(reqEvent).toBeDefined();
    expect(reqEvent!.trace_id).toBe('trace-scenario3');
    expect(reqEvent!.source_span_id).toBe('span-writer');

    const decEvent = replay.events.find(e => e.event_type === 'interrupt.decision');
    expect(decEvent).toBeDefined();
    expect(decEvent!.trace_id).toBe('trace-scenario3');
    expect(decEvent!.source_span_id).toBe('span-writer');
    expect(decEvent!.payload.decision).toBe('approve');
  });
});
