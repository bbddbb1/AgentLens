import { EventEnvelope, PolicyDecision } from '@agentlens/protocol';

export interface GovernanceRule {
  id: string;
  name: string;
  description: string;
  evaluate: (event: EventEnvelope) => PolicyDecision | null;
}

// Example built-in rules
export const BuiltInRules: GovernanceRule[] = [
  {
    id: 'rule-deny-dangerous-tools',
    name: 'Deny Dangerous Tools',
    description: 'Automatically denies execution of inherently dangerous shell commands.',
    evaluate: (event) => {
      if (event.event_type !== 'tool.called') return null;

      // Simplistic check for tool inputs containing dangerous commands
      const payloadString = JSON.stringify(event.payload);
      if (payloadString.includes('rm -rf') || payloadString.includes('mkfs')) {
        return {
          rule_id: 'rule-deny-dangerous-tools',
          decision: 'deny',
          reason: 'Payload contains restricted commands.',
        };
      }
      return null;
    },
  },
  {
    id: 'rule-require-review-financial',
    name: 'Require Review for Financial Transactions',
    description: 'Flags financial or blockchain transactions for human review.',
    evaluate: (event) => {
      if (event.event_type !== 'tool.called') return null;
      
      const toolName = typeof event.payload.tool_name === 'string' ? event.payload.tool_name.toLowerCase() : '';
      if (toolName.includes('transfer_funds') || toolName.includes('sign_transaction')) {
        return {
          rule_id: 'rule-require-review-financial',
          decision: 'require_review',
          reason: 'Tool executes financial transactions.',
        };
      }
      return null;
    },
  },
];

export class PolicyEngine {
  private rules: GovernanceRule[];

  constructor(rules: GovernanceRule[] = BuiltInRules) {
    this.rules = rules;
  }

  /**
   * Evaluates an event against all registered governance rules.
   * Returns the most restrictive policy decision.
   */
  evaluateEvent(event: EventEnvelope): PolicyDecision | null {
    let finalDecision: PolicyDecision | null = null;

    for (const rule of this.rules) {
      const decision = rule.evaluate(event);
      if (decision) {
        // Strictness precedence: deny > require_review > redact > allow
        if (!finalDecision || this.getStrictness(decision.decision) > this.getStrictness(finalDecision.decision)) {
          finalDecision = decision;
        }
      }
    }

    return finalDecision;
  }

  private getStrictness(decision: PolicyDecision['decision']): number {
    switch (decision) {
      case 'deny': return 4;
      case 'require_review': return 3;
      case 'redact': return 2;
      case 'allow': return 1;
      default: return 0;
    }
  }
}
