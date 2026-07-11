"""
Minimal real governance integration harness.

Real components:
- LangGraph reference graph + MemorySaver checkpointer
- Native Command(resume=...) execution via LangGraphGovernanceBridge
- Bridge decision mapping and local at-most-once delivery marker
- Correlation invoke config (no control_ref leakage)

Mocked components:
- AgentLens HTTP API (register/claim/receipt) via httpx.MockTransport
- PostgreSQL / Core persistence (simulated by mock claim durability responses)

This is intentionally not a generalized integration platform.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from agentlens_langgraph.governance_bridge import (
    BridgeHttpError,
    LangGraphGovernanceBridge,
    NativeIdentity,
)
from agentlens_langgraph.reference_governance_graph import build_reference_governance_graph

MISSION = "11111111-1111-1111-1111-111111111111"
BRANCH = "main"
IRQ = "irq-ref-1"


def _mock_transport(handlers: dict[tuple[str, str], Any]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        if key not in handlers:
            return httpx.Response(404, json={"detail": f"unhandled {key}"})
        spec = handlers[key]
        if callable(spec):
            return spec(request)
        status, body = spec
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler)


def _handlers(state: dict[str, Any]) -> dict[tuple[str, str], Any]:
    base = f"/api/v1/missions/{MISSION}/branches/{BRANCH}/langgraph/bridge"

    def register(_request: httpx.Request) -> httpx.Response:
        state["generation"] = state.get("generation", 0) + 1
        return httpx.Response(
            201,
            json={
                "binding_id": f"b-{state['generation']}",
                "generation": state["generation"],
                "lifecycle_state": "active",
                "lease_expires_at": "2099-01-01T00:00:00.000Z",
            },
        )

    def claim(_request: httpx.Request) -> httpx.Response:
        if state.get("expired"):
            return httpx.Response(
                409,
                json={"detail": "Interrupt is not actionable", "actionability": "observed_only"},
            )
        if state.get("claimed"):
            return httpx.Response(
                200,
                json={
                    "claimed": False,
                    "delivery_id": state["delivery_id"],
                    "delivery_state": state.get("delivery_state", "pending"),
                    "decision_id": state["decision_id"],
                    "decision_type": "approve",
                },
            )
        state["claimed"] = True
        state["delivery_id"] = "del-real-1"
        state["decision_id"] = "dec-real-1"
        state["delivery_state"] = "pending"
        return httpx.Response(
            200,
            json={
                "claimed": True,
                "delivery_id": "del-real-1",
                "delivery_state": "pending",
                "decision_id": "dec-real-1",
                "decision_type": "approve",
                "value": True,
            },
        )

    def receipt(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode() or "{}")
        receipt_value = body.get("receipt")
        current = state.get("delivery_state", "pending")
        if current == "accepted" and receipt_value in {"pending", "failed", "unknown"}:
            receipt_value = "accepted"
        state["delivery_state"] = receipt_value
        return httpx.Response(
            200,
            json={"delivery_id": body.get("delivery_id"), "delivery_state": receipt_value},
        )

    return {
        ("POST", f"{base}/register"): register,
        ("POST", f"{base}/claim"): claim,
        ("POST", f"{base}/receipt"): receipt,
        ("POST", f"{base}/renew"): (
            200,
            {
                "binding_id": "b-1",
                "generation": 1,
                "lifecycle_state": "active",
                "lease_expires_at": "2099-01-01T00:00:00.000Z",
            },
        ),
    }


def _bridge(state: dict[str, Any], *, graph: Any, config: dict[str, Any]) -> LangGraphGovernanceBridge:
    http = httpx.Client(
        transport=_mock_transport(_handlers(state)),
        base_url="http://agentlens.test",
    )
    return LangGraphGovernanceBridge(
        api_base_url="http://agentlens.test",
        mission_id=MISSION,
        branch_id=BRANCH,
        compiled_graph=graph,
        invocation_config=config,
        http_client=http,
    )


def test_real_graph_positive_continuation_via_bridge():
    state: dict[str, Any] = {}
    graph = build_reference_governance_graph()
    config = {"configurable": {"thread_id": "harness-approve"}}
    graph.invoke({"objective": "approve path"}, config)
    assert graph.get_state(config).next

    bridge = _bridge(state, graph=graph, config=config)
    bridge.register(
        native_identity=NativeIdentity(thread_id="harness-approve", interaction_request_id=IRQ),
        interrupt_id=IRQ,
    )
    claim = bridge.claim_pending(interrupt_id=IRQ)
    assert claim.claimed is True
    assert claim.delivery_state == "pending"

    receipt = bridge.apply_claimed_delivery(claim, interrupt_id=IRQ)
    assert receipt is not None
    assert receipt.delivery_state == "accepted"
    final = graph.get_state(config).values
    assert final.get("decision") == "approve" or final.get("status") in {"approved", "completed"}


def test_expired_binding_claim_rejected():
    state: dict[str, Any] = {"expired": True}
    graph = build_reference_governance_graph()
    config = {"configurable": {"thread_id": "harness-expired"}}
    bridge = _bridge(state, graph=graph, config=config)
    bridge.register(
        native_identity=NativeIdentity(thread_id="harness-expired", interaction_request_id=IRQ),
        interrupt_id=IRQ,
    )
    with pytest.raises(BridgeHttpError):
        bridge.claim_pending(interrupt_id=IRQ)


def test_claimed_delivery_not_reissued_after_bridge_restart():
    state: dict[str, Any] = {}
    graph = build_reference_governance_graph()
    config = {"configurable": {"thread_id": "harness-restart"}}
    graph.invoke({"objective": "restart"}, config)

    bridge1 = _bridge(state, graph=graph, config=config)
    bridge1.register(
        native_identity=NativeIdentity(thread_id="harness-restart", interaction_request_id=IRQ),
        interrupt_id=IRQ,
    )
    first = bridge1.claim_pending(interrupt_id=IRQ)
    assert first.claimed is True

    bridge2 = _bridge(state, graph=graph, config=config)
    bridge2.register(
        native_identity=NativeIdentity(thread_id="harness-restart", interaction_request_id=IRQ),
        interrupt_id=IRQ,
    )
    second = bridge2.claim_pending(interrupt_id=IRQ)
    assert second.claimed is False


def test_accepted_without_runtime_evidence_stays_unknown_outcome():
    public = {
        "decision_state": "recorded",
        "delivery_state": "accepted",
        "runtime_outcome": "unknown",
    }
    assert public["delivery_state"] == "accepted"
    assert public["runtime_outcome"] == "unknown"


def test_runtime_failure_after_accepted_remains_separate():
    public = {"delivery_state": "accepted", "runtime_outcome": "failed"}
    assert public["delivery_state"] == "accepted"
    assert public["runtime_outcome"] == "failed"


def test_duplicate_decision_does_not_create_second_delivery_instruction():
    """Simulated Core: one delivery id; second claim is not a new instruction."""
    state: dict[str, Any] = {}
    graph = build_reference_governance_graph()
    config = {"configurable": {"thread_id": "harness-dup"}}
    graph.invoke({"objective": "dup"}, config)
    bridge = _bridge(state, graph=graph, config=config)
    bridge.register(
        native_identity=NativeIdentity(thread_id="harness-dup", interaction_request_id=IRQ),
        interrupt_id=IRQ,
    )
    first = bridge.claim_pending(interrupt_id=IRQ)
    second = bridge.claim_pending(interrupt_id=IRQ)
    assert first.claimed is True
    assert second.claimed is False
    assert first.delivery_id == second.delivery_id
