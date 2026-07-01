import path from 'node:path';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
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

interface AgentLensRuntimeServices {
  agentDir: string;
  authStorage: ReturnType<typeof AuthStorage.create>;
  modelRegistry: ModelRegistry;
  resourceLoader: DefaultResourceLoader;
}

const MISSING_MODEL_AUTH_MESSAGE =
  'No configured model authentication is available for the embedded PI assistant. Configure a provider before using this route.';
const MODEL_AUTH_REFRESH_INTERVAL_MS = 30_000;

let runtimeServicesPromise: Promise<AgentLensRuntimeServices> | null = null;
let lastModelAuthRefreshAt = 0;

async function createRuntimeServices(): Promise<AgentLensRuntimeServices> {
  const repoRoot = getRepoRoot();
  const agentDir = path.join(repoRoot, '.pi');
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const settingsManager = SettingsManager.create(repoRoot, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir,
    settingsManager,
    systemPromptOverride: () =>
      [
        'You are AgentLens, the embedded AI interface for reviewing multi-agent mission data.',
        'Be concise, practical, and explain what matters most.',
        'If mission context is provided, use it to ground your answer.',
      ].join(' '),
    appendSystemPromptOverride: () => [],
  });

  await resourceLoader.reload();

  return {
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
  };
}

async function getRuntimeServices(): Promise<AgentLensRuntimeServices> {
  if (!runtimeServicesPromise) {
    runtimeServicesPromise = createRuntimeServices().catch((error) => {
      runtimeServicesPromise = null;
      throw error;
    });
  }

  return runtimeServicesPromise;
}

async function ensureConfiguredAssistantModel(): Promise<AgentLensRuntimeServices> {
  const services = await getRuntimeServices();
  if (services.modelRegistry.getAvailable().length > 0) {
    return services;
  }

  const now = Date.now();
  if (now - lastModelAuthRefreshAt >= MODEL_AUTH_REFRESH_INTERVAL_MS) {
    lastModelAuthRefreshAt = now;
    services.modelRegistry.refresh();
    if (services.modelRegistry.getAvailable().length > 0) {
      return services;
    }
  }

  throw new Error(MISSING_MODEL_AUTH_MESSAGE);
}

export function resetAgentLensAiRuntimeForTests(): void {
  runtimeServicesPromise = null;
  lastModelAuthRefreshAt = 0;
}

export async function askAgentLens(prompt: string, context: AssistantContext = {}): Promise<string> {
  const repoRoot = getRepoRoot();
  const services = await ensureConfiguredAssistantModel();

  const { session } = await createAgentSession({
    cwd: repoRoot,
    agentDir: services.agentDir,
    authStorage: services.authStorage,
    modelRegistry: services.modelRegistry,
    resourceLoader: services.resourceLoader,
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
