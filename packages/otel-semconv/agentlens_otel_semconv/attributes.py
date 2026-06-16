"""
Semantic attribute keys for multi-agent OpenTelemetry instrumentation.

These follow the OpenTelemetry naming conventions:
- Namespaced with dots (e.g., agent.id)
- Lowercase with underscores within segments
- Consistent with gen_ai.* conventions where applicable
"""


class AgentAttributes:
    """Attributes describing an agent within a multi-agent system."""

    # ─── Identity ───
    ID = "gen_ai.agent.id"
    """Unique identifier for the agent instance."""

    NAME = "gen_ai.agent.name"
    """Human-readable display name of the agent."""

    ROLE = "gen_ai.agent.role"
    """Functional role of the agent (e.g., planner, researcher, critic, executor)."""

    TEAM = "gen_ai.agent.team"
    """Team or group the agent belongs to."""

    FRAMEWORK = "gen_ai.agent.framework"
    """Source framework (langgraph, crewai, autogen, openai_agents, ms_agent_framework)."""

    # ─── Objective ───
    GOAL = "gen_ai.agent.goal"
    """Current high-level objective of the agent."""

    TASK = "gen_ai.agent.task"
    """Specific task being executed."""

    TASK_DESCRIPTION = "gen_ai.agent.task.description"
    """Human-readable description of the current task."""

    # ─── State ───
    CONFIDENCE = "gen_ai.agent.confidence"
    """Agent's confidence score in its output (0.0 to 1.0)."""

    STATUS = "gen_ai.agent.status"
    """Current agent status (active, waiting, completed, failed)."""

    ITERATION = "gen_ai.agent.iteration"
    """Current iteration number (for retry/loop detection)."""

    # ─── Communication ───
    DELEGATION_TARGET = "gen_ai.agent.delegation.target"
    """Agent ID that work is being delegated to."""

    DELEGATION_REASON = "gen_ai.agent.delegation.reason"
    """Reason for delegation."""

    CRITIQUE_TARGET = "gen_ai.agent.critique.target"
    """Agent ID being critiqued."""

    CRITIQUE_RESULT = "gen_ai.agent.critique.result"
    """Result of critique (approved, rejected, needs_revision)."""

    REVIEW_RESULT = "gen_ai.agent.review.result"
    """Result of review (approved, changes_requested, rejected)."""

    REVIEW_TARGET = "gen_ai.agent.review.target"
    """Agent ID or span ID being reviewed."""

    ESCALATION_TARGET = "gen_ai.agent.escalation.target"
    """Target of escalation (human ID or supervisor agent ID)."""

    ESCALATION_REASON = "gen_ai.agent.escalation.reason"
    """Reason for escalation."""

    HANDOFF_TARGET = "gen_ai.agent.handoff.target"
    """Target agent ID for a handoff/transfer of control."""

    HANDOFF_REASON = "gen_ai.agent.handoff.reason"
    """Reason for the handoff/transfer of control."""

    # ─── Memory ───
    MEMORY_KEY = "gen_ai.agent.memory.key"
    """Key of memory being read or written."""

    MEMORY_VALUE = "gen_ai.agent.memory.value"
    """Opaque serialized value written to memory."""

    MEMORY_OPERATION = "gen_ai.agent.memory.operation"
    """Memory operation type (read, write, delete)."""

    # ─── Tool Usage ───
    TOOL_NAME = "gen_ai.tool.name"
    """Name of the tool being invoked."""

    TOOL_INPUT = "gen_ai.tool.input"
    """Serialized input to the tool."""

    TOOL_OUTPUT = "gen_ai.tool.output"
    """Serialized output from the tool."""

    TOOL_STATUS = "gen_ai.tool.status"
    """Tool execution status (success, error, timeout)."""

    INTERRUPT_ID = "gen_ai.agent.interrupt.id"
    """Unique identifier for a human-review interrupt request."""

    INTERRUPT_REASON = "gen_ai.agent.interrupt.reason"
    """Why the agent requires human review or approval."""

    INTERRUPT_RESUME_URL = "gen_ai.agent.interrupt.resume_url"
    """Optional resume URL associated with the interrupt."""

    RESUME_TOKEN = "gen_ai.agent.resume.token"
    """Opaque token that can be used to resume execution after review."""

    HUMAN_DECISION = "gen_ai.agent.human.decision"
    """Human decision captured for an interrupt (approve, reject, resume)."""

    HUMAN_INPUT = "gen_ai.agent.human.input"
    """Free-form human input associated with an interrupt decision."""

    TIMEOUT_AT = "gen_ai.agent.timeout_at"
    """Absolute timeout for a pending interrupt."""

    POLICY_REQUIRED_REVIEW = "gen_ai.agent.policy.required_review"
    """Whether policy or governance requires explicit human review."""


class MissionAttributes:
    """Attributes describing a mission (top-level multi-agent objective)."""

    ID = "gen_ai.workflow.id"
    """Unique identifier for the mission."""

    BRANCH_ID = "gen_ai.workflow.branch_id"
    """The active execution branch ID of the mission."""

    OBJECTIVE = "gen_ai.workflow.name"
    """Human-readable objective of the mission."""

    PHASE = "gen_ai.workflow.phase"
    """Current mission phase (planning, executing, reviewing, completed, failed)."""

    STATUS = "gen_ai.workflow.status"
    """Mission status (active, paused, completed, failed, cancelled)."""

    OWNER = "gen_ai.workflow.owner"
    """User ID of the mission owner."""

    TEAM_SIZE = "gen_ai.workflow.team_size"
    """Number of agents participating in the mission."""

    ENCRYPTION_ENABLED = "gen_ai.workflow.encryption.enabled"
    """Whether the mission data is end-to-end encrypted."""

    FRAMEWORK = "gen_ai.workflow.framework"
    """Primary framework used for the mission."""

    VERSION = "gen_ai.workflow.version"
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
