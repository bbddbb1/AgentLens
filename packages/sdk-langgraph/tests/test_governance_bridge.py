"""Unit tests for the LangGraph governance bridge (mocked HTTP)."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from langgraph.types import Command

from agentlens_langgraph.governance_bridge import (
    BridgeDecisionMappingError,
    BridgeHttpError,
    GovernanceBridgeClient,
    LangGraphGovernanceBridge,
    NativeIdentity,
    build_service_auth_headers,
    correlation_invoke_config,
    generate_control_ref,
    map_decision_to_command,
)


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


class TestControlRefAndAuth:
    def test_generate_control_ref_is_opaque_and_long_enough(self):
        ref = generate_control_ref()
        other = generate_control_ref()
        assert len(ref) >= 16
        assert len(other) >= 16
        assert ref != other

    def test_build_service_auth_from_agentlens_service_token(self, monkeypatch):
        monkeypatch.delenv("Authorization", raising=False)
        monkeypatch.delenv("AUTHORIZATION", raising=False)
        monkeypatch.setenv("AGENTLENS_SERVICE_TOKEN", "svc-secret")
        headers = build_service_auth_headers()
        assert headers["Authorization"] == "Bearer svc-secret"

    def test_build_service_auth_passes_through_authorization_env(self, monkeypatch):
        monkeypatch.setenv("Authorization", "Bearer explicit")
        monkeypatch.delenv("AGENTLENS_SERVICE_TOKEN", raising=False)
        headers = build_service_auth_headers()
        assert headers["Authorization"] == "Bearer explicit"


class TestDecisionMapping:
    def test_approve_maps_to_resume_true(self):
        cmd = map_decision_to_command("approve", None)
        assert cmd == Command(resume=True)

    def test_reject_maps_to_resume_false(self):
        cmd = map_decision_to_command("reject", None)
        assert cmd == Command(resume=False)

    def test_structured_response_maps_value(self):
        value = {"answer": "yes", "confidence": 0.9}
        cmd = map_decision_to_command("structured_response", value)
        assert cmd == Command(resume=value)

    def test_unknown_decision_raises(self):
        with pytest.raises(BridgeDecisionMappingError):
            map_decision_to_command("pause", None)


class TestGovernanceBridgeClient:
    MISSION = "mission-1"
    BRANCH = "branch-main"
    CONTROL_REF = "test-control-ref-0123456789ab"

    def _client(self, handlers: dict[tuple[str, str], Any]) -> GovernanceBridgeClient:
        transport = _mock_transport(handlers)
        http = httpx.Client(transport=transport, base_url="http://agentlens.test")
        return GovernanceBridgeClient(
            api_base_url="http://agentlens.test",
            mission_id=self.MISSION,
            branch_id=self.BRANCH,
            control_ref=self.CONTROL_REF,
            http_client=http,
        )

    def test_register_posts_expected_payload(self):
        captured: dict[str, Any] = {}

        def capture_register(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                201,
                json={
                    "binding_id": "bind-1",
                    "generation": 2,
                    "lifecycle_state": "active",
                    "lease_expires_at": "2026-01-01T01:00:00Z",
                },
            )

        path = (
            f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge/register"
        )
        client = self._client({("POST", path): capture_register})
        identity = NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        result = client.register(
            native_identity=identity,
            interrupt_id="intr-9",
            lease_seconds=90,
        )

        assert result.binding_id == "bind-1"
        assert result.generation == 2
        assert captured["body"]["control_ref"] == self.CONTROL_REF
        assert captured["body"]["lease_seconds"] == 90
        assert captured["body"]["interrupt_id"] == "intr-9"
        assert captured["body"]["native_identity"]["thread_id"] == "thread-1"
        assert "checkpoint" not in json.dumps(captured["body"]).lower()

    def test_renew_posts_control_ref(self):
        path = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge/renew"
        client = self._client(
            {
                ("POST", path): (
                    200,
                    {
                        "binding_id": "bind-1",
                        "generation": 2,
                        "lifecycle_state": "active",
                        "lease_expires_at": "2026-01-01T01:00:00Z",
                    },
                )
            }
        )
        result = client.renew(lease_seconds=45)
        assert result.lifecycle_state == "active"

    def test_claim_parses_delivery(self):
        path = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge/claim"
        client = self._client(
            {
                ("POST", path): (
                    200,
                    {
                        "claimed": True,
                        "delivery_id": "del-1",
                        "delivery_state": "pending",
                        "interaction_request_id": "intr-9",
                        "decision_id": "dec-1",
                        "decision_type": "approve",
                        "value": None,
                    },
                )
            }
        )
        claim = client.claim(interrupt_id="intr-9")
        assert claim.claimed is True
        assert claim.delivery_state == "pending"
        assert claim.decision_type == "approve"

    def test_receipt_posts_idempotent_state(self):
        path = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge/receipt"
        client = self._client(
            {
                ("POST", path): (
                    200,
                    {"delivery_id": "del-1", "delivery_state": "accepted"},
                )
            }
        )
        receipt = client.receipt(
            interrupt_id="intr-9",
            delivery_id="del-1",
            receipt="accepted",
            receipt_correlation="dec-1",
        )
        assert receipt.delivery_state == "accepted"

    def test_http_error_raises_bridge_http_error(self):
        path = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge/renew"
        client = self._client({("POST", path): (404, {"detail": "Active binding not found"})})
        with pytest.raises(BridgeHttpError, match="Active binding not found"):
            client.renew()


class TestLangGraphGovernanceBridge:
    MISSION = "mission-1"
    BRANCH = "branch-main"

    def _make_handlers(self) -> dict[tuple[str, str], Any]:
        base = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge"
        return {
            ("POST", f"{base}/register"): (
                201,
                {
                    "binding_id": "bind-1",
                    "generation": 1,
                    "lifecycle_state": "active",
                    "lease_expires_at": "2026-01-01T01:00:00Z",
                },
            ),
            ("POST", f"{base}/claim"): (
                200,
                {
                    "claimed": True,
                    "delivery_id": "del-1",
                    "delivery_state": "pending",
                    "interaction_request_id": "intr-9",
                    "decision_id": "dec-1",
                    "decision_type": "approve",
                    "value": None,
                },
            ),
            ("POST", f"{base}/receipt"): (
                200,
                {"delivery_id": "del-1", "delivery_state": "accepted"},
            ),
        }

    def _bridge(self, handlers: dict[tuple[str, str], Any] | None = None) -> LangGraphGovernanceBridge:
        transport = _mock_transport(handlers or self._make_handlers())
        http = httpx.Client(transport=transport, base_url="http://agentlens.test")
        graph = MagicMock()
        graph.invoke.return_value = {"ok": True}
        return LangGraphGovernanceBridge(
            api_base_url="http://agentlens.test",
            mission_id=self.MISSION,
            branch_id=self.BRANCH,
            compiled_graph=graph,
            invocation_config={"configurable": {"thread_id": "thread-1"}},
            checkpointer=MagicMock(name="checkpointer"),
            http_client=http,
        )

    def test_register_generates_new_control_ref_on_restart(self):
        bridge = self._bridge()
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        first_ref = bridge.control_ref

        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        second_ref = bridge.control_ref

        assert first_ref is not None
        assert second_ref is not None
        assert first_ref != second_ref

    def test_apply_claimed_delivery_invokes_graph_and_posts_accepted(self):
        bridge = self._bridge()
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        claim = bridge.claim_pending(interrupt_id="intr-9")

        receipt = bridge.apply_claimed_delivery(claim, interrupt_id="intr-9")

        assert receipt is not None
        assert receipt.delivery_state == "accepted"
        bridge.compiled_graph.invoke.assert_called_once()
        invoked_command = bridge.compiled_graph.invoke.call_args.args[0]
        assert invoked_command == Command(resume=True)

    def test_apply_is_at_most_once_per_delivery(self):
        bridge = self._bridge()
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        claim = bridge.claim_pending(interrupt_id="intr-9")

        bridge.apply_claimed_delivery(claim, interrupt_id="intr-9")
        bridge.apply_claimed_delivery(claim, interrupt_id="intr-9")

        bridge.compiled_graph.invoke.assert_called_once()

    def test_unsupported_decision_posts_failed_without_graph_invoke(self):
        handlers = self._make_handlers()
        base = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge"
        handlers[("POST", f"{base}/claim")] = (
            200,
            {
                "claimed": True,
                "delivery_id": "del-2",
                "delivery_state": "pending",
                "interaction_request_id": "intr-9",
                "decision_id": "dec-2",
                "decision_type": "pause",
                "value": None,
            },
        )
        bridge = self._bridge(handlers)
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        claim = bridge.claim_pending(interrupt_id="intr-9")

        bridge.apply_claimed_delivery(claim, interrupt_id="intr-9")

        bridge.compiled_graph.invoke.assert_not_called()

    def test_control_ref_not_exposed_in_repr(self):
        bridge = self._bridge()
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        assert bridge.control_ref not in repr(bridge)

    def test_checkpointer_stays_local(self):
        checkpointer = MagicMock(name="checkpointer")
        bridge = LangGraphGovernanceBridge(
            api_base_url="http://agentlens.test",
            mission_id=self.MISSION,
            branch_id=self.BRANCH,
            compiled_graph=MagicMock(),
            checkpointer=checkpointer,
        )
        assert bridge.checkpointer is checkpointer

    def test_poll_and_apply_orchestrates_claim_and_apply(self):
        bridge = self._bridge()
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        receipt = bridge.poll_and_apply(interrupt_id="intr-9")
        assert receipt is not None
        assert receipt.delivery_state == "accepted"

    def test_apply_injects_resume_correlation_without_control_secrets(self):
        bridge = self._bridge()
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        claim = bridge.claim_pending(interrupt_id="intr-9")
        bridge.apply_claimed_delivery(claim, interrupt_id="intr-9")

        invoke_config = bridge.compiled_graph.invoke.call_args.kwargs["config"]
        assert invoke_config["metadata"]["resume_of_interrupt_id"] == "intr-9"
        assert invoke_config["metadata"]["governance_delivery_id"] == "del-1"
        assert "resume_of:intr-9" in invoke_config["tags"]
        dumped = json.dumps(invoke_config)
        assert bridge.control_ref not in dumped
        assert "control_ref" not in dumped
        assert "checkpoint" not in dumped.lower()

    def test_claim_without_acceptance_leaves_delivery_pending(self):
        """Claim alone does not invoke LangGraph or post an accepted receipt."""
        handlers = self._make_handlers()
        bridge = self._bridge(handlers)
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        claim = bridge.claim_pending(interrupt_id="intr-9")

        assert claim.claimed is True
        assert claim.delivery_state == "pending"
        bridge.compiled_graph.invoke.assert_not_called()

    def test_bridge_restart_cannot_reclaim_already_claimed_delivery(self):
        """After Core has issued a claim, a fresh Bridge instance must not get a second instruction."""
        claim_calls = {"n": 0}

        def claim_handler(request: httpx.Request) -> httpx.Response:
            claim_calls["n"] += 1
            if claim_calls["n"] == 1:
                return httpx.Response(
                    200,
                    json={
                        "claimed": True,
                        "delivery_id": "del-1",
                        "delivery_state": "pending",
                        "decision_id": "dec-1",
                        "decision_type": "approve",
                        "value": True,
                    },
                )
            # Subsequent claims (including after restart) — no new application instruction.
            return httpx.Response(
                200,
                json={
                    "claimed": False,
                    "delivery_id": "del-1",
                    "delivery_state": "pending",
                    "decision_id": "dec-1",
                    "decision_type": "approve",
                },
            )

        handlers = self._make_handlers()
        base = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge"
        handlers[("POST", f"{base}/claim")] = claim_handler

        bridge1 = self._bridge(handlers)
        bridge1.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        first = bridge1.claim_pending(interrupt_id="intr-9")
        assert first.claimed is True

        # Fresh bridge instance (restart) with new control ref registration.
        bridge2 = self._bridge(handlers)
        bridge2.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        second = bridge2.claim_pending(interrupt_id="intr-9")
        assert second.claimed is False
        bridge2.compiled_graph.invoke.assert_not_called()

    def test_pre_acceptance_graph_failure_posts_failed(self):
        handlers = self._make_handlers()
        base = f"/api/v1/missions/{self.MISSION}/branches/{self.BRANCH}/langgraph/bridge"
        handlers[("POST", f"{base}/receipt")] = (
            200,
            {"delivery_id": "del-1", "delivery_state": "failed"},
        )
        bridge = self._bridge(handlers)
        bridge.compiled_graph.invoke.side_effect = RuntimeError("boom")
        bridge.register(
            native_identity=NativeIdentity(thread_id="thread-1", interaction_request_id="intr-9")
        )
        claim = bridge.claim_pending(interrupt_id="intr-9")

        receipt = bridge.apply_claimed_delivery(claim, interrupt_id="intr-9")
        assert receipt is not None
        assert receipt.delivery_state == "failed"

    def test_correlation_config_excludes_control_ref(self):
        config = correlation_invoke_config(
            {"configurable": {"thread_id": "t1"}},
            interrupt_id="intr-9",
            delivery_id="del-1",
            decision_id="dec-1",
            decision_type="approve",
        )
        assert config["metadata"]["resume_of_interrupt_id"] == "intr-9"
        assert "control_ref" not in json.dumps(config)


class TestCorrelationInvokeConfig:
    def test_merges_tags_and_metadata(self):
        config = correlation_invoke_config(
            {"tags": ["existing"], "metadata": {"foo": "bar"}},
            interrupt_id="intr-1",
            delivery_id="del-1",
        )
        assert config["tags"] == ["existing", "resume_of:intr-1"]
        assert config["metadata"]["foo"] == "bar"
        assert config["metadata"]["governance_delivery_id"] == "del-1"
