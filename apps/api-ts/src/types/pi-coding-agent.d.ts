declare module '@earendil-works/pi-coding-agent' {
  export const SessionManager: {
    inMemory: (cwd?: string) => unknown;
  };

  export function createAgentSession(options?: {
    cwd?: string;
    noTools?: 'all' | 'builtin';
    sessionManager?: unknown;
    tools?: string[];
  }): Promise<{
    session: {
      subscribe: (listener: (event: any) => void) => () => void;
      prompt: (message: string) => Promise<void>;
      agent: { waitForIdle: () => Promise<void> };
      dispose: () => void;
    };
  }>;
}
