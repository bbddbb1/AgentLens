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

  it('does not promote workload namespaces into L3', () => {
    const span = {
      span_id: 's1',
      name: 'agent.run',
      attributes: {
        'basestation.aiops.agent.id': 'agent-1',
        'basestation.aiops.agent.name': 'Orchestrator',
      },
    };
    expect(classifySpan(span)).toBe('L1');
  });

  it('classifies standard agent runtime attributes as L3', () => {
    const span = {
      span_id: 's1',
      name: 'agent.run',
      attributes: {
        'gen_ai.agent.id': 'agent-1',
        'gen_ai.agent.name': 'Orchestrator',
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
    expect(snapshot.nodes[0].label).toBe('Agent · SuperAgent');
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

  it('routes MAF-normalized identity through the existing snapshot projection', () => {
    const snapshot = projectTraceSnapshot('m-maf', 'main', [{
      span_id: 'maf-executor',
      trace_id: 'maf-trace',
      name: 'executor.process agentlens-reference-executor',
      start_time_unix_nano: '100',
      end_time_unix_nano: '200',
      status_code: 'OK',
      attributes: {
        'workflow.id': 'workflow-1',
        'executor.id': 'agentlens-reference-executor',
        'agentlens.maf.request_id': 'request-1',
      },
    }]);

    expect(snapshot.nodes[0]?.metadata?.native_runtime_identity).toMatchObject({
      framework: 'ms_agent_framework',
      workflow_id: 'workflow-1',
      request_id: 'request-1',
    });
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

  it('does not fabricate edges for unresolved relationship targets or timing overlap', () => {
    const snapshot = projectTraceSnapshot('m1', 'main', [
      {
        span_id: 'source', trace_id: 'trace', name: 'agent.run',
        start_time_unix_nano: '1000000', end_time_unix_nano: '3000000', status_code: 'OK',
        attributes: { 'gen_ai.agent.id': 'planner' },
        events: [{ name: 'agent.handoff.requested', attributes: { 'gen_ai.agent.handoff.target': 'missing-agent' } }],
      },
      {
        span_id: 'overlap', trace_id: 'trace', name: 'agent.run',
        start_time_unix_nano: '2000000', end_time_unix_nano: '4000000', status_code: 'OK',
        attributes: { 'gen_ai.agent.id': 'worker' }, events: [],
      },
    ]);

    expect(snapshot.nodes.map((node) => node.id)).toEqual(['source', 'overlap']);
    expect(snapshot.edges).toEqual([]);
  });

  it('requires explicit LangGraph handoff evidence and carries native identity metadata', () => {
    const base = {
      trace_id: 'trace-lg',
      start_time_unix_nano: '1000000',
      end_time_unix_nano: '2000000',
      status_code: 'OK',
    };
    const snapshot = projectTraceSnapshot('m1', 'main', [
      {
        ...base,
        span_id: 'planner',
        attributes: {
          'gen_ai.agent.id': 'planner',
          'agentlens.langgraph.run_id': 'run-planner',
          'agentlens.langgraph.thread_id': 'thread-1',
        },
        events: [{
          name: 'agent.handoff.requested',
          attributes: { 'gen_ai.agent.handoff.target': 'worker' },
        }],
      },
      {
        ...base,
        span_id: 'worker',
        start_time_unix_nano: '3000000',
        attributes: {
          'gen_ai.agent.id': 'worker',
          'agentlens.langgraph.run_id': 'run-worker',
        },
      },
    ]);

    expect(snapshot.edges.filter((edge) => edge.type === 'delegation')).toHaveLength(0);
    expect(snapshot.nodes.find((node) => node.id === 'planner')?.metadata).toMatchObject({
      native_runtime_identity: {
        framework: 'langgraph',
        thread_id: 'thread-1',
        run_id: 'run-planner',
      },
    });
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
    expect(replay.projection_version).toBe('span_projection.v1');
  });

  it('emits task.started (not tool.called) for execute_tool span start', () => {
    const toolSpan = {
      span_id: 'tool-span',
      trace_id: 'trace-tool',
      parent_span_id: null,
      name: 'execute_tool',
      operation_name: 'execute_tool',
      start_time_unix_nano: '1000000000',
      end_time_unix_nano: '2000000000',
      status_code: 'OK',
      attributes: {
        'gen_ai.agent.id': 'diagnosis',
        'agent.span.kind': 'execute_tool',
        'gen_ai.tool.name': 'search_topology',
      },
      events: [
        {
          name: 'tool.called',
          time: '2026-06-24T13:00:01.000Z',
          attributes: {
            'gen_ai.tool.name': 'search_topology',
            'gen_ai.tool.input': '{"query":"sector-3"}',
            'gen_ai.tool.output': '{"nodes":2}',
          },
        },
      ],
    };
    const replay = projectReplay('m-tool', 'main', [toolSpan]);
    const startEvent = replay.events.find((e) => e.id === 'tool-span');
    expect(startEvent?.event_type).toBe('task.started');
    const toolCalled = replay.events.filter((e) => e.event_type === 'tool.called');
    expect(toolCalled).toHaveLength(1);
    expect(toolCalled[0]?.payload?.['gen_ai.tool.input']).toBe('{"query":"sector-3"}');
  });

  it('preserves workload span events verbatim without projecting domain meaning', () => {
    const span = {
      span_id: 'diag-span',
      trace_id: 'trace-diag',
      parent_span_id: null,
      name: 'diagnosis',
      start_time_unix_nano: '1000000000',
      end_time_unix_nano: '3000000000',
      status_code: 'OK',
      attributes: {
        'gen_ai.agent.id': 'diagnosis',
      },
      events: [
        {
          name: 'basestation.aiops.hypothesis.proposed',
          time: '2026-06-24T13:00:01.000Z',
          attributes: {
            'hypothesis.description': 'Power amplifier failure',
            'hypothesis.confidence': 0.82,
          },
        },
        {
          name: 'basestation.aiops.decision.made',
          time: '2026-06-24T13:00:02.000Z',
          attributes: {
            'decision.type': 'remediation',
            'decision.summary': 'Replace PA module',
          },
        },
      ],
    };
    const replay = projectReplay('m-diag', 'main', [span]);
    const hypothesis = replay.events.find((e) => e.event_type === 'basestation.aiops.hypothesis.proposed');
    const decision = replay.events.find((e) => e.event_type === 'basestation.aiops.decision.made');
    expect(hypothesis?.payload?.['hypothesis.description']).toBe('Power amplifier failure');
    expect(decision?.payload?.['decision.summary']).toBe('Replace PA module');
    expect(replay.events.some((e) => e.event_type === 'hypothesis.proposed')).toBe(false);
    expect(replay.events.some((e) => e.event_type === 'decision.made')).toBe(false);
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

describe('projectReplay runtime agent state', () => {
  it('populates current_state.agents from projected events', () => {
    const spans = [
      {
        span_id: 'agent-span',
        trace_id: 't1',
        parent_span_id: null,
        operation_name: 'invoke_agent',
        start_time_unix_nano: '1000000',
        end_time_unix_nano: '2000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'diagnosis',
          'gen_ai.agent.name': 'diagnosis',
          'gen_ai.agent.role': 'diagnosis',
          'gen_ai.agent.framework': 'langgraph',
          'agent.span.kind': 'invoke_agent',
        },
        events: [],
      },
    ];

    const replay = projectReplay('m-agents', 'main', spans);
    expect(Object.keys(replay.current_state?.agents ?? {})).toContain('diagnosis');
    expect(replay.current_state?.agents.diagnosis?.status).toBe('completed');
    expect(replay.current_state?.agents.diagnosis?.role).toBe('diagnosis');
    expect(replay.events.find((e) => e.event_type === 'task.started')?.origin_framework).toBe('langgraph');
  });
});

describe('provenance assembly from verbatim attributes', () => {
  it('assembles ModelProvenance from individual gen_ai.* attributes', () => {
    const spans = [
      {
        span_id: 'llm-1',
        trace_id: 't1',
        parent_span_id: null,
        name: 'llm.completion',
        start_time_unix_nano: '1000000',
        end_time_unix_nano: '2000000',
        status_code: 'OK',
        attributes: {
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.model.version': '2024-08-06',
          'gen_ai.usage.input_tokens': 42,
          'gen_ai.usage.output_tokens': 7,
          'gen_ai.request.temperature': 0.2,
          'gen_ai.response.finish_reason': 'stop',
        },
      },
    ];
    const snapshot = projectTraceSnapshot('m', 'main', spans);
    // The L2 node carries the model provenance on its envelope payload.
    const node = snapshot.nodes.find(n => n.id === 'llm-1');
    expect(node).toBeDefined();
    // Universal node identity foregrounds the activity type + model.
    expect(node!.label).toContain('LLM');
    expect(node!.label).toContain('gpt-4o');
  });

  it('assembles ErrorAttribution from individual error.* attributes', () => {
    const spans = [
      {
        span_id: 'tool-1',
        trace_id: 't1',
        parent_span_id: null,
        name: 'tool.invoke',
        start_time_unix_nano: '1000000',
        end_time_unix_nano: '2000000',
        status_code: 'ERROR',
        attributes: {
          'gen_ai.tool.name': 'ping',
          'error.source': 'tool',
          'error.cause': 'tool_failure',
          'error.severity': 'high',
          'error.original': 'connection refused',
          'error.recovery.action': 'retry',
        },
      },
    ];
    const snapshot = projectTraceSnapshot('m', 'main', spans);
    const node = snapshot.nodes.find(n => n.id === 'tool-1');
    expect(node).toBeDefined();
    expect(node!.error_count).toBe(1);
  });
});
