"""
Tests for AgentLens client — endpoint normalization, header building, HTTP calls.
"""
import time
from unittest.mock import MagicMock, patch, ANY

import httpx
import pytest

from agentlens_sdk.client import (
    AgentLens,
    _normalize_api_base_url,
    _normalize_traces_endpoint,
)


class TestNormalizeApiBaseUrl:
    def test_strips_traces_suffix(self):
        assert _normalize_api_base_url("http://localhost:8001/v1/traces") == "http://localhost:8001"

    def test_strips_ingest_otlp_suffix(self):
        result = _normalize_api_base_url("http://localhost:8001/api/v1/ingest/otlp")
        assert result == "http://localhost:8001"

    def test_preserves_plain_url(self):
        assert _normalize_api_base_url("http://localhost:8001") == "http://localhost:8001"

    def test_strips_trailing_slash(self):
        assert _normalize_api_base_url("http://localhost:8001/") == "http://localhost:8001"


class TestNormalizeTracesEndpoint:
    def test_passes_through_traces(self):
        result = _normalize_traces_endpoint("http://localhost:8001", "http://localhost:8001/v1/traces")
        assert result == "http://localhost:8001/v1/traces"

    def test_upgrades_ingest_to_traces(self):
        result = _normalize_traces_endpoint(
            "http://localhost:8001",
            "http://localhost:8001/api/v1/ingest/otlp",
        )
        assert result == "http://localhost:8001/v1/traces"

    def test_appends_traces_to_plain(self):
        result = _normalize_traces_endpoint("http://localhost:8001", None)
        assert result == "http://localhost:8001/v1/traces"


class TestAgentLens:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.mock_client = MagicMock()
        self.mock_provider = MagicMock()
        # Patch httpx.Client and TracerProvider so no real connections or tracing happen
        self.httpx_patch = patch("agentlens_sdk.client.httpx.Client", return_value=self.mock_client)
        self.provider_patch = patch(
            "agentlens_sdk.client.TracerProvider", return_value=self.mock_provider
        )
        self.httpx_patch.start()
        self.provider_patch.start()
        yield
        self.httpx_patch.stop()
        self.provider_patch.stop()

    def _make_lens(self, **overrides):
        return AgentLens(
            endpoint=overrides.get("endpoint", "http://localhost:8001"),
            api_key=overrides.get("api_key", None),
            service_name=overrides.get("service_name", "test-app"),
        )

    def test_constructor_normalizes_endpoint(self):
        lens = AgentLens(endpoint="http://localhost:8001/v1/traces")
        assert lens.endpoint == "http://localhost:8001"

    def test_constructor_with_api_key_builds_headers(self):
        lens = self._make_lens(api_key="secret")
        assert "Bearer secret" in lens._build_headers("secret")["Authorization"]

    def test_constructor_without_api_key_omits_auth_header(self):
        lens = self._make_lens(api_key=None)
        assert "Authorization" not in lens._build_headers(None)

    def test_constructor_sets_default_framework_to_custom(self):
        lens = self._make_lens()
        assert lens.framework == "custom"

    def test_constructor_normalizes_framework(self):
        lens = AgentLens(
            endpoint="http://localhost:8001",
            framework="Lang Graph",
            service_name="test-app",
        )
        assert lens.framework == "langgraph"

    def test_mission_creates_mission_object(self):
        lens = self._make_lens()
        mission = lens.mission("Research")
        assert mission.objective == "Research"
        assert mission.framework == "custom"

    def test_mission_with_custom_id(self):
        lens = self._make_lens()
        mission = lens.mission("Research", mission_id="my-id")
        assert mission.mission_id == "my-id"

    def test_mission_auto_generates_id(self):
        lens = self._make_lens()
        mission = lens.mission("Research")
        assert mission.mission_id is not None
        assert len(mission.mission_id) > 0

    def test_flush_calls_provider_force_flush(self):
        lens = self._make_lens()
        lens.flush()
        self.mock_provider.force_flush.assert_called_once()

    def test_shutdown_closes_http_client(self):
        lens = self._make_lens()
        lens.shutdown()
        self.mock_client.close.assert_called_once()

    def test_shutdown_shuts_down_provider(self):
        lens = self._make_lens()
        lens.shutdown()
        self.mock_provider.shutdown.assert_called_once()

    # --- list_interrupts ---

    def test_list_interrupts_returns_list(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"interrupts": [{"id": "int-1"}]}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        result = lens.list_interrupts("m1")
        assert result == [{"id": "int-1"}]

    def test_list_interrupts_with_status_filter(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"interrupts": []}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        lens.list_interrupts("m1", status="pending")
        self.mock_client.get.assert_called_with(
            "/api/v1/missions/m1/interrupts", params={"status": "pending"}
        )

    def test_list_interrupts_non_list_fallback(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"interrupts": None}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        result = lens.list_interrupts("m1")
        assert result == []

    # --- get_mission ---

    def test_get_mission_returns_dict(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": "m1", "objective": "Test"}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        result = lens.get_mission("m1")
        assert result == {"id": "m1", "objective": "Test"}

    def test_get_mission_non_dict_fallback(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = ["not", "a", "dict"]
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        result = lens.get_mission("m1")
        assert result == {}

    # --- wait_for_mission ---

    def test_wait_for_mission_returns_immediately(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": "m1"}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        result = lens.wait_for_mission("m1", timeout_seconds=0.1)
        assert result == {"id": "m1"}

    def test_wait_for_mission_retries_on_404(self):
        lens = self._make_lens()
        not_found = httpx.HTTPStatusError(
            "not found", request=MagicMock(), response=MagicMock(status_code=404)
        )
        ok_resp = MagicMock()
        ok_resp.json.return_value = {"id": "m1"}
        ok_resp.raise_for_status = MagicMock()
        self.mock_client.get.side_effect = [not_found, not_found, ok_resp]

        result = lens.wait_for_mission("m1", poll_interval_seconds=0.01, timeout_seconds=5)
        assert result == {"id": "m1"}
        assert self.mock_client.get.call_count >= 3

    def test_wait_for_mission_raises_on_non_retry_status(self):
        lens = self._make_lens()
        bad_req = httpx.HTTPStatusError(
            "bad request", request=MagicMock(), response=MagicMock(status_code=400)
        )
        self.mock_client.get.side_effect = bad_req

        with pytest.raises(httpx.HTTPStatusError):
            lens.wait_for_mission("m1", poll_interval_seconds=0.01, timeout_seconds=0.1)

    def test_wait_for_mission_timeout(self):
        lens = self._make_lens()
        not_found = httpx.HTTPStatusError(
            "not found", request=MagicMock(), response=MagicMock(status_code=404)
        )
        self.mock_client.get.side_effect = not_found

        with pytest.raises(TimeoutError, match="Timed out"):
            lens.wait_for_mission("m1", poll_interval_seconds=0.01, timeout_seconds=0.05)

    # --- wait_for_interrupt ---

    def test_wait_for_interrupt_returns_when_found(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"interrupts": [{"interrupt_id": "int-42", "status": "pending"}]}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = mock_resp

        result = lens.wait_for_interrupt("m1", "int-42", timeout_seconds=0.1)
        assert result == {"interrupt_id": "int-42", "status": "pending"}

    # --- wait_for_interrupt_decision ---

    def test_wait_for_interrupt_decision_returns_on_non_pending(self):
        lens = self._make_lens()
        pending_resp = MagicMock()
        pending_resp.json.return_value = {"interrupts": [{"interrupt_id": "int-1", "status": "pending"}]}
        pending_resp.raise_for_status = MagicMock()
        decided_resp = MagicMock()
        decided_resp.json.return_value = {"interrupts": [{"interrupt_id": "int-1", "status": "approved"}]}
        decided_resp.raise_for_status = MagicMock()
        self.mock_client.get.side_effect = [pending_resp, decided_resp]

        result = lens.wait_for_interrupt_decision(
            "m1", "int-1", poll_interval_seconds=0.01, timeout_seconds=5
        )
        assert result == {"interrupt_id": "int-1", "status": "approved"}

    def test_wait_for_interrupt_decision_timeout(self):
        lens = self._make_lens()
        pending_resp = MagicMock()
        pending_resp.json.return_value = {"interrupts": [{"interrupt_id": "int-1", "status": "pending"}]}
        pending_resp.raise_for_status = MagicMock()
        self.mock_client.get.return_value = pending_resp

        with pytest.raises(TimeoutError):
            lens.wait_for_interrupt_decision(
                "m1", "int-1", poll_interval_seconds=0.01, timeout_seconds=0.05
            )

    # --- decide_interrupt ---

    def test_decide_interrupt(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"status": "approved"}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.post.return_value = mock_resp

        result = lens.decide_interrupt("m1", "int-1", "approve")
        assert result == {"status": "approved"}
        call_args = self.mock_client.post.call_args
        assert call_args[0][0] == "/api/v1/missions/m1/interrupts/int-1/decision"

    # --- resume_interrupt ---

    def test_resume_interrupt(self):
        lens = self._make_lens()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"status": "resumed"}
        mock_resp.raise_for_status = MagicMock()
        self.mock_client.post.return_value = mock_resp

        result = lens.resume_interrupt("resume-token-abc")
        assert result == {"status": "resumed"}
        self.mock_client.post.assert_called_with(
            "/api/v1/interrupts/resume",
            json={"resume_token": "resume-token-abc", "payload": {}},
        )
