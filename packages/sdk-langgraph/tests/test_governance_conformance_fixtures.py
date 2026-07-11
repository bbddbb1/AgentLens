"""Expanded reference-graph and governance disclosure fixtures."""

from __future__ import annotations

import json

import pytest

pytest.importorskip("langgraph")

from langgraph.types import Command

from agentlens_langgraph.governance_bridge import correlation_invoke_config, generate_control_ref
from agentlens_langgraph.reference_governance_graph import build_reference_governance_graph


@pytest.fixture
def graph():
    return build_reference_governance_graph()


def test_positive_continuation(graph):
    config = {"configurable": {"thread_id": "gov-approve"}}
    graph.invoke({"objective": "approve"}, config)
    final = graph.invoke(Command(resume="approve"), config)
    assert final.get("decision") == "approve" or final.get("status") in {"approved", "completed"}


def test_reject_path(graph):
    config = {"configurable": {"thread_id": "gov-reject"}}
    graph.invoke({"objective": "reject"}, config)
    final = graph.invoke(Command(resume="reject"), config)
    assert final.get("decision") == "reject" or final.get("status") == "rejected"


def test_structured_input_path(graph):
    config = {"configurable": {"thread_id": "gov-struct"}}
    graph.invoke({"objective": "structured"}, config)
    final = graph.invoke(Command(resume={"value": {"note": "ship it"}}), config)
    assert final.get("decision") == "structured_response" or "ship it" in str(final.get("response", ""))


def test_correlation_config_excludes_control_and_checkpoint_secrets():
    control = generate_control_ref()
    config = correlation_invoke_config(
        {"configurable": {"thread_id": "t1"}, "metadata": {"secret": "nope"}},
        interrupt_id="irq-1",
        delivery_id="del-1",
        decision_id="dec-1",
        decision_type="approve",
    )
    blob = json.dumps(config)
    assert "irq-1" in blob
    assert "del-1" in blob
    assert control not in blob
    assert "checkpoint" not in blob.lower() or "checkpoint_id" in blob
    assert "secret" not in blob or config.get("metadata", {}).get("secret") == "nope"
    # Control ref must never be injected by correlation helper.
    assert "control_ref" not in blob
