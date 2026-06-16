"""
Custom span kind constants for multi-agent systems.

These extend the standard OpenTelemetry SpanKind with
agent-specific span classifications.
"""


class AgentSpanKind:
    """
    Span kind values stored in the 'agent.span.kind' attribute.

    These are NOT replacements for OTel SpanKind (CLIENT, SERVER, etc.)
    but rather additional semantic classification stored as span attributes.
    """

    MISSION = "mission"
    """Top-level span representing an entire mission execution."""

    ORCHESTRATION = "agent.orchestration"
    """Framework-level orchestration, routing, or state management."""

    AGENT_TASK = "invoke_agent"
    """An individual agent executing a discrete task."""

    TASK = AGENT_TASK
    """Alias for :attr:`AGENT_TASK`."""

    DELEGATION = "agent.delegation"
    """A delegation handoff from one agent to another."""

    TOOL_CALL = "execute_tool"
    """An agent invoking an external tool or API."""

    REVIEW = "agent.review"
    """A review or critique cycle between agents."""

    REFLECTION = "agent.reflection"
    """An agent's self-reflection step."""

    PLANNING = "agent.planning"
    """An agent creating or revising an execution plan."""

    MEMORY_OP = "agent.memory.op"
    """A shared memory read or write operation."""

    MEMORY = MEMORY_OP
    """Alias for :attr:`MEMORY_OP`."""

    HUMAN_INPUT = "agent.human.input"
    """Waiting for or processing human input."""


class Frameworks:
    """Canonical framework identifiers used by AgentLens semantic conventions."""

    CUSTOM = "custom"
    LANGGRAPH = "langgraph"
    AUTOGEN = "autogen"
    CREWAI = "crewai"
    OPENAI_AGENTS = "openai_agents"
    MS_AGENT_FRAMEWORK = "ms_agent_framework"


_FRAMEWORK_ALIASES = {
    "langchain graph": Frameworks.LANGGRAPH,
    "lang graph": Frameworks.LANGGRAPH,
    "langgraph": Frameworks.LANGGRAPH,
    "autogen": Frameworks.AUTOGEN,
    "auto gen": Frameworks.AUTOGEN,
    "crewai": Frameworks.CREWAI,
    "crew ai": Frameworks.CREWAI,
    "openai agents": Frameworks.OPENAI_AGENTS,
    "openai agents sdk": Frameworks.OPENAI_AGENTS,
    "openai_agents": Frameworks.OPENAI_AGENTS,
    "microsoft agent framework": Frameworks.MS_AGENT_FRAMEWORK,
    "ms agent framework": Frameworks.MS_AGENT_FRAMEWORK,
    "ms_agent_framework": Frameworks.MS_AGENT_FRAMEWORK,
}


def normalize_framework_name(name: str | None) -> str:
    """Return a canonical framework identifier for semantic attributes."""

    if not name:
        return Frameworks.CUSTOM

    normalized = " ".join(name.strip().lower().replace("-", " ").replace("_", " ").split())
    return _FRAMEWORK_ALIASES.get(normalized, normalized.replace(" ", "_"))
