"""
Semantic attribute keys for multi-agent OpenTelemetry instrumentation.

These follow the OpenTelemetry naming conventions:
- Namespaced with dots (e.g., agent.id)
- Lowercase with underscores within segments
- Consistent with gen_ai.* conventions where applicable
"""


class AgentAttributes:
    """Attributes describing an agent within a multi-agent system."""

    # 鈹€鈹€鈹€ Identity 鈹€鈹€鈹€
    ID = "agent.id"
    """Unique identifier for the agent instance."""

    NAME = "agent.name"
    """Human-readable display name of the agent."""

    ROLE = "agent.role"
    """Functional role of the agent (e.g., planner, researcher, critic, executor)."""

    TEAM = "agent.team"
    """Team or group the agent belongs to."""

    FRAMEWORK = "agent.framework"
    """Source framework (langgraph, crewai, autogen, openai_agents, ms_agent_framework)."""

    # 鈹€鈹€鈹€ Objective 鈹€鈹€鈹€
    GOAL = "agent.goal"
    """Current high-level objective of the agent."""

    TASK = "agent.task"
    """Specific task being executed."""

    TASK_DESCRIPTION = "agent.task.description"
    """Human-readable description of the current task."""

    # 鈹€鈹€鈹€ State 鈹€鈹€鈹€
    CONFIDENCE = "agent.confidence"
    """Agent's confidence score in its output (0.0 to 1.0)."""

    STATUS = "agent.status"
    """Current agent status (active, waiting, completed, failed)."""

    ITERATION = "agent.iteration"
    """Current iteration number (for retry/loop detection)."""

    # 鈹€鈹€鈹€ Communication 鈹€鈹€鈹€
    DELEGATION_TARGET = "agent.delegation.target"
    """Agent ID that work is being delegated to."""

    DELEGATION_REASON = "agent.delegation.reason"
    """Reason for delegation."""

    CRITIQUE_TARGET = "agent.critique.target"
    """Agent ID being critiqued."""

    CRITIQUE_RESULT = "agent.critique.result"
    """Result of critique (approved, rejected, needs_revision)."""

    REVIEW_RESULT = "agent.review.result"
    """Result of review (approved, changes_requested, rejected)."""

    REVIEW_TARGET = "agent.review.target"
    """Agent ID or span ID being reviewed."""

    ESCALATION_TARGET = "agent.escalation.target"
    """Target of escalation (human ID or supervisor agent ID)."""

    ESCALATION_REASON = "agent.escalation.reason"
    """Reason for escalation."""

    HANDOFF_TARGET = "agent.handoff.target"
    """Target agent ID for a handoff/transfer of control."""

    HANDOFF_REASON = "agent.handoff.reason"
    """Reason for the handoff/transfer of control."""

    # 鈹€鈹€鈹€ Memory 鈹€鈹€鈹€
    MEMORY_KEY = "agent.memory.key"
    """Key of memory being read or written."""

    MEMORY_OPERATION = "agent.memory.operation"
    """Memory operation type (read, write, delete)."""

    # 鈹€鈹€鈹€ Tool Usage 鈹€鈹€鈹€
    TOOL_NAME = "agent.tool.name"
    """Name of the tool being invoked."""

    TOOL_INPUT = "agent.tool.input"
    """Serialized input to the tool."""

    TOOL_OUTPUT = "agent.tool.output"
    """Serialized output from the tool."""

    TOOL_STATUS = "agent.tool.status"
    """Tool execution status (success, error, timeout)."""

    INTERRUPT_ID = "agent.interrupt.id"
    """Unique identifier for a human-review interrupt request."""

    INTERRUPT_REASON = "agent.interrupt.reason"
    """Why the agent requires human review or approval."""

    INTERRUPT_RESUME_URL = "agent.interrupt.resume_url"
    """Optional resume URL associated with the interrupt."""

    RESUME_TOKEN = "agent.resume.token"
    """Opaque token that can be used to resume execution after review."""

    HUMAN_DECISION = "agent.human.decision"
    """Human decision captured for an interrupt (approve, reject, resume)."""

    HUMAN_INPUT = "agent.human.input"
    """Free-form human input associated with an interrupt decision."""

    TIMEOUT_AT = "agent.timeout_at"
    """Absolute timeout for a pending interrupt."""

    POLICY_REQUIRED_REVIEW = "agent.policy.required_review"
    """Whether policy or governance requires explicit human review."""


class MissionAttributes:
    """Attributes describing a mission (top-level multi-agent objective)."""

    ID = "mission.id"
    """Unique identifier for the mission."""

    BRANCH_ID = "mission.branch_id"
    """The active execution branch ID of the mission."""

    OBJECTIVE = "mission.objective"
    """Human-readable objective of the mission."""

    PHASE = "mission.phase"
    """Current mission phase (planning, executing, reviewing, completed, failed)."""

    STATUS = "mission.status"
    """Mission status (active, paused, completed, failed, cancelled)."""

    OWNER = "mission.owner"
    """User ID of the mission owner."""

    TEAM_SIZE = "mission.team_size"
    """Number of agents participating in the mission."""

    ENCRYPTION_ENABLED = "mission.encryption.enabled"
    """Whether the mission data is end-to-end encrypted."""

    FRAMEWORK = "mission.framework"
    """Primary framework used for the mission."""

    VERSION = "mission.version"
    """Version or revision number of the mission execution."""


class LLMAttributes:
    """Attributes describing an LLM call within an agent span."""

    # ─── Model Identity ───
    MODEL_PROVIDER = "gen_ai.system"
    """LLM provider name (openai, anthropic, google, etc.)."""

    MODEL_NAME = "gen_ai.request.model"
    """Model name as requested (gpt-4, claude-3-opus, etc.)."""

    MODEL_VERSION = "gen_ai.model.version"
    """Specific model version string."""

    # ─── Prompt / Completion ───
    PROMPT = "gen_ai.prompt"
    """Full prompt text sent to the LLM."""

    COMPLETION = "gen_ai.completion"
    """Full completion text returned by the LLM."""

    # ─── Token Usage ───
    TOKENS_INPUT = "gen_ai.usage.input_tokens"
    """Number of input tokens."""

    TOKENS_OUTPUT = "gen_ai.usage.output_tokens"
    """Number of output tokens."""

    TOKENS_TOTAL = "gen_ai.usage.total_tokens"
    """Total tokens used."""

    # ─── Request Parameters ───
    TEMPERATURE = "gen_ai.request.temperature"
    """Temperature parameter."""

    MAX_TOKENS = "gen_ai.request.max_tokens"
    """Max tokens parameter."""

    # ─── Response Metadata ───
    STOP_REASON = "gen_ai.response.finish_reason"
    """Why generation stopped (stop, length, tool_use, etc.)."""

    LATENCY_MS = "gen_ai.latency_ms"
    """LLM call latency in milliseconds."""


class ErrorAttributes:
    """Attributes describing an error within an agent span."""

    SOURCE = "error.source"
    """Origin of the error (model, tool, human, policy, system)."""

    CAUSE = "error.cause"
    """Root cause classification (hallucination, prompt_injection, tool_failure, timeout, permission_denied, validation_error)."""

    SEVERITY = "error.severity"
    """Severity level (low, medium, high, critical)."""

    RECOVERY_ACTION = "error.recovery.action"
    """What recovery action was taken (retry, fallback, escalate, abort)."""

    ORIGINAL_ERROR = "error.original"
    """Original error message or stack trace."""
