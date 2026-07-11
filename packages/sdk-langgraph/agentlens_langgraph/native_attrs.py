"""
LangGraph-native observational attribute keys preserved in adapter telemetry.

These keys are AgentLens-owned observational provenance. They are not a public
RuntimeEvidence schema and are not framework-owned control references.
"""

from __future__ import annotations


class LangGraphNativeAttributes:
    """Attribute keys for explicitly observable LangGraph native identity."""

    RUN_ID = "agentlens.langgraph.run_id"
    PARENT_RUN_ID = "agentlens.langgraph.parent_run_id"
    THREAD_ID = "agentlens.langgraph.thread_id"
    CHECKPOINT_ID = "agentlens.langgraph.checkpoint_id"
    CHECKPOINT_NS = "agentlens.langgraph.checkpoint_ns"
    ACTIVITY_CORRELATION_ID = "agentlens.langgraph.activity_correlation_id"
    INTERRUPT_REQUEST_ID = "agentlens.langgraph.interrupt_request_id"
    RESUME_OF_INTERRUPT_ID = "agentlens.langgraph.resume_of_interrupt_id"
    RETRIEVAL_MARKER = "agentlens.langgraph.retrieval"
    EXPLICIT_HANDOFF = "agentlens.langgraph.explicit_handoff"
    NATIVE_EXECUTION_KEY = "agentlens.native_execution_key"
    FRAMEWORK = "langgraph"


def derive_native_execution_key(
    *,
    framework: str = LangGraphNativeAttributes.FRAMEWORK,
    thread_id: str | None = None,
    run_id: str | None = None,
    activity_correlation_id: str | None = None,
) -> str | None:
    """
    Derive a stable AgentLens observational correlation key.

    The key is not a framework-owned or executable control reference. It is
    built only from recorded observational identifiers.
    """
    parts = [framework]
    if thread_id:
        parts.append(f"thread:{thread_id}")
    if run_id:
        parts.append(f"run:{run_id}")
    elif activity_correlation_id:
        parts.append(f"activity:{activity_correlation_id}")
    else:
        return None
    return "|".join(parts)
