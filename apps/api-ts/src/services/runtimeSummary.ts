import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type {
  NodeProjectionEnhancement,
  ProjectNodeStateInput,
  RuntimeNodeProjection,
  RuntimeSummary,
} from '@agentlens/protocol';
import {
  NODE_GENERATED_PROJECTION_VERSION,
  NODE_LLM_PROMPT_VERSION,
  NODE_PROJECTION_VERSION,
  isNodeProjectionCacheValid,
  mergeNodeProjectionEnhancement,
  projectNodeState,
  projectRuntimeSummary,
  type ProjectRuntimeSummaryInput,
} from '@agentlens/protocol';

const DEFAULT_SUMMARY_TIMEOUT_MS = Number(process.env.SUMMARY_TIMEOUT_MS ?? 15000);

function parseJsonSafely<T>(content: string | null | undefined): T | null {
  if (!content) return null;
  const text = content.trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // fall through
    }
  }

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]) as T;
    } catch {
      // fall through
    }
  }

  return null;
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

function buildLlmPrompt(summary: RuntimeSummary): string {
  const progressLines = summary.progress.slice(-12).map((entry) => `- ${entry.text}`).join('\n');
  const pendingLines = summary.pending_work.map((item) => `- [${item.kind}] ${item.text}`).join('\n');
  const warningLines = summary.warnings.map((item) => `- ${item.text}`).join('\n');

  return [
    'You are generating an operator-facing runtime summary for a multi-agent execution.',
    'Use ONLY the structured runtime facts below. Do not invent domain-specific categories.',
    'Avoid labels like diagnosis, root cause, recommendation, finding, or narrative as taxonomy.',
  'Focus on: objective, progress, observations, decisions, evidence, actions, pending work, warnings.',
    '',
    `Objective: ${summary.objective}`,
    `Status: ${summary.status} | Phase: ${summary.phase}`,
    `Headline: ${summary.headline}`,
    `Blocked: ${summary.is_blocked} | Requires human: ${summary.requires_human}`,
    '',
    'Recent progress:',
    progressLines || '(none)',
    '',
    'Pending work:',
    pendingLines || '(none)',
    '',
    'Warnings:',
    warningLines || '(none)',
    '',
    'Write a concise operator narrative (60-120 words) as a flowing execution story.',
    'Respond with JSON: { "narrative": "..." }',
  ].join('\n');
}

export function buildRuntimeSummary(input: ProjectRuntimeSummaryInput): RuntimeSummary {
  return projectRuntimeSummary(input);
}

export async function enhanceRuntimeSummaryWithLlm(summary: RuntimeSummary): Promise<RuntimeSummary> {
  const prompt = buildLlmPrompt(summary);

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
        'Runtime summary enhancement',
      );
    } finally {
      unsubscribe?.();
      session.dispose();
    }

    const parsed = parseJsonSafely<{ narrative?: string }>(chunks.join('').trim());
    if (parsed?.narrative && typeof parsed.narrative === 'string') {
      return {
        ...summary,
        source: 'llm',
        narrative: parsed.narrative,
      };
    }
  } catch {
    // fall through to deterministic narrative
  }

  return summary;
}

export async function buildRuntimeSummaryWithOptionalLlm(
  input: ProjectRuntimeSummaryInput,
  useLlm = false,
): Promise<RuntimeSummary> {
  const summary = buildRuntimeSummary(input);
  if (!useLlm) return summary;
  return enhanceRuntimeSummaryWithLlm(summary);
}

export function buildNodeProjection(input: ProjectNodeStateInput): RuntimeNodeProjection | null {
  return projectNodeState(input);
}

function buildNodeLlmPrompt(projection: RuntimeNodeProjection): string {
  const outputs = projection.facts.produced_outputs
    .map((o) => `- [${o.type}] ${o.name}`)
    .join('\n');
  const warnings = projection.facts.warnings.map((w) => `- ${w.message}`).join('\n');

  return [
    'Generate an operator-facing node runtime understanding from structured facts only.',
    'Do not invent domain categories like diagnosis, root cause, or recommendation.',
    '',
    `Agent: ${projection.name} (${projection.agent_id})`,
    `Status: ${projection.facts.status_label}`,
    `Role: ${projection.facts.role ?? 'unknown'}`,
    `Pending: ${projection.facts.pending ?? 'none'}`,
    `Next transition: ${projection.facts.next_transition?.target ?? 'none'}`,
    '',
    'Produced outputs:',
    outputs || '(none)',
    '',
    'Warnings:',
    warnings || '(none)',
    '',
    'Respond with JSON:',
    '{',
    '  "current_understanding": "60-100 word state summary",',
    '  "highlights": ["optional bullet points"],',
    '  "llm_warnings": ["optional operator warnings"],',
    '  "suggested_title": "optional short title"',
    '}',
  ].join('\n');
}

export async function enhanceNodeProjectionWithLlm(
  projection: RuntimeNodeProjection,
): Promise<RuntimeNodeProjection> {
  const prompt = buildNodeLlmPrompt(projection);

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
        'Node projection enhancement',
      );
    } finally {
      unsubscribe?.();
      session.dispose();
    }

    const parsed = parseJsonSafely<NodeProjectionEnhancement>(chunks.join('').trim());
    if (parsed?.current_understanding) {
      return mergeNodeProjectionEnhancement(projection, {
        ...parsed,
        prompt_version: NODE_LLM_PROMPT_VERSION,
      });
    }
  } catch {
    // fall through
  }

  return projection;
}

export { isNodeProjectionCacheValid };
export const NODE_PROJECTION_CACHE_VERSION = NODE_PROJECTION_VERSION;
