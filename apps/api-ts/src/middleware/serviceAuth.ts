import type { Request, Response, NextFunction } from 'express';
import {
  getConfiguredServiceToken,
  isLangGraphGovernanceEnabled,
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
  if (!isLangGraphGovernanceEnabled()) {
    res.status(403).json({ detail: 'LangGraph governance is disabled' });
    return;
  }
  const expected = getConfiguredServiceToken();
  if (!expected) {
    res.status(503).json({
      detail: 'LangGraph governance requires AGENTLENS_SERVICE_TOKEN (or AGENTLENS_API_KEY) when enabled',
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
