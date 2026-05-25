import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { MissionAggregate, SemanticSummaryResult } from '../types/mission.js';

const DEFAULT_SUMMARY_TIMEOUT_MS = Number(process.env.SUMMARY_TIMEOUT_MS ?? 15000);

const ACTIVE_NODE_STATUSES = new Set(['active', 'waiting', 'reviewing']);

function getLatestSnapshot(missionData: MissionAggregate) {
  return missionData.snapshots[missionData.snapshots.length - 1] ?? null;
}

function summarizeSystemState(missionData: MissionAggregate): string {
  const latestSnapshot = getLatestSnapshot(missionData);
  const mission = missionData.mission;

  if (!latestSnapshot) {
    if (mission.status === 'completed') return 'The mission is completed and the system has finished its release flow.';
    if (mission.status === 'failed') return 'The mission ended in failure and the system is no longer progressing.';
    return 'The system is active, but no execution snapshot is available yet.';
  }

  const nodes = Array.isArray(latestSnapshot.nodes) ? latestSnapshot.nodes : [];
  const edges = Array.isArray(latestSnapshot.edges) ? latestSnapshot.edges : [];

  const waitingForHuman = nodes.some((node) => node.type === 'human' && node.status === 'waiting');
  const hasEscalation = edges.some((edge) => edge.type === 'escalation');
  const hasReviewEdges = edges.some((edge) => edge.type === 'review' || edge.type === 'approval');
  const failedTasks = nodes.filter((node) => node.type === 'task' && node.status === 'failed');
  const activeTasks = nodes.filter((node) => node.type === 'task' && ACTIVE_NODE_STATUSES.has(node.status));
  const activeAgents = nodes
    .filter((node) => node.type === 'agent' && ACTIVE_NODE_STATUSES.has(node.status))
    .map((node) => node.label)
    .filter((label): label is string => Boolean(label && label.trim()));
  const completedAgents = nodes
    .filter((node) => node.type === 'agent' && node.status === 'completed')
    .map((node) => node.label)
    .filter((label): label is string => Boolean(label && label.trim()));

  const stateParts: string[] = [];

  if (waitingForHuman || hasEscalation || mission.phase === 'human_review' || mission.phase === 'waiting_for_human') {
    stateParts.push('The system is paused at a human review gate');
  } else if (mission.status === 'completed') {
    stateParts.push('The system is in a completed release state');
  } else if (mission.status === 'failed') {
    stateParts.push('The system is in a failed state');
  } else {
    stateParts.push('The system is actively progressing');
  }

  if (activeAgents.length > 0) {
    stateParts.push(`with ${activeAgents.slice(0, 3).join(', ')} still engaged`);
  } else if (completedAgents.length > 0) {
    stateParts.push(`after ${completedAgents.slice(0, 2).join(', ')} completed their part`);
  }

  if (activeTasks.length > 0) {
    stateParts.push('while some work items remain in flight');
  }

  if (failedTasks.length > 0) {
    stateParts.push('and one or more tasks have failed, requiring recovery');
  }

  if (hasReviewEdges) {
    stateParts.push('with review activity shaping the next step');
  }

  return `${stateParts.join(', ')}.`;
}

function parseJsonSafely<T>(content: string | null | undefined): T | null {
  if (!content) return null;
  const text = content.trim();

  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to extraction
  }

  // Extract JSON from markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // Fall through
    }
  }

  // Extract the first { ... } JSON object from the text
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]) as T;
    } catch {
      // Fall through
    }
  }

  return null;
}

function buildFallbackSummary(missionData: MissionAggregate): SemanticSummaryResult {
  const { mission, agents, snapshots } = missionData;

  const conflicts: Array<Record<string, unknown>> = [];
  const anomalies: Array<Record<string, unknown>> = [];

  const latestSnapshot = getLatestSnapshot(missionData);
  const systemState = summarizeSystemState(missionData);

  const activeAgentNames = new Set<string>();
  let delegationCount = 0;
  let critiqueCount = 0;
  let reviewCount = 0;
  let toolCallCount = 0;
  let escalationCount = 0;

  for (const snapshot of snapshots) {
    const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];

    for (const node of snapshot.nodes ?? []) {
      if (node.type === 'agent' && ACTIVE_NODE_STATUSES.has(node.status) && node.label) {
        activeAgentNames.add(node.label);
      }
    }

    for (const edge of edges) {
      if (edge.type === 'delegation') {
        delegationCount += 1;
      } else if (edge.type === 'critique') {
        critiqueCount += 1;
        if ((edge.label ?? '').toLowerCase().includes('rejected')) {
          conflicts.push({
            type: 'agent_disagreement',
            description: 'Critique was rejected between agents',
            edge_id: edge.id,
          });
        }
      } else if (edge.type === 'review') {
        reviewCount += 1;
      } else if (edge.type === 'uses') {
        toolCallCount += 1;
      } else if (edge.type === 'escalation') {
        escalationCount += 1;
        anomalies.push({
          type: 'escalation',
          description: 'Task was escalated to human oversight',
          severity: 'medium',
        });
      }
    }
  }

  if (delegationCount > agents.length * 3) {
    anomalies.push({
      type: 'recursive_loop',
      description: `Excessive delegation detected (${delegationCount} delegations for ${agents.length} agents)`,
      severity: 'high',
    });
  }

  const parts: string[] = [];
  parts.push(systemState);

  if (latestSnapshot?.event_description) {
    parts.push(`Latest transition: ${latestSnapshot.event_description}.`);
  }

  if (delegationCount > 0) parts.push('The agents are coordinating through delegation and handoffs.');
  if (critiqueCount > 0) parts.push('Peer critique activity is still part of the workflow.');
  if (reviewCount > 0) parts.push('Formal review signals have been recorded in the system.');
  if (toolCallCount > 0) parts.push('Tool use is contributing to the current state.');

  if (conflicts.length > 0) {
    parts.push(`⚠️ ${conflicts.length} conflict(s) detected during execution.`);
  }
  if (escalationCount > 0) {
    parts.push(`🔼 ${escalationCount} escalation(s) to human oversight occurred.`);
  }

  if (activeAgentNames.size > 0) {
    parts.push(`Active participants: ${Array.from(activeAgentNames).slice(0, 3).join(', ')}.`);
  }

  return {
    summary: parts.join(' '),
    conflicts,
    anomalies,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface WhyThisStateContext {
  missionObjective: string;
  eventDescription?: string;
  eventType?: string;
  phase?: string;
  missionStatus?: string;
  agentStates: Array<{
    agent_id: string;
    name?: string;
    role?: string;
    status: string;
    summary?: string;
    last_reason?: string;
  }>;
  agentCount: number;
  activeAgentCount: number;
  pendingInterruptCount: number;
  nodeSummary: Array<{ label: string; type: string; status: string }>;
  edgeSummary: Array<{ source: string; target: string; type: string; label?: string }>;
  recentEvents: Array<{ event_type: string; description: string; agent?: string }>;
}

function buildWhyThisStateFallback(ctx: WhyThisStateContext): SemanticSummaryResult {
  const parts: string[] = [];
  const phase = ctx.phase ?? 'executing';

  // Phase semantics
  if (phase === 'human_review' || phase === 'waiting_for_human') {
    parts.push('The system is paused at a human review gate, waiting for a decision before proceeding.');
  } else if (phase === 'reviewing') {
    parts.push('The system is in a review cycle where outputs are being evaluated for quality.');
  } else if (phase === 'planning') {
    parts.push('The system is in early planning — decomposing the objective into executable work.');
  } else {
    parts.push('The system is actively executing.');
  }

  // Agent dynamics
  const active = ctx.agentStates.filter((a) => a.status === 'active');
  const waiting = ctx.agentStates.filter((a) => a.status === 'waiting');
  const completed = ctx.agentStates.filter((a) => a.status === 'completed');
  const failed = ctx.agentStates.filter((a) => a.status === 'failed');

  if (failed.length > 0) {
    parts.push(`${failed.map((a) => a.name ?? a.agent_id).join(', ')} ${failed.length === 1 ? 'has' : 'have'} failed, requiring recovery.`);
  }

  if (waiting.length > 0) {
    const blockedBy = ctx.edgeSummary.filter(
      (e) => e.type === 'delegation' || e.type === 'data_flow' || e.type === 'dependency'
    );
    if (blockedBy.length > 0) {
      parts.push(`${waiting.map((a) => a.name ?? a.agent_id).join(', ')} blocked awaiting upstream results.`);
    } else {
      parts.push(`${waiting.map((a) => a.name ?? a.agent_id).join(', ')} idle, waiting for input.`);
    }
  }

  if (active.length > 0) {
    parts.push(`${active.map((a) => a.name ?? a.agent_id).join(', ')} actively working.`);
  } else if (active.length === 0 && waiting.length === 0 && failed.length === 0 && completed.length > 0) {
    parts.push('All agents have completed their work.');
  }

  // Interrupts
  if (ctx.pendingInterruptCount > 0) {
    parts.push(`${ctx.pendingInterruptCount} human decision(s) pending.`);
  }

  // Structural patterns from edges
  const reviewEdges = ctx.edgeSummary.filter((e) => e.type === 'review' || e.type === 'critique');
  const escalationEdges = ctx.edgeSummary.filter((e) => e.type === 'escalation');
  const handoffEdges = ctx.edgeSummary.filter((e) => e.type === 'handoff.requested' || e.type === 'handoff.accepted' || e.type === 'handoff.rejected');
  const approvalEdges = ctx.edgeSummary.filter((e) => e.type === 'approval');

  if (escalationEdges.length > 0) {
    parts.push('Escalation path is active — issue raised to oversight.');
  }
  if (reviewEdges.length > 0 && escalationEdges.length === 0) {
    parts.push('Review feedback is shaping the workflow.');
  }
  if (approvalEdges.length > 0) {
    parts.push('Formal approval step is in progress.');
  }
  if (handoffEdges.length > 0) {
    parts.push('Cross-agent handoff in progress.');
  }

  // Snapshot-specific transition context
  if (ctx.eventDescription) {
    const desc = ctx.eventDescription;
    const recentEventTypes = ctx.recentEvents.slice(-3).map((e) => e.event_type.replace(/[._]/g, ' '));
    if (recentEventTypes.some((t) => t.includes('interrupt'))) {
      parts.push(`This snapshot reflects an interrupt-related transition: ${desc}.`);
    } else if (recentEventTypes.some((t) => t.includes('review') || t.includes('critique'))) {
      parts.push(`This snapshot reflects a review transition: ${desc}.`);
    } else if (recentEventTypes.some((t) => t.includes('delegation') || t.includes('handoff'))) {
      parts.push(`This snapshot reflects a coordination transition: ${desc}.`);
    } else {
      parts.push(`At this point: ${desc}.`);
    }
  }

  return {
    summary: parts.join(' '),
    conflicts: [],
    anomalies: [],
  };
}

export async function generateWhyThisState(ctx: WhyThisStateContext): Promise<SemanticSummaryResult> {
  const agentDescriptions = ctx.agentStates
    .map((a) => {
      const extras: string[] = [];
      if (a.summary) extras.push(`summary: "${a.summary}"`);
      if (a.last_reason) extras.push(`last reason: "${a.last_reason}"`);
      return `- ${a.name ?? a.agent_id} (${a.role ?? 'unknown role'}): ${a.status}${extras.length ? ` — ${extras.join('; ')}` : ''}`;
    })
    .join('\n');

  const recentEventLines = ctx.recentEvents
    .map((e) => `- ${e.event_type.replace(/[._]/g, ' ')}${e.agent ? ` [${e.agent}]` : ''}: ${e.description}`)
    .join('\n');

  const prompt = [
    `You are analyzing the current state of a multi-agent AI system.`,
    '',
    `Mission objective: "${ctx.missionObjective}"`,
    `Mission status: ${ctx.missionStatus ?? 'active'}`,
    `Current phase: ${ctx.phase ?? 'executing'}`,
    `Total agents: ${ctx.agentCount} (${ctx.activeAgentCount} active)`,
    `Pending human interrupts: ${ctx.pendingInterruptCount}`,
    '',
    `Agent states:`,
    agentDescriptions || '(none)',
    '',
    `Graph topology at this snapshot:`,
    ctx.nodeSummary.map((n) => `- [${n.type}] ${n.label}: ${n.status}`).join('\n') || '(none)',
    '',
    `Key relationships between nodes:`,
    ctx.edgeSummary.map((e) => `- ${e.source} → ${e.target} [${e.type}]${e.label ? ` ${e.label}` : ''}`).join('\n') || '(none)',
    '',
    `Recent event timeline (most recent last):`,
    recentEventLines || '(none)',
    '',
    `The event that triggered this snapshot: ${ctx.eventDescription ?? 'none'}`,
    '',
    'Describe the SYSTEM-LEVEL state in 40-80 words. Do NOT narrate the trigger event or say "the last event was...".',
    'Instead, characterize the overall situation semantically:',
    '- What does the current phase mean for the system as a whole?',
    '- Which agents are driving progress, which are blocked, and WHY are they blocked (dependencies, waiting for review, human input)?',
    '- What structural patterns are visible? (parallel execution, review bottlenecks, handoff chains, critique loops, human-in-the-loop gates, escalations)',
    '- Is the system progressing smoothly, stalled, or diverging?',
    '- What is the dominant dynamic shaping this moment?',
    'Think like a system architect describing topology and flow, not a log summarizer.',
    '',
    'Respond with a JSON object with exactly these keys:',
    '"summary": the system-level explanation string,',
    '"conflicts": an empty array,',
    '"anomalies": an empty array.',
  ].join('\n');

  try {
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      noTools: 'all',
      sessionManager: SessionManager.inMemory(),
    });

    const chunks: string[] = [];
    const unsubscribe = session.subscribe((event: any) => {
      if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        chunks.push(String(event.assistantMessageEvent.delta ?? ''));
      }
    });

    try {
      await withTimeout(
        (async () => {
          await session.prompt(prompt);
          await session.agent.waitForIdle();
        })(),
        DEFAULT_SUMMARY_TIMEOUT_MS,
        'Why-this-state generation',
      );
    } finally {
      unsubscribe?.();
      session.dispose();
    }

    const parsed = parseJsonSafely<SemanticSummaryResult>(chunks.join('').trim());
    if (parsed && typeof parsed.summary === 'string') {
      return {
        summary: parsed.summary,
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
      };
    }
  } catch {
    // Fall through to fallback
  }

  return buildWhyThisStateFallback(ctx);
}

export async function generateMissionSummary(missionData: MissionAggregate): Promise<SemanticSummaryResult> {
  if (missionData.snapshots.length > 0) {
    const eventLog = missionData.snapshots.map((snapshot) => {
      const eventType = snapshot.event_type ?? 'event';
      const description = snapshot.event_description ?? '';
      return `[${snapshot.timestamp}] ${eventType}: ${description}`;
    });

    const prompt = [
      `You are reviewing the execution log of an AI multi-agent system solving the objective: '${missionData.mission.objective}'.`,
      'Describe the CURRENT system state, not structural metrics.',
      'Do NOT mention node counts, agent counts, edge counts, or similar statistics.',
      'Focus on whether the system is actively executing, paused for human review, blocked, recovering, or completed.',
      'Explain what the latest event means for the system as a whole.',
      'Provide a JSON response with exactly these keys:',
      '1. "summary": A concise narrative describing the current system state and the most important transition (max 100 words).',
      '2. "conflicts": An array of conflicts detected (e.g. infinite loops, rejected critiques).',
      '3. "anomalies": An array of unusual behaviors or escalations.',
      '',
      'Execution Timeline:',
      eventLog.join('\n'),
    ].join('\n');

    try {
      const { session } = await createAgentSession({
        cwd: process.cwd(),
        noTools: 'all',
        sessionManager: SessionManager.inMemory(),
      });

      const chunks: string[] = [];
      const unsubscribe = session.subscribe((event: any) => {
        if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          chunks.push(String(event.assistantMessageEvent.delta ?? ''));
        }
      });

      try {
        await withTimeout(
          (async () => {
            await session.prompt(prompt);
            await session.agent.waitForIdle();
          })(),
          DEFAULT_SUMMARY_TIMEOUT_MS,
          'Semantic summary generation',
        );
      } finally {
        unsubscribe?.();
        session.dispose();
      }

      const parsed = parseJsonSafely<SemanticSummaryResult>(chunks.join('').trim());
      if (parsed && typeof parsed.summary === 'string' && Array.isArray(parsed.conflicts) && Array.isArray(parsed.anomalies)) {
        return parsed;
      }
    } catch {
      return buildFallbackSummary(missionData);
    }
  }

  return buildFallbackSummary(missionData);
}
