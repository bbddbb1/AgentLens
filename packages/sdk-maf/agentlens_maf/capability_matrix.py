"""Fixture-scoped MAF 1.10.0 capability inventory for the reference runtime."""

from dataclasses import dataclass
from typing import Literal

CapabilityStatus = Literal["covered", "partial", "not_observable", "not_applicable"]


@dataclass(frozen=True)
class CapabilityRow:
    key: str
    status: CapabilityStatus
    source: str
    expected_fact: str
    limitation: str
    fixture: str


CAPABILITY_MATRIX: tuple[CapabilityRow, ...] = (
    CapabilityRow("workflow", "covered", "MAF WorkflowEvent", "workflow name and lifecycle", "Reference only.", "success"),
    CapabilityRow("executor", "covered", "MAF WorkflowEvent", "executor id and lifecycle", "Reference only.", "success"),
    CapabilityRow("agent", "covered", "MAF Agent response", "reference agent id", "Deterministic model double.", "agent_tool"),
    CapabilityRow("tool_function", "covered", "MAF FunctionTool span", "function name and result", "Single tool.", "agent_tool"),
    CapabilityRow("lifecycle", "covered", "MAF WorkflowEvent", "started/completed/failed", "No inferred lifecycle.", "success"),
    CapabilityRow("failure", "covered", "MAF executor exception", "explicit executor failure", "Only explicit failures.", "explicit_failure"),
    CapabilityRow("relationship", "partial", "MAF workflow routing", "configured executor route", "No timing-derived edges.", "unrelated_later_activity"),
    CapabilityRow("request", "covered", "MAF request_info event", "request id/type/source executor", "One typed request.", "request"),
    CapabilityRow("response_correlation", "covered", "MAF responses API", "request id and response type", "Only native responses.", "continuation"),
    CapabilityRow("post_acceptance_failure", "partial", "MAF response handler", "accepted response with failed terminal enrichment", "Reference catches the failure and emits enrichment; it is not a native executor failure.", "post_acceptance_failure"),
    CapabilityRow("native_identity", "covered", "MAF workflow and event metadata", "workflow/executor/request ids", "No LangGraph aliases.", "request"),
    CapabilityRow("model_token", "partial", "MAF Agent response", "deterministic model id", "No provider token use.", "agent_tool"),
    CapabilityRow("source_traceability", "covered", "native event/span source", "source category", "Fixtures add concrete references.", "request"),
    CapabilityRow("private_bridge_binding", "not_observable", "private bridge availability", "binding readiness only", "Never exposes a control reference.", "missing_identity"),
    CapabilityRow("governance_binding_readiness", "not_applicable", "private bridge test setup", "availability status", "Not an observability fact.", "missing_identity"),
)


def capability_row(key: str) -> CapabilityRow:
    return next(row for row in CAPABILITY_MATRIX if row.key == key)
