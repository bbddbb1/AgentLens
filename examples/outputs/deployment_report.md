# Deployment Pipeline HITL Report

Decision path: deployed

This scenario demonstrates the human-in-the-loop boundary on a live software deployment pipeline.

Blocked state before review:
Deployment state: ready
Target environment: production
Version: v2.1.0
Status: waiting for human authorization

Review Summary:
PR #402 passed security review. No vulnerabilities found.

QA Summary:
Integration tests completed successfully. System is stable.

Human comment:


System state after review:
Deployment executed successfully. v2.1.0 is live.

Why this matters:
The human reviewer authorized the deployment, and the graph completed the rollout.
