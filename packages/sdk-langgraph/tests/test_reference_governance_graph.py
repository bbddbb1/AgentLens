"""Smoke tests for the checked-in LangGraph governance reference graph."""

from __future__ import annotations

import pytest

langgraph = pytest.importorskip("langgraph")

from agentlens_langgraph.reference_governance_graph import build_reference_governance_graph


def test_reference_graph_reaches_interrupt():
    graph = build_reference_governance_graph()
    config = {"configurable": {"thread_id": "governance-ref-1"}}
    result = graph.invoke({"objective": "Ship the governance vertical slice"}, config)
    # LangGraph interrupt surfaces as __interrupt__ / pending state depending on version.
    state = graph.get_state(config)
    assert state is not None
    assert state.next, "expected graph to pause at the review interrupt"
    assert result is not None or state.values.get("objective") == "Ship the governance vertical slice"


def test_reference_graph_continues_on_approve():
    graph = build_reference_governance_graph()
    config = {"configurable": {"thread_id": "governance-ref-2"}}
    graph.invoke({"objective": "Approve path"}, config)
    from langgraph.types import Command

    final = graph.invoke(Command(resume="approve"), config)
    assert final.get("decision") == "approve" or final.get("status") in {"approved", "completed", "continued"}
