import type { Request, Response, NextFunction } from 'express';
import {
  getConfiguredServiceToken,
  isLangGraphGovernanceEnabled,
  isMafGovernanceEnabled,
} from '../config/features.js';

export { getConfiguredServiceToken };

export function extractBearerToken(req: Request): string | undefined {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * When LangGraph governance is enabled, service authentication is mandatory.
 * Missing auth configuration disables governance endpoints (fail closed) without
 * preventing the rest of AgentLens (observability) from operating.
 */
export function requireGovernanceServiceAuth(req: Request, res: Response, next: NextFunction): void {
  requireFrameworkGovernanceServiceAuth('langgraph', req, res, next);
}

export function requireFrameworkGovernanceServiceAuth(
  framework: 'langgraph' | 'ms_agent_framework',
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const enabled = framework === 'langgraph' ? isLangGraphGovernanceEnabled() : isMafGovernanceEnabled();
  if (!enabled) {
    res.status(403).json({ detail: `${framework} governance is disabled` });
    return;
  }
  const expected = getConfiguredServiceToken();
  if (!expected) {
    res.status(503).json({
      detail: `${framework} governance requires AGENTLENS_SERVICE_TOKEN (or AGENTLENS_API_KEY) when enabled`,
    });
    return;
  }
  const provided = extractBearerToken(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ detail: 'Unauthorized' });
    return;
  }
  next();
}

/** @deprecated Prefer requireGovernanceServiceAuth for bridge endpoints. */
export function requireServiceAuthIfConfigured(req: Request, res: Response, next: NextFunction): void {
  const expected = getConfiguredServiceToken();
  if (!expected) {
    next();
    return;
  }
  const provided = extractBearerToken(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ detail: 'Unauthorized' });
    return;
  }
  next();
}
