"""
Executable LangGraph runtime-observability capability matrix.

Statuses and fixture links live here for tests/docs only. This is not a
generalized product capability or framework-profile model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

MatrixStatus = Literal["covered", "partial", "not_observable", "not_applicable"]

REQUIRED_CAPABILITY_IDS = (
    "agent",
    "llm",
    "tool",
    "retrieval",
    "framework",
    "thread_identity",
    "run_parent_run_identity",
    "activity_correlation",
    "failure",
    "interrupt_request",
    "resume_observation",
    "explicit_handoff",
    "token_usage",
    "checkpoint_reference",
    "native_execution_key",
)


@dataclass(frozen=True)
class CapabilityRow:
    """One LangGraph observability capability row."""

    capability_id: str
    native_fact: str
    native_source: str
    status: MatrixStatus
    adapter_telemetry: tuple[str, ...]
    fixture: str
    expected_facts: tuple[str, ...]
    projected_surface: str
    references: tuple[str, ...]
    limitation: str
    notes: str = ""


# Truthful initial statuses reflecting current adapter after Iteration-2 capture.
# Rows may remain partial/not_observable when LangGraph does not expose the fact.
LANGGRAPH_CAPABILITY_MATRIX: tuple[CapabilityRow, ...] = (
    CapabilityRow(
        capability_id="agent",
        native_fact="LangGraph node/chain activity lifecycle",
        native_source="on_chain_start / on_chain_end / on_chain_error",
        status="covered",
        adapter_telemetry=("agent span", "gen_ai.agent.*", "agent.span.kind"),
        fixture="agent_success",
        expected_facts=("activity_kind=agent", "outcome=success|failed", "run_id"),
        projected_surface="GraphNode(type=agent|task) + span lifecycle events",
        references=("agentlens.langgraph.run_id", "source span_id"),
        limitation="Framework wrapper nodes (LangGraph/RunnableSequence/…) are ignored by design.",
    ),
    CapabilityRow(
        capability_id="llm",
        native_fact="LLM/chat-model invocation lifecycle and model identity",
        native_source="on_llm_start / on_llm_end / on_chat_model_* when callbacks fire",
        status="partial",
        adapter_telemetry=("gen_ai.call event", "gen_ai.request.model"),
        fixture="llm_token_usage",
        expected_facts=("activity_kind=llm", "model when recorded"),
        projected_surface="EventEnvelope gen_ai.call / model provenance",
        references=("agentlens.langgraph.run_id", "activity_correlation_id"),
        limitation="Only observable when LangChain LLM/chat-model callbacks are invoked with metadata.",
    ),
    CapabilityRow(
        capability_id="tool",
        native_fact="Tool invocation identity and lifecycle",
        native_source="on_tool_start / on_tool_end / on_tool_error",
        status="covered",
        adapter_telemetry=("agent.tool.call", "gen_ai.tool.*", "run_id on event"),
        fixture="tool_success",
        expected_facts=("activity_kind=tool", "tool_name", "outcome", "distinct run_ids"),
        projected_surface="tool events on agent span / replay timeline",
        references=("agentlens.langgraph.run_id", "activity_correlation_id"),
        limitation="Tools are span events on the parent agent span, not independent tool spans.",
    ),
    CapabilityRow(
        capability_id="retrieval",
        native_fact="Explicit retriever invocation",
        native_source="on_retriever_start / on_retriever_end / on_retriever_error",
        status="partial",
        adapter_telemetry=("agent.tool.call", "agentlens.langgraph.retrieval=true"),
        fixture="retrieval_explicit",
        expected_facts=("activity_kind=retrieval", "retrieval marker"),
        projected_surface="retrieval-marked tool-like event",
        references=("agentlens.langgraph.run_id",),
        limitation="Generic tool names that merely suggest retrieval are not claimed as Retrieval.",
    ),
    CapabilityRow(
        capability_id="framework",
        native_fact="Framework identity = langgraph",
        native_source="AgentLens(framework='langgraph') / auto_instrument",
        status="covered",
        adapter_telemetry=("gen_ai.agent.framework", "resource agentlens.framework"),
        fixture="agent_success",
        expected_facts=("framework=langgraph",),
        projected_surface="node.framework / origin_framework",
        references=("gen_ai.agent.framework",),
        limitation="",
    ),
    CapabilityRow(
        capability_id="thread_identity",
        native_fact="LangGraph thread_id",
        native_source="callback metadata/configurable thread_id when present",
        status="partial",
        adapter_telemetry=("agentlens.langgraph.thread_id",),
        fixture="agent_success",
        expected_facts=("thread_id when present in metadata",),
        projected_surface="metadata.native_runtime_identity.thread_id",
        references=("agentlens.langgraph.thread_id",),
        limitation="Absent when callers do not put thread_id in callback metadata/configurable.",
    ),
    CapabilityRow(
        capability_id="run_parent_run_identity",
        native_fact="Callback run_id and parent_run_id",
        native_source="BaseCallbackHandler run_id / parent_run_id",
        status="covered",
        adapter_telemetry=(
            "agentlens.langgraph.run_id",
            "agentlens.langgraph.parent_run_id",
        ),
        fixture="parent_child_correlation",
        expected_facts=("run_id", "parent_run_id when nested"),
        projected_surface="metadata.native_runtime_identity",
        references=("agentlens.langgraph.run_id", "agentlens.langgraph.parent_run_id"),
        limitation="",
    ),
    CapabilityRow(
        capability_id="activity_correlation",
        native_fact="Stable correlation across related callbacks for one invocation",
        native_source="run_id used as activity_correlation_id",
        status="covered",
        adapter_telemetry=("agentlens.langgraph.activity_correlation_id",),
        fixture="tool_success",
        expected_facts=("activity_correlation_id == run_id string",),
        projected_surface="metadata.native_runtime_identity.activity_correlation_id",
        references=("agentlens.langgraph.activity_correlation_id",),
        limitation="",
    ),
    CapabilityRow(
        capability_id="failure",
        native_fact="Explicit callback error/failure",
        native_source="on_chain_error / on_tool_error / on_llm_error / on_retriever_error",
        status="partial",
        adapter_telemetry=("span status ERROR", "gen_ai.tool.status=error"),
        fixture="tool_failed",
        expected_facts=("outcome=failed", "never success"),
        projected_surface="node/event status failed",
        references=("source span/event status",),
        limitation=(
            "Tool failure is fixture-backed end-to-end; chain/LLM/retrieval failure paths "
            "are implemented in the adapter but not all have dedicated fixtures yet."
        ),
    ),
    CapabilityRow(
        capability_id="interrupt_request",
        native_fact="Explicit interrupt request identity",
        native_source="outputs/metadata containing __interrupt__ or langgraph interrupt id",
        status="partial",
        adapter_telemetry=(
            "agent.interrupt.requested",
            "agentlens.langgraph.interrupt_request_id",
        ),
        fixture="interrupt_request",
        expected_facts=("interrupt_request_id when explicit",),
        projected_surface="interrupt observation event + native_runtime_identity",
        references=("agentlens.langgraph.interrupt_request_id",),
        limitation="Only when interrupt payload/id is explicit in callback outputs/metadata; no approval/resume control.",
    ),
    CapabilityRow(
        capability_id="resume_observation",
        native_fact="Explicit resume observation linked to prior interrupt",
        native_source="metadata/tags explicitly identifying resume_of interrupt id",
        status="partial",
        adapter_telemetry=(
            "agent.interrupt.resumed",
            "agentlens.langgraph.resume_of_interrupt_id",
        ),
        fixture="interrupt_resume",
        expected_facts=("resume correlates to interrupt_request_id when explicit",),
        projected_surface="resume observation event",
        references=("agentlens.langgraph.resume_of_interrupt_id",),
        limitation="Later activity after interrupt is never inferred as resume.",
    ),
    CapabilityRow(
        capability_id="explicit_handoff",
        native_fact="Explicit handoff/delegation evidence",
        native_source="metadata markers (langgraph_handoff, handoff_to, explicit_handoff_target); not Command.goto/routing",
        status="partial",
        adapter_telemetry=(
            "agent.handoff.requested",
            "agentlens.langgraph.explicit_handoff=true",
        ),
        fixture="explicit_handoff",
        expected_facts=("handoff only with explicit evidence", "parent-child alone is not handoff", "goto is not handoff"),
        projected_surface="delegation edge only for explicit handoff",
        references=("agentlens.langgraph.explicit_handoff",),
        limitation=(
            "Ordinary parent-child nesting and Command.goto/output goto/workflow routing "
            "are not handoff. Fixture proves explicit metadata markers only; a fuller "
            "LangGraph-native handoff contract remains partial."
        ),
    ),
    CapabilityRow(
        capability_id="token_usage",
        native_fact="LLM token usage counts",
        native_source="LLM result response_metadata / llm_output token_usage via LangGraph LLM callbacks",
        status="partial",
        adapter_telemetry=(
            "gen_ai.usage.input_tokens",
            "gen_ai.usage.output_tokens",
        ),
        fixture="llm_token_usage",
        expected_facts=("tokens_input/output when recorded",),
        projected_surface="model provenance / event attrs",
        references=("gen_ai.usage.*",),
        limitation="Not observable when the model provider omits usage metadata.",
    ),
    CapabilityRow(
        capability_id="checkpoint_reference",
        native_fact="Checkpoint id/namespace reference",
        native_source="metadata checkpoint_id / langgraph_checkpoint_id / checkpoint_ns",
        status="partial",
        adapter_telemetry=(
            "agentlens.langgraph.checkpoint_id",
            "agentlens.langgraph.checkpoint_ns",
        ),
        fixture="checkpoint_reference",
        expected_facts=("checkpoint_id/ns when present", "no payload"),
        projected_surface="metadata.native_runtime_identity.checkpoint_id",
        references=("agentlens.langgraph.checkpoint_id",),
        limitation="Reference only; checkpoint/state payloads are never captured.",
    ),
    CapabilityRow(
        capability_id="native_execution_key",
        native_fact="AgentLens-derived observational native_execution_key",
        native_source="Derived from recorded framework + thread/run/activity ids",
        status="covered",
        adapter_telemetry=("agentlens.native_execution_key",),
        fixture="agent_success",
        expected_facts=("stable key for same identifiers", "not a control reference"),
        projected_surface="metadata.native_runtime_identity.native_execution_key",
        references=("agentlens.native_execution_key",),
        limitation="Observational provenance only; reserved control references are deferred.",
    ),
)


def get_matrix() -> tuple[CapabilityRow, ...]:
    return LANGGRAPH_CAPABILITY_MATRIX


def matrix_by_id() -> dict[str, CapabilityRow]:
    return {row.capability_id: row for row in LANGGRAPH_CAPABILITY_MATRIX}


def validate_matrix_completeness(rows: tuple[CapabilityRow, ...] = LANGGRAPH_CAPABILITY_MATRIX) -> list[str]:
    """Return validation errors if the matrix is incomplete or inconsistent."""
    errors: list[str] = []
    by_id = {row.capability_id: row for row in rows}
    for required in REQUIRED_CAPABILITY_IDS:
        if required not in by_id:
            errors.append(f"missing required capability row: {required}")
            continue
        row = by_id[required]
        if row.status not in ("covered", "partial", "not_observable", "not_applicable"):
            errors.append(f"{required}: unsupported status {row.status!r}")
        if not row.native_source:
            errors.append(f"{required}: native_source required")
        if not row.fixture:
            errors.append(f"{required}: fixture link required")
        if not row.expected_facts:
            errors.append(f"{required}: expected_facts required")
        if not row.projected_surface:
            errors.append(f"{required}: projected_surface required")
        if not row.references:
            errors.append(f"{required}: references required")
        if row.status == "covered":
            if not row.adapter_telemetry:
                errors.append(f"{required}: covered rows require adapter_telemetry")
        if row.status in ("partial", "not_observable") and not row.limitation:
            errors.append(f"{required}: {row.status} rows require an explicit limitation")
    return errors
