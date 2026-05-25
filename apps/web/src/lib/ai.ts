import path from 'node:path';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';

export interface AssistantContext {
  missionId?: string;
  missionObjective?: string;
  missionStatus?: string;
}

function getRepoRoot(): string {
  return path.resolve(process.cwd(), '..', '..');
}

export async function askAgentLens(prompt: string, context: AssistantContext = {}): Promise<string> {
  const repoRoot = getRepoRoot();
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const resourceLoader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir: path.join(repoRoot, '.pi'),
    systemPromptOverride: () =>
      [
        'You are AgentLens, the embedded AI interface for reviewing multi-agent mission data.',
        'Be concise, practical, and explain what matters most.',
        'If mission context is provided, use it to ground your answer.',
      ].join(' '),
    appendSystemPromptOverride: () => [],
  });

  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: repoRoot,
    agentDir: path.join(repoRoot, '.pi'),
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(repoRoot),
    tools: ['read', 'grep', 'find', 'ls'],
  });

  const chunks: string[] = [];
  const unsubscribe = session.subscribe((event: unknown) => {
    const assistantEvent = event as { type?: string; assistantMessageEvent?: { type?: string; delta?: unknown } };
    if (assistantEvent.type === 'message_update' && assistantEvent.assistantMessageEvent?.type === 'text_delta') {
      chunks.push(String(assistantEvent.assistantMessageEvent.delta ?? ''));
    }
  });

  try {
    const contextualPrompt = [
      context.missionId ? `Mission ID: ${context.missionId}` : null,
      context.missionObjective ? `Mission objective: ${context.missionObjective}` : null,
      context.missionStatus ? `Mission status: ${context.missionStatus}` : null,
      '',
      prompt,
    ]
      .filter(Boolean)
      .join('\n');

    await session.prompt(contextualPrompt);
    await session.agent.waitForIdle();

    const text = chunks.join('').trim();
    return text || 'No assistant response was generated.';
  } finally {
    unsubscribe?.();
    session.dispose();
  }
}
