import { AgentAttributes, AgentEvents, AgentSpanKind, OtlpSpan } from '@agentlens/protocol';
import { ROOT_BRANCH_ID, PendingMissionEvent } from './types.js';
import { attr, asNumber, nanoToIso, compareTimestamp } from './utils.js';

export const ATTR = {
  AGENT_ID: AgentAttributes.ID,
  AGENT_NAME: AgentAttributes.NAME,
  AGENT_ROLE: AgentAttributes.ROLE,
  AGENT_TEAM: AgentAttributes.TEAM,
  AGENT_GOAL: AgentAttributes.GOAL,
  AGENT_TASK: AgentAttributes.TASK,
  AGENT_CONFIDENCE: AgentAttributes.CONFIDENCE,
  AGENT_FRAMEWORK: AgentAttributes.FRAMEWORK,
  AGENT_SPAN_KIND: 'agent.span.kind',
  TOOL_NAME: AgentAttributes.TOOL_NAME,
  TOOL_STATUS: AgentAttributes.TOOL_STATUS,
  TOOL_INPUT: AgentAttributes.TOOL_INPUT,
  TOOL_OUTPUT: AgentAttributes.TOOL_OUTPUT,
  DELEGATION_TARGET: AgentAttributes.DELEGATION_TARGET,
  DELEGATION_REASON: AgentAttributes.DELEGATION_REASON,
  HANDOFF_TARGET: AgentAttributes.HANDOFF_TARGET,
  HANDOFF_REASON: AgentAttributes.HANDOFF_REASON,
  CRITIQUE_TARGET: AgentAttributes.CRITIQUE_TARGET,
  CRITIQUE_RESULT: AgentAttributes.CRITIQUE_RESULT,
  REVIEW_TARGET: AgentAttributes.REVIEW_TARGET,
  REVIEW_RESULT: AgentAttributes.REVIEW_RESULT,
  ESCALATION_TARGET: AgentAttributes.ESCALATION_TARGET,
  ESCALATION_REASON: AgentAttributes.ESCALATION_REASON,
  MEMORY_KEY: AgentAttributes.MEMORY_KEY,
  INTERRUPT_ID: AgentAttributes.INTERRUPT_ID,
  INTERRUPT_REASON: AgentAttributes.INTERRUPT_REASON,
  INTERRUPT_RESUME_URL: AgentAttributes.INTERRUPT_RESUME_URL,
  HUMAN_DECISION: AgentAttributes.HUMAN_DECISION,
  HUMAN_INPUT: AgentAttributes.HUMAN_INPUT,
  ARTIFACT_NAME: 'artifact.name',
  ARTIFACT_TYPE: 'artifact.type',
} as const;

export const EVENT_PRIORITY: Record<string, number> = {
  'agent.registered': 0,
  'mission.created': 0,
  'mission.updated': 0,
  'mission.phase_changed': 0,
  'mission.status_changed': 0,
  'span.started': 10,
  'task.started': 20,
  'tool.called': 20,
  'delegation': 30,
  'handoff.requested': 30,
  'handoff.accepted': 30,
  'handoff.rejected': 30,
  'critique': 40,
  'review.started': 40,
  'review.approved': 40,
  'review.changes_requested': 40,
  'review.rejected': 40,
  'escalation': 50,
  'memory.written': 50,
  'artifact.created': 50,
  'artifact.updated': 50,
  'interrupt.requested': 60,
  'interrupt.decision': 70,
  'interrupt.resumed': 80,
  'tool.completed': 90,
  'tool.failed': 90,
  'task.completed': 90,
  'task.failed': 90,
  'span.completed': 100,
  'span.failed': 100,
};

export function comparePendingEvents(left: PendingMissionEvent, right: PendingMissionEvent): number {
  const byTime = compareTimestamp(left.timestamp, right.timestamp);
  if (byTime !== 0) return byTime;
  const bySpan = (left.span_id ?? '').localeCompare(right.span_id ?? '');
  if (bySpan !== 0) return bySpan;
  const byPriority = (EVENT_PRIORITY[left.event_type] ?? 500) - (EVENT_PRIORITY[right.event_type] ?? 500);
  if (byPriority !== 0) return byPriority;
  return left.event_type.localeCompare(right.event_type);
}

export function createPendingEvent(input: PendingMissionEvent): PendingMissionEvent {
  return {
    ...input,
    payload: input.payload ?? {},
    metadata: input.metadata ?? {},
  };
}

export function normalizeSpansToMissionEvents(
  missionId: string,
  spans: OtlpSpan[],
  branchId = ROOT_BRANCH_ID,
): PendingMissionEvent[] {
  const pending: PendingMissionEvent[] = [];
  const seenAgents = new Set<string>();

  const sortedSpans = [...spans].sort((left, right) => {
    if (left.start_time_unix_nano !== right.start_time_unix_nano) {
      return left.start_time_unix_nano - right.start_time_unix_nano;
    }
    if (left.end_time_unix_nano !== right.end_time_unix_nano) {
      return left.end_time_unix_nano - right.end_time_unix_nano;
    }
    return left.span_id.localeCompare(right.span_id);
  });

  for (const span of sortedSpans) {
    const attrs = span.attributes ?? {};
    const agentId = attr(attrs, ATTR.AGENT_ID);
    const agentName = attr(attrs, ATTR.AGENT_NAME);
    const agentRole = attr(attrs, ATTR.AGENT_ROLE);
    const agentTeam = attr(attrs, ATTR.AGENT_TEAM);
    const task = attr(attrs, ATTR.AGENT_TASK);
    const confidence = asNumber(attr(attrs, ATTR.AGENT_CONFIDENCE));
    const spanKind = attr(attrs, ATTR.AGENT_SPAN_KIND) ?? '';
    const startTimestamp = nanoToIso(span.start_time_unix_nano);
    const endTimestamp = nanoToIso(span.end_time_unix_nano);

    if (agentId && !seenAgents.has(agentId)) {
      seenAgents.add(agentId);
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: 'agent.registered',
          timestamp: startTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            name: agentName,
            role: agentRole,
            team: agentTeam,
            summary: attr(attrs, ATTR.AGENT_GOAL),
            confidence,
            framework: attr(attrs, ATTR.AGENT_FRAMEWORK),
          },
        }),
      );
    }

    pending.push(
      createPendingEvent({
        mission_id: missionId,
        branch_id: branchId,
        event_type: 'span.started',
        timestamp: startTimestamp,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
        payload: {
          agent_id: agentId,
          agent_name: agentName,
          agent_role: agentRole,
          span_kind: spanKind,
          operation_name: span.operation_name,
          task,
          status_code: span.status_code,
        },
      }),
    );

    if (task && spanKind === AgentSpanKind.AGENT_TASK) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: 'task.started',
          timestamp: startTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            task,
            task_id: `task-${span.span_id.slice(0, 8)}`,
          },
        }),
      );
    }

    const toolName = attr(attrs, ATTR.TOOL_NAME);
    if (toolName && spanKind === AgentSpanKind.TOOL_CALL) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: 'tool.called',
          timestamp: startTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            tool_name: toolName,
            tool_id: `tool-${span.span_id.slice(0, 8)}`,
            tool_input: attr(attrs, ATTR.TOOL_INPUT),
          },
        }),
      );
    }

    for (const eventEntry of [...(span.events ?? [])].sort((left, right) => {
      return Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0);
    })) {
      const eventName = eventEntry.name ?? '';
      const eventAttrs = eventEntry.attributes ?? {};
      const timestamp = nanoToIso(eventEntry.timestamp);
      const common = {
        mission_id: missionId,
        branch_id: branchId,
        timestamp,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
      };

      if (eventName === AgentEvents.DELEGATION) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'delegation',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.DELEGATION_TARGET),
              reason: attr(eventAttrs, ATTR.DELEGATION_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.HANDOFF_REQUESTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'handoff.requested',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.HANDOFF_TARGET),
              reason: attr(eventAttrs, ATTR.HANDOFF_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.HANDOFF_ACCEPTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'handoff.accepted',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.HANDOFF_TARGET),
              reason: attr(eventAttrs, ATTR.HANDOFF_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.HANDOFF_REJECTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'handoff.rejected',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.HANDOFF_TARGET),
              reason: attr(eventAttrs, ATTR.HANDOFF_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.CRITIQUE) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'critique',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.CRITIQUE_TARGET),
              result: attr(eventAttrs, ATTR.CRITIQUE_RESULT),
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.started',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT),
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW_APPROVED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.approved',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT) ?? 'approved',
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW_CHANGES_REQUESTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.changes_requested',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT) ?? 'changes_requested',
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW_REJECTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.rejected',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT) ?? 'rejected',
            },
          }),
        );
      } else if (eventName === AgentEvents.ESCALATION) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'escalation',
            payload: {
              agent_id: agentId,
              target: attr(eventAttrs, ATTR.ESCALATION_TARGET),
              reason: attr(eventAttrs, ATTR.ESCALATION_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.MEMORY_WRITE) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'memory.written',
            payload: {
              agent_id: agentId,
              memory_key: attr(eventAttrs, ATTR.MEMORY_KEY) ?? 'shared_memory',
            },
          }),
        );
      } else if (eventName === AgentEvents.ARTIFACT_CREATED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'artifact.created',
            payload: {
              agent_id: agentId,
              artifact_name: attr(eventAttrs, ATTR.ARTIFACT_NAME),
              artifact_type: attr(eventAttrs, ATTR.ARTIFACT_TYPE),
            },
          }),
        );
      } else if (eventName === AgentEvents.ARTIFACT_UPDATED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'artifact.updated',
            payload: {
              agent_id: agentId,
              artifact_name: attr(eventAttrs, ATTR.ARTIFACT_NAME),
              artifact_type: attr(eventAttrs, ATTR.ARTIFACT_TYPE),
            },
          }),
        );
      } else if (eventName === AgentEvents.INTERRUPT_REQUESTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'interrupt.requested',
            payload: {
              agent_id: agentId,
              interrupt_id: attr(eventAttrs, ATTR.INTERRUPT_ID) ?? `${span.span_id}:interrupt`,
              reason: attr(eventAttrs, ATTR.INTERRUPT_REASON) ?? 'Human input required',
              resume_url: attr(eventAttrs, ATTR.INTERRUPT_RESUME_URL),
              attributes: eventAttrs,
            },
          }),
        );
      } else if (eventName === AgentEvents.INTERRUPT_RESUMED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'interrupt.resumed',
            payload: {
              agent_id: agentId,
              interrupt_id: attr(eventAttrs, ATTR.INTERRUPT_ID) ?? `${span.span_id}:interrupt`,
            },
          }),
        );
      } else if (eventName === AgentEvents.HUMAN_DECISION) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'interrupt.decision',
            payload: {
              agent_id: agentId,
              interrupt_id: attr(eventAttrs, ATTR.INTERRUPT_ID) ?? `${span.span_id}:interrupt`,
              decision: attr(eventAttrs, ATTR.HUMAN_DECISION),
              comment: attr(eventAttrs, ATTR.HUMAN_INPUT),
            },
          }),
        );
      } else if (eventName === AgentEvents.TOOL_RESULT) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'tool.completed',
            payload: {
              agent_id: agentId,
              tool_name: toolName,
              tool_id: `tool-${span.span_id.slice(0, 8)}`,
              tool_output: attr(eventAttrs, ATTR.TOOL_OUTPUT),
            },
          }),
        );
      } else if (eventName === AgentEvents.TOOL_ERROR) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'tool.failed',
            payload: {
              agent_id: agentId,
              tool_name: toolName,
              tool_id: `tool-${span.span_id.slice(0, 8)}`,
              tool_status: attr(eventAttrs, ATTR.TOOL_STATUS) ?? 'error',
            },
          }),
        );
      }
    }

    if (toolName && spanKind === AgentSpanKind.TOOL_CALL && !(span.events ?? []).some((event) => event.name === AgentEvents.TOOL_RESULT || event.name === AgentEvents.TOOL_ERROR)) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: span.status_code === 'ERROR' ? 'tool.failed' : 'tool.completed',
          timestamp: endTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            tool_name: toolName,
            tool_id: `tool-${span.span_id.slice(0, 8)}`,
          },
        }),
      );
    }

    if (task && spanKind === AgentSpanKind.AGENT_TASK) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: span.status_code === 'ERROR' ? 'task.failed' : 'task.completed',
          timestamp: endTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            task,
            task_id: `task-${span.span_id.slice(0, 8)}`,
          },
        }),
      );
    }

    pending.push(
      createPendingEvent({
        mission_id: missionId,
        branch_id: branchId,
        event_type: span.status_code === 'ERROR' ? 'span.failed' : 'span.completed',
        timestamp: endTimestamp,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
        payload: {
          agent_id: agentId,
          agent_name: agentName,
          agent_role: agentRole,
          span_kind: spanKind,
          operation_name: span.operation_name,
          task,
          status_code: span.status_code,
        },
      }),
    );
  }

  return pending.sort(comparePendingEvents);
}
