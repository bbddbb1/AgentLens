import type {
  MissionEventRecord,
  NodeProjectionFacts,
  NodeProjectionGenerated,
  ProjectNodeStateInput,
  RuntimeNodeProjection,
} from '../types.js';
import {
  NODE_GENERATED_PROJECTION_VERSION,
  NODE_PROJECTION_VERSION,
  DETERMINISTIC_PROMPT_VERSION,
} from './runtimeProjection.js';
import { buildDeterministicUnderstanding } from './deterministicUnderstanding.js';
import {
  applyEventToScratch,
  createMissionScratch,
  scanEventsToScratch,
  statusLabel,
  type AgentNodeScratch,
  type MissionProjectionScratch,
} from './projectionScratch.js';

export interface ProjectAllNodeStatesInput {
  mission_id: string;
  branch_id: string;
  events: MissionEventRecord[];
  up_to_sequence_num?: number;
  phase?: string;
}

function scratchToFacts(agent: AgentNodeScratch): NodeProjectionFacts {
  return {
    role: agent.objective ?? agent.role,
    status: agent.status,
    status_label: statusLabel(agent.status),
    produced_outputs: agent.produced_outputs,
    next_transition: agent.next_transition,
    pending: agent.pending ?? null,
    warnings: agent.warnings,
    requires_human: agent.requires_human,
    agent_id: agent.agent_id,
    agent_type: agent.agent_type,
    framework: agent.framework,
    iteration: agent.iteration,
    start_time: agent.start_time,
    end_time: agent.end_time,
    duration_ms: agent.duration_ms,
    error_count: agent.error_count,
    source_span_id: agent.source_span_id,
    source_event_id: agent.source_event_id,
    confidence: agent.confidence !== undefined
      ? agent.confidence
      : Math.max(0.1, 1.0 - (agent.error_count * 0.15) - (agent.warnings.length * 0.05)),
    drift_score: agent.drift_score,
  };
}

function buildGeneratedBlock(facts: NodeProjectionFacts, agentName: string): NodeProjectionGenerated {
  return {
    projection_version: NODE_GENERATED_PROJECTION_VERSION,
    prompt_version: DETERMINISTIC_PROMPT_VERSION,
    source: 'deterministic',
    generated_at: new Date().toISOString(),
    current_understanding: buildDeterministicUnderstanding(facts, agentName),
  };
}

function buildNodeProjection(
  scratch: MissionProjectionScratch,
  agentId: string,
  agent: AgentNodeScratch,
  input: { mission_id: string; branch_id: string; sequence_num: number },
): RuntimeNodeProjection {
  const facts = scratchToFacts(agent);
  return {
    projection_version: NODE_PROJECTION_VERSION,
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    sequence_num: input.sequence_num,
    generated_at: new Date().toISOString(),
    agent_id: agentId,
    name: agent.name,
    node_type: 'agent',
    facts,
    generated: buildGeneratedBlock(facts, agent.name),
    recent_runtime_events: agent.recent_runtime_events,
  };
}

export function projectAllNodeStates(input: ProjectAllNodeStatesInput): RuntimeNodeProjection[] {
  const scratch = scanEventsToScratch(
    input.events,
    input.phase ?? 'executing',
    input.up_to_sequence_num,
  );

  const filtered = input.events.filter(
    (e) => input.up_to_sequence_num === undefined || e.sequence_num <= input.up_to_sequence_num,
  );
  const sequence_num = filtered.length > 0
    ? Math.max(...filtered.map((e) => e.sequence_num))
    : -1;

  return [...scratch.agents.entries()]
    .map(([agentId, agent]) => buildNodeProjection(scratch, agentId, agent, {
      mission_id: input.mission_id,
      branch_id: input.branch_id,
      sequence_num,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function projectNodeState(input: ProjectNodeStateInput): RuntimeNodeProjection | null {
  const scratch = createMissionScratch('executing');
  const filtered = [...input.events]
    .filter((e) => input.up_to_sequence_num === undefined || e.sequence_num <= input.up_to_sequence_num)
    .sort((a, b) => a.sequence_num - b.sequence_num);

  for (const event of filtered) {
    applyEventToScratch(scratch, event);
  }

  const normalized = input.agent_id.toLowerCase();
  const entry = [...scratch.agents.entries()].find(
    ([id, agent]) =>
      id.toLowerCase() === normalized
      || agent.name.toLowerCase() === normalized
      || id.toLowerCase() === normalized.replace(/\s+/g, '_'),
  );

  if (!entry) return null;

  const [agentId, agent] = entry;
  const sequence_num = filtered.length > 0 ? filtered[filtered.length - 1].sequence_num : -1;

  return buildNodeProjection(scratch, agentId, agent, {
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    sequence_num,
  });
}

export function getRuntimeNodeProjection(
  summary: { agents?: RuntimeNodeProjection[]; nodes?: RuntimeNodeProjection[] },
  agentKey: string,
): RuntimeNodeProjection | undefined {
  const nodes = summary.nodes ?? summary.agents ?? [];
  const normalized = agentKey.toLowerCase();
  return nodes.find(
    (node) =>
      node.agent_id.toLowerCase() === normalized
      || node.name.toLowerCase() === normalized
      || node.agent_id.toLowerCase() === normalized.replace(/\s+/g, '_'),
  );
}

/** @deprecated Use getRuntimeNodeProjection */
export function getRuntimeAgentSummary(
  summary: { agents?: RuntimeNodeProjection[] },
  agentKey: string,
): RuntimeNodeProjection | undefined {
  return getRuntimeNodeProjection(summary, agentKey);
}

export function mergeNodeProjectionEnhancement(
  projection: RuntimeNodeProjection,
  enhancement: {
    current_understanding: string;
    highlights?: string[];
    llm_warnings?: string[];
    suggested_title?: string;
    model?: string;
    prompt_version?: string;
  },
): RuntimeNodeProjection {
  return {
    ...projection,
    generated: {
      projection_version: NODE_GENERATED_PROJECTION_VERSION,
      prompt_version: enhancement.prompt_version ?? 'node-understanding-v1',
      model: enhancement.model,
      source: 'llm',
      generated_at: new Date().toISOString(),
      current_understanding: enhancement.current_understanding,
      highlights: enhancement.highlights,
      llm_warnings: enhancement.llm_warnings,
      suggested_title: enhancement.suggested_title,
    },
  };
}
