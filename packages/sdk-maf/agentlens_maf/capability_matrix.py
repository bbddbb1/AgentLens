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


CAPABILITY_MATRIX: tuple[CapabilityRow, ...] = (
    CapabilityRow("workflow", "covered", "MAF WorkflowEvent", "workflow name and lifecycle", "Reference only."),
    CapabilityRow("executor", "covered", "MAF WorkflowEvent", "executor id and lifecycle", "Reference only."),
    CapabilityRow("agent", "covered", "MAF Agent response", "reference agent id", "Deterministic model double."),
    CapabilityRow("tool_function", "covered", "MAF FunctionTool span", "function name and result", "Single tool."),
    CapabilityRow("lifecycle", "covered", "MAF WorkflowEvent", "started/completed/failed", "No inferred lifecycle."),
    CapabilityRow("failure", "covered", "MAF executor exception", "explicit executor failure", "Only explicit failures."),
    CapabilityRow("relationship", "partial", "MAF workflow routing", "configured executor route", "No timing-derived edges."),
    CapabilityRow("request", "covered", "MAF request_info event", "request id/type/source executor", "One typed request."),
    CapabilityRow("response_correlation", "covered", "MAF responses API", "request id and response type", "Only native responses."),
    CapabilityRow("native_identity", "covered", "MAF workflow and event metadata", "workflow/executor/request ids", "No LangGraph aliases."),
    CapabilityRow("model_token", "partial", "MAF Agent response", "deterministic model id", "No provider token use."),
    CapabilityRow("source_traceability", "covered", "native event/span source", "source category", "Fixtures add concrete references."),
    CapabilityRow("private_bridge_binding", "not_observable", "private bridge availability", "binding readiness only", "Never exposes a control reference."),
    CapabilityRow("governance_binding_readiness", "not_applicable", "private bridge test setup", "availability status", "Not an observability fact."),
)


def capability_row(key: str) -> CapabilityRow:
    return next(row for row in CAPABILITY_MATRIX if row.key == key)
