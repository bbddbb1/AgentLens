"""
AgentLens SDK Client - main entry point for instrumentation.
"""

from __future__ import annotations

import time
import uuid
import os
import json
import logging
from typing import Any

import httpx

logger = logging.getLogger("agentlens")
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from agentlens_otel_semconv.frameworks import normalize_framework_name
from agentlens_sdk.exporter import AgentLensOtlpJsonExporter
from agentlens_sdk.mission import Mission


def _normalize_api_base_url(endpoint: str) -> str:
    normalized = endpoint.rstrip("/")
    for suffix in ("/v1/traces", "/api/v1/ingest/otlp"):
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
    return normalized


def _normalize_traces_endpoint(endpoint: str, traces_endpoint: str | None = None) -> str:
    candidate = (traces_endpoint or endpoint).rstrip("/")
    if candidate.endswith("/api/v1/ingest/otlp"):
        return f"{candidate[: -len('/api/v1/ingest/otlp')]}/v1/traces"
    if candidate.endswith("/v1/traces"):
        return candidate
    return f"{candidate}/v1/traces"


class AgentLens:
    """
    Main SDK client for instrumenting multi-agent systems.

    Initializes OpenTelemetry tracing and provides a high-level API
    for recording missions, agents, delegations, and events.
    """

    def __init__(
        self,
        endpoint: str = "http://localhost:8001",
        api_key: str | None = None,
        service_name: str = "agentlens-instrumented-app",
        framework: str = "custom",
        traces_endpoint: str | None = None,
    ):
        self.endpoint = _normalize_api_base_url(endpoint)
        self.api_key = api_key
        self.framework = normalize_framework_name(framework)
        self.traces_endpoint = _normalize_traces_endpoint(endpoint, traces_endpoint)

        resource = Resource.create({
            "service.name": service_name,
            "agentlens.framework": framework,
        })

        self._provider = TracerProvider(resource=resource)
        self._exporter = AgentLensOtlpJsonExporter(
            endpoint=self.traces_endpoint,
            api_key=api_key,
        )
        self._provider.add_span_processor(BatchSpanProcessor(self._exporter))
        trace.set_tracer_provider(self._provider)

        self._tracer = trace.get_tracer("agentlens-sdk", "0.1.0")
        self._http = httpx.Client(
            base_url=self.endpoint,
            headers=self._build_headers(api_key),
            timeout=30.0,
        )

        self._injections = []
        if os.environ.get("AGENTLENS_SANDBOX_MODE") == "1":
            ctx_path = "/agentlens/context/context.json"
            if os.path.exists(ctx_path):
                try:
                    with open(ctx_path, "r") as f:
                        ctx = json.load(f)
                        self._injections = ctx.get("injections", [])
                except Exception:
                    pass

    def _build_headers(self, api_key: str | None) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    def mission(
        self,
        objective: str,
        mission_id: str | None = None,
        **metadata: Any,
    ) -> Mission:
        """
        Start a new mission context.

        Use as a context manager:
            with lens.mission("My objective") as m:
                ...
        """
        mid = mission_id or str(uuid.uuid4())
        branch_id = os.environ.get("AGENTLENS_BRANCH_ID")
        return Mission(
            tracer=self._tracer,
            mission_id=mid,
            objective=objective,
            framework=self.framework,
            metadata=metadata,
            branch_id=branch_id,
            lens=self,
        )

    def flush(self) -> None:
        """Force all pending spans to be exported."""
        self._provider.force_flush()

    def list_interrupts(self, mission_id: str, status: str | None = None) -> list[dict[str, Any]]:
        """List interrupts for a mission."""
        params = {}
        if status:
            params["status"] = status
        
        branch_id = os.environ.get("AGENTLENS_BRANCH_ID")
        if branch_id:
            params["branch_id"] = branch_id

        response = self._http.get(f"/api/v1/missions/{mission_id}/interrupts", params=params)
        response.raise_for_status()
        data = response.json()
        interrupts = data.get("interrupts", [])
        return interrupts if isinstance(interrupts, list) else []

    def get_mission(self, mission_id: str) -> dict[str, Any]:
        """Fetch a single mission."""
        response = self._http.get(f"/api/v1/missions/{mission_id}")
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else {}

    def wait_for_mission(
        self,
        mission_id: str,
        *,
        poll_interval_seconds: float = 1.0,
        timeout_seconds: float = 30.0,
        retry_status_codes: tuple[int, ...] = (404, 502, 503, 504),
    ) -> dict[str, Any]:
        """Poll until a mission becomes readable from the backend."""
        deadline = time.time() + timeout_seconds
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                return self.get_mission(mission_id)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in retry_status_codes:
                    raise
                last_error = exc
            except httpx.HTTPError as exc:
                last_error = exc
            time.sleep(poll_interval_seconds)

        if last_error is not None:
            raise TimeoutError(
                "Timed out waiting for mission visibility in AgentLens: "
                f"mission_id={mission_id}, last_error={last_error}"
            ) from last_error

        raise TimeoutError(
            f"Timed out waiting for mission visibility in AgentLens: mission_id={mission_id}"
        )

    def wait_for_interrupt(
        self,
        mission_id: str,
        interrupt_id: str,
        *,
        poll_interval_seconds: float = 1.0,
        timeout_seconds: float = 30.0,
        retry_status_codes: tuple[int, ...] = (404, 502, 503, 504),
    ) -> dict[str, Any]:
        """Poll until a specific interrupt is visible from the backend."""
        deadline = time.time() + timeout_seconds
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                for interrupt in self.list_interrupts(mission_id):
                    if interrupt.get("interrupt_id") == interrupt_id:
                        return interrupt
                last_error = None
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in retry_status_codes:
                    raise
                last_error = exc
            except httpx.HTTPError as exc:
                last_error = exc
            time.sleep(poll_interval_seconds)

        if last_error is not None:
            raise TimeoutError(
                "Timed out waiting for interrupt visibility in AgentLens: "
                f"mission_id={mission_id}, interrupt_id={interrupt_id}, last_error={last_error}"
            ) from last_error

        raise TimeoutError(
            "Timed out waiting for interrupt visibility in AgentLens: "
            f"mission_id={mission_id}, interrupt_id={interrupt_id}"
        )

    def _get_injection(self, type: str, target: str | None = None) -> dict[str, Any] | None:
        """Find a matching injection in the active branch context."""
        for inj in getattr(self, "_injections", []):
            if inj.get("type") != type:
                continue
            if target is None:
                return inj
            inj_target = inj.get("target")
            if inj_target == target:
                return inj
            if inj_target and (target in str(inj_target) or str(inj_target) in target):
                return inj
        return None

    def wait_for_interrupt_decision(
        self,
        mission_id: str,
        interrupt_id: str,
        *,
        poll_interval_seconds: float = 2.0,
        timeout_seconds: float = 600.0,
        retry_status_codes: tuple[int, ...] = (404, 502, 503, 504),
    ) -> dict[str, Any]:
        """Poll the backend until an interrupt receives a non-pending decision."""
        if os.environ.get("AGENTLENS_SANDBOX_MODE") == "1":
            # 1. Check for injections (priority)
            injection = self._get_injection("human_decision", target=interrupt_id)
            if not injection:
                injection = self._get_injection("human_decision")
            if injection:
                logger.info(f"[AgentLens Sandbox] Injecting decision for interrupt {interrupt_id}: {injection['decision']}")
                return {
                    "interrupt_id": interrupt_id,
                    "status": "approved" if injection["decision"] in ("approve", "approved") else "rejected",
                    "decision": injection["decision"],
                    "decision_comment": injection.get("comment", "Automated mock decision"),
                    "decision_payload": injection.get("payload", {}),
                }

            # 2. Check for local decision bridge (file-based)
            output_dir = os.environ.get("AGENTLENS_SANDBOX_OUTPUT_DIR")
            if output_dir:
                decision_file = os.path.join(output_dir, "decisions.jsonl")
                # We'll poll this file in the loop below alongside the API
                logger.info(f"[AgentLens Sandbox] Waiting for manual decision on interrupt {interrupt_id} via {decision_file} or API...")

        deadline = time.time() + timeout_seconds
        last_error: Exception | None = None
        while time.time() < deadline:
            # Check local decision file if in sandbox mode
            if os.environ.get("AGENTLENS_SANDBOX_MODE") == "1":
                output_dir = os.environ.get("AGENTLENS_SANDBOX_OUTPUT_DIR")
                if output_dir:
                    decision_file = os.path.join(output_dir, "decisions.jsonl")
                    if os.path.exists(decision_file):
                        try:
                            with open(decision_file, "r") as f:
                                for line in f:
                                    if not line.strip():
                                        continue
                                    intr = json.loads(line)
                                    if str(intr.get("interrupt_id")) == str(interrupt_id):
                                        logger.info(f"[AgentLens Sandbox] Received manual decision via bridge: {intr.get('decision')}")
                                        return intr
                        except Exception as e:
                            logger.error(f"[AgentLens Sandbox] Error reading decision bridge: {e}")

            try:
                for interrupt in self.list_interrupts(mission_id):
                    if interrupt.get("interrupt_id") != interrupt_id:
                        continue
                    if interrupt.get("status") != "pending":
                        return interrupt
                last_error = None
            except httpx.HTTPError as exc:
                # In sandbox, ignore network errors and keep polling (might be using file bridge)
                last_error = exc
                if os.environ.get("AGENTLENS_SANDBOX_MODE") != "1":
                    # If not in sandbox, standard retry logic
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code not in retry_status_codes:
                        raise
            
            time.sleep(poll_interval_seconds)

        if last_error is not None:
            raise TimeoutError(
                "Timed out waiting for interrupt decision because the AgentLens backend "
                f"was unavailable or unstable: mission_id={mission_id}, "
                f"interrupt_id={interrupt_id}, last_error={last_error}"
            ) from last_error

        raise TimeoutError(
            f"Timed out waiting for interrupt decision: mission_id={mission_id}, "
            f"interrupt_id={interrupt_id}"
        )

    def decide_interrupt(
        self,
        mission_id: str,
        interrupt_id: str,
        decision: str,
        *,
        comment: str = "",
        payload: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Submit a human decision for an interrupt."""
        body = {
            "decision": decision,
            "comment": comment or None,
            "payload": payload or {},
            "idempotency_key": idempotency_key or str(uuid.uuid4()),
        }
        
        params = {}
        branch_id = os.environ.get("AGENTLENS_BRANCH_ID")
        if branch_id:
            params["branch_id"] = branch_id

        response = self._http.post(
            f"/api/v1/missions/{mission_id}/interrupts/{interrupt_id}/decision",
            json=body,
            params=params,
        )
        response.raise_for_status()
        return response.json()

    def resume_interrupt(
        self,
        resume_token: str,
        *,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Resume a pending interrupt by resume token."""
        response = self._http.post(
            "/api/v1/interrupts/resume",
            json={
                "resume_token": resume_token,
                "payload": payload or {},
            },
        )
        response.raise_for_status()
        return response.json()

    def register_branch_executor(
        self,
        mission_id: str,
        name: str,
        docker_image: str,
        python_entrypoint: str,
        timeout_seconds: int = 300,
        resource_limits: dict[str, Any] | None = None,
        env_allowlist: list[str] | None = None,
    ) -> dict[str, Any]:
        """Register a branch executor for this mission."""
        body = {
            "name": name,
            "docker_image": docker_image,
            "python_entrypoint": python_entrypoint,
            "timeout_seconds": timeout_seconds,
            "resource_limits": resource_limits or {},
            "env_allowlist": env_allowlist or [],
            "is_active": True,
        }
        response = self._http.post(
            f"/api/v1/missions/{mission_id}/branch-executors",
            json=body,
        )
        response.raise_for_status()
        return response.json()

    def shutdown(self):
        """Flush and shut down the tracer provider."""
        try:
            self._provider.shutdown()
        finally:
            self._http.close()
