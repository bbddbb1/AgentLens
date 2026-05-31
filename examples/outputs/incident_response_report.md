# Incident Response HITL Report

Decision path: contained

This scenario demonstrates the human-in-the-loop boundary on a live operational action: the multi-agent workflow can investigate, but only a reviewer can authorize broad customer-impacting containment.

Blocked state before review:
Containment state: paused
Customer sessions: unchanged
Investigation posture: awaiting reviewer decision
Operational risk: active but not yet contained

Evidence collected before review:
Evidence suggests coordinated misuse but is not yet conclusive.
A platform-wide session revoke would interrupt active enterprise work.
Human judgment is required before the system performs a broad containment action.

Planned automated response:
Primary plan: revoke active sessions for the affected tenant cohort and force re-authentication.
Fallback plan: hold containment, continue monitoring, and gather additional evidence.

Human comment:
Reviewed by human

System state after review:
Containment state: executed
Customer sessions: revoked for affected cohort
Investigation posture: stabilized
Operational risk: reduced by human-authorized intervention

Why this matters:
The human reviewer authorized a disruptive action, and the graph continued into explicit containment work.
