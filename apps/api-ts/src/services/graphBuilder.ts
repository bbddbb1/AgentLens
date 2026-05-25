import { randomUUID } from 'node:crypto';
import { AgentAttributes, AgentEvents, AgentSpanKind } from '@agentlens/protocol';
import type { EdgeStatus, EdgeType, GraphEdge, GraphNode, GraphSnapshot, NodeStatus, OtlpSpan } from '../types/graph.js';

const ATTR = {
  AGENT_ID: AgentAttributes.ID,
  AGENT_ROLE: AgentAttributes.ROLE,
  AGENT_NAME: AgentAttributes.NAME,
  AGENT_TEAM: AgentAttributes.TEAM,
  AGENT_CONFIDENCE: AgentAttributes.CONFIDENCE,
  AGENT_GOAL: AgentAttributes.GOAL,
  AGENT_TASK: AgentAttributes.TASK,
  AGENT_SPAN_KIND: 'agent.span.kind',
  TOOL_NAME: AgentAttributes.TOOL_NAME,
  FRAMEWORK: AgentAttributes.FRAMEWORK,
  DELEGATION_TARGET: AgentAttributes.DELEGATION_TARGET,
  DELEGATION_REASON: AgentAttributes.DELEGATION_REASON,
  CRITIQUE_TARGET: AgentAttributes.CRITIQUE_TARGET,
  CRITIQUE_RESULT: AgentAttributes.CRITIQUE_RESULT,
  REVIEW_TARGET: AgentAttributes.REVIEW_TARGET,
  REVIEW_RESULT: AgentAttributes.REVIEW_RESULT,
  HANDOFF_TARGET: AgentAttributes.HANDOFF_TARGET,
  HANDOFF_REASON: AgentAttributes.HANDOFF_REASON,
  ESCALATION_TARGET: AgentAttributes.ESCALATION_TARGET,
  ESCALATION_REASON: AgentAttributes.ESCALATION_REASON,
  MEMORY_KEY: AgentAttributes.MEMORY_KEY,
  INTERRUPT_ID: AgentAttributes.INTERRUPT_ID,
  ARTIFACT_NAME: 'artifact.name',
  ARTIFACT_TYPE: 'artifact.type',
} as const;

const EVENTS = {
  DELEGATION: AgentEvents.DELEGATION,
  HANDOFF: AgentEvents.HANDOFF,
  HANDOFF_REQUESTED: AgentEvents.HANDOFF_REQUESTED,
  HANDOFF_ACCEPTED: AgentEvents.HANDOFF_ACCEPTED,
  HANDOFF_REJECTED: AgentEvents.HANDOFF_REJECTED,
  CRITIQUE: AgentEvents.CRITIQUE,
  REVIEW: AgentEvents.REVIEW,
  REVIEW_APPROVED: AgentEvents.REVIEW_APPROVED,
  REVIEW_CHANGES_REQUESTED: AgentEvents.REVIEW_CHANGES_REQUESTED,
  REVIEW_REJECTED: AgentEvents.REVIEW_REJECTED,
  ESCALATION: AgentEvents.ESCALATION,
  INTERRUPT_REQUESTED: AgentEvents.INTERRUPT_REQUESTED,
  MEMORY_WRITE: AgentEvents.MEMORY_WRITE,
  TOOL_CALL: AgentEvents.TOOL_CALL,
  ARTIFACT_CREATED: AgentEvents.ARTIFACT_CREATED,
  ARTIFACT_UPDATED: AgentEvents.ARTIFACT_UPDATED,
} as const;

const SPAN_KIND = {
  TASK: AgentSpanKind.AGENT_TASK,
  TOOL_CALL: AgentSpanKind.TOOL_CALL,
} as const;

const REVIEW_EVENTS = new Set<string>([
  EVENTS.REVIEW,
  EVENTS.REVIEW_APPROVED,
  EVENTS.REVIEW_CHANGES_REQUESTED,
  EVENTS.REVIEW_REJECTED,
]);

const HANDOFF_EVENTS = new Set<string>([
  EVENTS.HANDOFF,
  EVENTS.HANDOFF_REQUESTED,
  EVENTS.HANDOFF_ACCEPTED,
  EVENTS.HANDOFF_REJECTED,
]);

function attr(attrs: OtlpSpan['attributes'], key: string): string | undefined {
  const value = attrs[key];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(',') : String(value);
}

function spanStatusToNodeStatus(statusCode: string): NodeStatus {
  if (statusCode === 'OK') return 'completed';
  if (statusCode === 'ERROR') return 'failed';
  if (statusCode === 'UNSET') return 'active';
  return 'active';
}

function edge(type: EdgeType, input: Omit<GraphEdge, 'type'>): GraphEdge {
  return { ...input, type };
}

export function buildGraphSnapshot(spans: OtlpSpan[], missionId: string, baseSnapshot?: GraphSnapshot): GraphSnapshot {
  const nodes = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const agentPositions = new Map<string, number>();
  let positionCounter = 0;
  const baseNodeMap = new Map<string, GraphNode>();

  for (const node of baseSnapshot?.nodes ?? []) {
    nodes.set(node.id, node);
    baseNodeMap.set(node.id, node);
    if (node.type === 'agent' && node.agent_id) {
      agentPositions.set(node.agent_id, positionCounter++);
    }
  }

  for (const edge of baseSnapshot?.edges ?? []) {
    edgeMap.set(edge.id, edge);
  }

  for (const span of spans) {
    const attrs = span.attributes ?? {};
    const agentId = attr(attrs, ATTR.AGENT_ID);
    const agentRole = attr(attrs, ATTR.AGENT_ROLE) ?? 'agent';
    const agentName = attr(attrs, ATTR.AGENT_NAME) ?? agentId ?? 'Unknown';
    const spanKind = attr(attrs, ATTR.AGENT_SPAN_KIND) ?? '';

    if (agentId && !nodes.has(agentId)) {
      if (!agentPositions.has(agentId)) {
        agentPositions.set(agentId, positionCounter++);
      }
      const positionIndex = agentPositions.get(agentId) ?? 0;
      const basePosition = baseNodeMap.get(agentId)?.position;
      nodes.set(agentId, {
        id: agentId,
        type: 'agent',
        label: agentName,
        status: 'active',
        position: basePosition ?? { x: positionIndex * 250, y: 0 },
        agent_id: agentId,
        agent_role: agentRole,
        agent_team: attr(attrs, ATTR.AGENT_TEAM),
        confidence: attr(attrs, ATTR.AGENT_CONFIDENCE) ? Number(attr(attrs, ATTR.AGENT_CONFIDENCE)) : undefined,
        summary: attr(attrs, ATTR.AGENT_GOAL),
        span_id: span.span_id,
        trace_id: span.trace_id,
        metadata: {
          framework: attr(attrs, ATTR.FRAMEWORK) ?? '',
        },
      });
    }

    const taskDescription = attr(attrs, ATTR.AGENT_TASK);
    if (taskDescription && spanKind === SPAN_KIND.TASK) {
      const taskNodeId = `task-${span.span_id.slice(0, 8)}`;
      nodes.set(taskNodeId, {
        id: taskNodeId,
        type: 'task',
        label: taskDescription.slice(0, 80),
        status: spanStatusToNodeStatus(span.status_code),
        position: {
          x: (agentPositions.get(agentId ?? '') ?? 0) * 250,
          y: 150,
        },
        summary: taskDescription,
        span_id: span.span_id,
        trace_id: span.trace_id,
      });

      if (agentId) {
        edgeMap.set(
          `e-${agentId}-${taskNodeId}`,
          edge('dependency', {
            id: `e-${agentId}-${taskNodeId}`,
            source: agentId,
            target: taskNodeId,
            label: 'executes',
            status: 'active',
          }),
        );
      }
    }

    const toolName = attr(attrs, ATTR.TOOL_NAME);
    if (toolName && spanKind === SPAN_KIND.TOOL_CALL) {
      const toolNodeId = `tool-${toolName}`;
      if (!nodes.has(toolNodeId)) {
        nodes.set(toolNodeId, {
          id: toolNodeId,
          type: 'tool',
          label: toolName,
          status: spanStatusToNodeStatus(span.status_code),
          position: {
            x: (agentPositions.get(agentId ?? '') ?? 0) * 250 + 125,
            y: 300,
          },
          span_id: span.span_id,
        });
      }

      if (agentId) {
        edgeMap.set(
          `e-${agentId}-${toolNodeId}-${span.span_id.slice(0, 6)}`,
          edge('uses', {
            id: `e-${agentId}-${toolNodeId}-${span.span_id.slice(0, 6)}`,
            source: agentId,
            target: toolNodeId,
            label: 'calls',
            status: 'active',
            animated: true,
          }),
        );
      }
    }

    for (const eventEntry of span.events ?? []) {
      const eventName = eventEntry.name ?? '';
      const eventAttrs = eventEntry.attributes ?? {};

      if (eventName === EVENTS.DELEGATION || HANDOFF_EVENTS.has(eventName)) {
        const targetAgent = attr(eventAttrs, ATTR.HANDOFF_TARGET) ?? attr(eventAttrs, ATTR.DELEGATION_TARGET);
        if (agentId && targetAgent) {
          const reason = attr(eventAttrs, ATTR.HANDOFF_REASON) ?? attr(eventAttrs, ATTR.DELEGATION_REASON) ?? '';
          const status: EdgeStatus =
            eventName === EVENTS.HANDOFF_REQUESTED ? 'pending' :
            eventName === EVENTS.HANDOFF_ACCEPTED ? 'completed' :
            eventName === EVENTS.HANDOFF_REJECTED ? 'failed' :
            'active';

          edgeMap.set(
            `e-del-${agentId}-${targetAgent}-${span.span_id.slice(0, 6)}`,
            edge('delegation', {
              id: `e-del-${agentId}-${targetAgent}-${span.span_id.slice(0, 6)}`,
              source: agentId,
              target: targetAgent,
              label: eventName === EVENTS.DELEGATION ? 'delegates' : 'handoff',
              status,
              animated: true,
              metadata: {
                reason,
              },
            }),
          );
        }
      } else if (eventName === EVENTS.CRITIQUE) {
        const targetAgent = attr(eventAttrs, ATTR.CRITIQUE_TARGET);
        if (agentId && targetAgent) {
          edgeMap.set(
            `e-crit-${agentId}-${targetAgent}-${span.span_id.slice(0, 6)}`,
            edge('critique', {
              id: `e-crit-${agentId}-${targetAgent}-${span.span_id.slice(0, 6)}`,
              source: agentId,
              target: targetAgent,
              label: `critique: ${attr(eventAttrs, ATTR.CRITIQUE_RESULT) ?? ''}`,
              status: 'active',
            }),
          );
        }
      } else if (REVIEW_EVENTS.has(eventName)) {
        if (agentId) {
          const targetAgent = attr(eventAttrs, ATTR.REVIEW_TARGET) ?? agentId;
          edgeMap.set(
            `e-rev-${agentId}-${span.span_id.slice(0, 6)}`,
            edge('review', {
              id: `e-rev-${agentId}-${span.span_id.slice(0, 6)}`,
              source: agentId,
              target: targetAgent,
              label: `review: ${attr(eventAttrs, ATTR.REVIEW_RESULT) ?? eventName.replace('agent.review.', '')}`,
              status: 'active',
            }),
          );
        }
      } else if (eventName === EVENTS.ESCALATION) {
        const target = attr(eventAttrs, ATTR.ESCALATION_TARGET);
        if (agentId && target) {
          if (!nodes.has(target)) {
            nodes.set(target, {
              id: target,
              type: 'human',
              label: target,
              status: 'waiting',
              position: { x: 0, y: -150 },
            });
          }

          edgeMap.set(
            `e-esc-${agentId}-${target}-${span.span_id.slice(0, 6)}`,
            edge('escalation', {
              id: `e-esc-${agentId}-${target}-${span.span_id.slice(0, 6)}`,
              source: agentId,
              target,
              label: 'escalates',
              status: 'active',
              animated: true,
            }),
          );
        }
      } else if (eventName === EVENTS.MEMORY_WRITE) {
        const memoryKey = attr(eventAttrs, ATTR.MEMORY_KEY) ?? 'shared_memory';
        const memoryNodeId = `mem-${memoryKey}`;
        if (!nodes.has(memoryNodeId)) {
          nodes.set(memoryNodeId, {
            id: memoryNodeId,
            type: 'memory',
            label: memoryKey,
            status: 'active',
            position: { x: 500, y: 150 },
          });
        }

        if (agentId) {
          edgeMap.set(
            `e-mem-${agentId}-${memoryNodeId}-${span.span_id.slice(0, 6)}`,
            edge('data_flow', {
              id: `e-mem-${agentId}-${memoryNodeId}-${span.span_id.slice(0, 6)}`,
              source: agentId,
              target: memoryNodeId,
              label: 'writes',
              status: 'active',
            }),
          );
        }
      } else if (eventName === EVENTS.ARTIFACT_CREATED || eventName === EVENTS.ARTIFACT_UPDATED) {
        const artifactName = attr(eventAttrs, ATTR.ARTIFACT_NAME);
        if (!artifactName) continue;
        const artifactType = attr(eventAttrs, ATTR.ARTIFACT_TYPE) ?? 'document';
        const artifactId = `artifact-${artifactName.toLowerCase().replace(/\s+/g, '-')}`;
        if (!nodes.has(artifactId)) {
          nodes.set(artifactId, {
            id: artifactId,
            type: 'artifact',
            label: artifactName,
            status: 'active',
            position: {
              x: (agentPositions.get(agentId ?? '') ?? 0) * 250 + 200,
              y: 350,
            },
            span_id: span.span_id,
            trace_id: span.trace_id,
            metadata: {
              artifact_type: artifactType,
            },
          });
        }

        if (agentId) {
          edgeMap.set(
            `e-art-${agentId}-${artifactId}-${span.span_id.slice(0, 6)}`,
            edge('produces', {
              id: `e-art-${agentId}-${artifactId}-${span.span_id.slice(0, 6)}`,
              source: agentId,
              target: artifactId,
              label: 'produces',
              status: 'active',
              animated: true,
            }),
          );
        }
      }
    }
  }

  return {
    id: randomUUID(),
    mission_id: missionId,
    sequence_num: 0,
    timestamp: new Date().toISOString(),
    nodes: Array.from(nodes.values()),
    edges: Array.from(edgeMap.values()),
  };
}
