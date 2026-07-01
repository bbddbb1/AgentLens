import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@earendil-works/pi-coding-agent', () => {
  const mockState = {
    hasModel: false,
    reloadCalls: 0,
    refreshCalls: 0,
    createSessionCalls: 0,
    disposeCalls: 0,
  };

  class MockResourceLoader {
    async reload() {
      mockState.reloadCalls += 1;
    }
  }

  const authStorage = {};

  const modelRegistry = {
    getAvailable: () => (mockState.hasModel ? [{ provider: 'test', id: 'model' }] : []),
    refresh: () => {
      mockState.refreshCalls += 1;
    },
  };

  return {
    __mockState: mockState,
    AuthStorage: {
      create: vi.fn(() => authStorage),
    },
    DefaultResourceLoader: MockResourceLoader,
    ModelRegistry: {
      create: vi.fn(() => modelRegistry),
    },
    SettingsManager: {
      create: vi.fn(() => ({})),
    },
    SessionManager: {
      inMemory: vi.fn(() => ({ kind: 'memory-session-manager' })),
    },
    createAgentSession: vi.fn(async () => {
      mockState.createSessionCalls += 1;
      let listener: ((event: unknown) => void) | undefined;

      return {
        session: {
          subscribe(cb: (event: unknown) => void) {
            listener = cb;
            return () => {
              listener = undefined;
            };
          },
          async prompt() {
            listener?.({
              type: 'message_update',
              assistantMessageEvent: {
                type: 'text_delta',
                delta: 'hello',
              },
            });
          },
          agent: {
            async waitForIdle() {
              return;
            },
          },
          dispose() {
            mockState.disposeCalls += 1;
          },
        },
      };
    }),
  };
});

import * as piAgent from '@earendil-works/pi-coding-agent';
import { askAgentLens, resetAgentLensAiRuntimeForTests } from '@/lib/ai';

const mockState = (piAgent as unknown as { __mockState: {
  hasModel: boolean;
  reloadCalls: number;
  refreshCalls: number;
  createSessionCalls: number;
  disposeCalls: number;
} }).__mockState;

describe('askAgentLens runtime reuse', () => {
  beforeEach(() => {
    resetAgentLensAiRuntimeForTests();
    mockState.hasModel = false;
    mockState.reloadCalls = 0;
    mockState.refreshCalls = 0;
    mockState.createSessionCalls = 0;
    mockState.disposeCalls = 0;
  });

  it('fails fast without creating sessions when no model auth is configured', async () => {
    await expect(askAgentLens('ping')).rejects.toThrow(
      'No configured model authentication is available for the embedded PI assistant.',
    );

    await expect(askAgentLens('ping again')).rejects.toThrow(
      'No configured model authentication is available for the embedded PI assistant.',
    );

    expect(mockState.reloadCalls).toBe(1);
    expect(mockState.createSessionCalls).toBe(0);
    expect(mockState.refreshCalls).toBe(1);
  });

  it('reuses the loaded runtime services across successful requests', async () => {
    mockState.hasModel = true;

    await expect(askAgentLens('first')).resolves.toBe('hello');
    await expect(askAgentLens('second')).resolves.toBe('hello');

    expect(mockState.reloadCalls).toBe(1);
    expect(mockState.createSessionCalls).toBe(2);
    expect(mockState.disposeCalls).toBe(2);
  });
});
