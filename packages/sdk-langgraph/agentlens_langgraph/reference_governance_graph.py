"""
Minimal LangGraph reference graph for governance bridge conformance.

This graph reaches a real interrupt and supports approve / reject / structured
response mappings owned by the governance bridge. Checkpoint state remains
local to the application process.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class GovernanceState(TypedDict, total=False):
    objective: str
    decision: str
    response: str
    status: str


def review_node(state: GovernanceState) -> Command[Literal["finalize", "rejected"]]:
    """Pause for human governance input, then continue on the explicit path."""
    human_input = interrupt(
        {
            "prompt": "Approve, reject, or provide structured input for the mission objective.",
            "objective": state.get("objective", ""),
            "request_type": "approval",
            "supported_decisions": ["approve", "reject", "structured_response"],
        }
    )
    if human_input is True or human_input == "approve" or (
        isinstance(human_input, dict) and human_input.get("decision") == "approve"
    ):
        return Command(update={"decision": "approve", "status": "approved"}, goto="finalize")
    if human_input is False or human_input == "reject" or (
        isinstance(human_input, dict) and human_input.get("decision") == "reject"
    ):
        return Command(update={"decision": "reject", "status": "rejected"}, goto="rejected")
    response = human_input.get("value") if isinstance(human_input, dict) else human_input
    return Command(
        update={"decision": "structured_response", "response": str(response), "status": "continued"},
        goto="finalize",
    )


def finalize_node(state: GovernanceState) -> GovernanceState:
    return {**state, "status": state.get("status") or "completed"}


def rejected_node(state: GovernanceState) -> GovernanceState:
    return {**state, "status": "rejected"}


def build_reference_governance_graph() -> Any:
    builder = StateGraph(GovernanceState)
    builder.add_node("review", review_node)
    builder.add_node("finalize", finalize_node)
    builder.add_node("rejected", rejected_node)
    builder.add_edge(START, "review")
    builder.add_edge("finalize", END)
    builder.add_edge("rejected", END)
    return builder.compile(checkpointer=MemorySaver())


__all__ = ["GovernanceState", "build_reference_governance_graph"]
