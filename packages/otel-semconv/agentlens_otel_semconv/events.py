"""
Semantic event names for multi-agent OpenTelemetry instrumentation.

Events are recorded as OTel Span Events and represent significant
occurrences during agent execution.
"""


class AgentEvents:
    """Standard event names for multi-agent span events."""

    DELEGATION = "agent.delegation"
    DELEGATION_ACCEPTED = "agent.delegation.accepted"
    DELEGATION_REJECTED = "agent.delegation.rejected"

    HANDOFF = "agent.handoff"
    HANDOFF_REQUESTED = "agent.handoff.requested"
    HANDOFF_ACCEPTED = "agent.handoff.accepted"
    HANDOFF_REJECTED = "agent.handoff.rejected"

    CRITIQUE = "agent.critique"
    REVIEW = "agent.review"
    REVIEW_APPROVED = "agent.review.approved"
    REVIEW_CHANGES_REQUESTED = "agent.review.changes_requested"
    REVIEW_REJECTED = "agent.review.rejected"

    REFLECTION = "agent.reflection"
    PLANNING = "agent.planning"
    DECISION = "agent.decision"

    RETRY = "agent.retry"
    ESCALATION = "agent.escalation"
    APPROVAL = "agent.approval"
    TIMEOUT = "agent.timeout"

    MEMORY_READ = "agent.memory.read"
    MEMORY_WRITE = "agent.memory.write"
    MEMORY_DELETE = "agent.memory.delete"

    TOOL_CALL = "agent.tool.call"
    TOOL_RESULT = "agent.tool.result"
    TOOL_ERROR = "agent.tool.error"

    ARTIFACT_CREATED = "agent.artifact.created"
    ARTIFACT_UPDATED = "agent.artifact.updated"

    INTERRUPT_REQUESTED = "agent.interrupt.requested"
    INTERRUPT_RESUMED = "agent.interrupt.resumed"
    HUMAN_DECISION = "agent.human.decision"

    # ─── LLM Interactions ───
    LLM_CALL = "gen_ai.call"
    LLM_RESPONSE = "gen_ai.response"
    LLM_ERROR = "gen_ai.error"
    LLM_STREAMING_START = "gen_ai.streaming.start"
    LLM_STREAMING_END = "gen_ai.streaming.end"

    MISSION_STARTED = "mission.started"
    MISSION_PHASE_CHANGED = "mission.phase.changed"
    MISSION_COMPLETED = "mission.completed"
    MISSION_FAILED = "mission.failed"
