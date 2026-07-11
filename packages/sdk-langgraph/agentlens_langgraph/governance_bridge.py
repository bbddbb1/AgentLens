"""
LangGraph-specific governance bridge for AgentLens private delivery endpoints.

The bridge owns an opaque control reference and local execution context
(compiled graph, invocation config, checkpointer). AgentLens stores only a
one-way hash of the control reference and never receives checkpoint payloads
or application secrets.
"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, TypedDict

import httpx
from langgraph.types import Command

from agentlens_langgraph.native_attrs import LangGraphNativeAttributes

logger = logging.getLogger("agentlens.langgraph.bridge")

DeliveryReceipt = Literal["accepted", "failed", "stale", "unknown"]
SupportedDecisionType = Literal["approve", "reject", "structured_response"]

DEFAULT_LEASE_SECONDS = 60
DEFAULT_CLAIM_SECONDS = 60
CONTROL_REF_BYTES = 32


class BridgeDecisionMappingError(ValueError):
    """Raised when a decision type cannot be mapped to a LangGraph command."""


class BridgeHttpError(RuntimeError):
    """Raised when a private bridge HTTP call fails."""


def generate_control_ref() -> str:
    """Create an opaque random control reference for private bridge authentication."""
    return secrets.token_urlsafe(CONTROL_REF_BYTES)


def _normalize_api_base_url(endpoint: str) -> str:
    normalized = endpoint.rstrip("/")
    for suffix in ("/v1/traces", "/api/v1/ingest/otlp"):
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
    return normalized


def build_service_auth_headers() -> dict[str, str]:
    """Resolve Authorization from AGENTLENS_SERVICE_TOKEN / AGENTLENS_API_KEY or env."""
    headers = {"Content-Type": "application/json"}
    raw_auth = os.environ.get("Authorization") or os.environ.get("AUTHORIZATION")
    if raw_auth:
        headers["Authorization"] = raw_auth if raw_auth.lower().startswith("bearer ") else f"Bearer {raw_auth}"
        return headers
    token = (os.environ.get("AGENTLENS_SERVICE_TOKEN") or os.environ.get("AGENTLENS_API_KEY") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def correlation_invoke_config(
    base_config: dict[str, Any] | None,
    *,
    interrupt_id: str,
    delivery_id: str,
    decision_id: str | None = None,
    decision_type: str | None = None,
) -> dict[str, Any]:
    """
    Build an invoke config that carries observational resume/delivery correlation.

    The instrumentor reads ``resume_of:*`` tags and ``resume_of_interrupt_id``
    metadata to emit ``agent.interrupt.resumed``. Control references, checkpoint
    payloads, and secrets are intentionally excluded.
    """
    config = dict(base_config or {})
    metadata = dict(config.get("metadata") or {})
    metadata["resume_of_interrupt_id"] = interrupt_id
    metadata["governance_delivery_id"] = delivery_id
    if decision_id:
        metadata["governance_decision_id"] = decision_id
    if decision_type:
        metadata["governance_decision_type"] = decision_type
    config["metadata"] = metadata

    tags = list(config.get("tags") or [])
    resume_tag = f"resume_of:{interrupt_id}"
    if resume_tag not in tags:
        tags.append(resume_tag)
    config["tags"] = tags
    return config


def map_decision_to_command(
    decision_type: str,
    value: Any = None,
    *,
    approve_resume: Any = True,
    reject_resume: Any = False,
) -> Command:
    """
    Map a supported governance decision to LangGraph ``Command(resume=...)``.

    Reference-scenario defaults:
    - approve -> ``Command(resume=True)`` (override via ``approve_resume``)
    - reject -> ``Command(resume=False)`` (override via ``reject_resume``)
    - structured_response -> ``Command(resume=value)``
    """
    if decision_type == "approve":
        return Command(resume=approve_resume)
    if decision_type == "reject":
        return Command(resume=reject_resume)
    if decision_type == "structured_response":
        return Command(resume=value)
    raise BridgeDecisionMappingError(f"Unsupported decision type: {decision_type}")


class NativeIdentityPayload(TypedDict, total=False):
    framework: str
    thread_id: str
    run_id: str
    parent_run_id: str
    interaction_request_id: str
    interrupt_request_id: str
    checkpoint_id: str
    checkpoint_ns: str
    activity_correlation_id: str


@dataclass
class NativeIdentity:
    """Observational native identity fields sent during bridge registration."""

    thread_id: str | None = None
    run_id: str | None = None
    parent_run_id: str | None = None
    interaction_request_id: str | None = None
    interrupt_request_id: str | None = None
    checkpoint_id: str | None = None
    checkpoint_ns: str | None = None
    activity_correlation_id: str | None = None

    def to_payload(self) -> NativeIdentityPayload:
        payload: NativeIdentityPayload = {"framework": LangGraphNativeAttributes.FRAMEWORK}
        for key in (
            "thread_id",
            "run_id",
            "parent_run_id",
            "interaction_request_id",
            "interrupt_request_id",
            "checkpoint_id",
            "checkpoint_ns",
            "activity_correlation_id",
        ):
            value = getattr(self, key)
            if value:
                payload[key] = value  # type: ignore[literal-required]
        return payload


@dataclass
class BridgeRegistration:
    binding_id: str
    generation: int
    lifecycle_state: str
    lease_expires_at: str


@dataclass
class BridgeClaim:
    claimed: bool
    delivery_id: str | None
    delivery_state: str
    interaction_request_id: str | None
    decision_id: str | None
    decision_type: str | None
    value: Any = None


@dataclass
class BridgeReceipt:
    delivery_id: str
    delivery_state: DeliveryReceipt


class GovernanceBridgeClient:
    """Minimal HTTP client for AgentLens LangGraph private bridge endpoints."""

    def __init__(
        self,
        *,
        api_base_url: str,
        mission_id: str,
        branch_id: str,
        control_ref: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.api_base_url = _normalize_api_base_url(api_base_url)
        self.mission_id = mission_id
        self.branch_id = branch_id
        self.control_ref = control_ref
        self._owns_client = http_client is None
        self._http = http_client or httpx.Client(
            base_url=self.api_base_url,
            headers=build_service_auth_headers(),
            timeout=30.0,
        )

    def close(self) -> None:
        if self._owns_client:
            self._http.close()

    def _path(self, action: str) -> str:
        return (
            f"/api/v1/missions/{self.mission_id}/branches/{self.branch_id}"
            f"/langgraph/bridge/{action}"
        )

    def _request(self, method: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._http.request(method, self._path(action), json=payload)
        if response.status_code >= 400:
            detail = response.text
            try:
                body = response.json()
                detail = str(body.get("detail", detail))
            except Exception:
                pass
            raise BridgeHttpError(f"{action} failed ({response.status_code}): {detail}")
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()

    def register(
        self,
        *,
        native_identity: NativeIdentity,
        interrupt_id: str | None = None,
        interaction_request_id: str | None = None,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> BridgeRegistration:
        body = {
            "control_ref": self.control_ref,
            "lease_seconds": lease_seconds,
            "native_identity": native_identity.to_payload(),
        }
        if interrupt_id:
            body["interrupt_id"] = interrupt_id
        if interaction_request_id:
            body["interaction_request_id"] = interaction_request_id
        data = self._request("POST", "register", body)
        return BridgeRegistration(
            binding_id=str(data["binding_id"]),
            generation=int(data["generation"]),
            lifecycle_state=str(data["lifecycle_state"]),
            lease_expires_at=str(data["lease_expires_at"]),
        )

    def renew(self, *, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> BridgeRegistration:
        data = self._request(
            "POST",
            "renew",
            {"control_ref": self.control_ref, "lease_seconds": lease_seconds},
        )
        return BridgeRegistration(
            binding_id=str(data["binding_id"]),
            generation=int(data["generation"]),
            lifecycle_state=str(data["lifecycle_state"]),
            lease_expires_at=str(data["lease_expires_at"]),
        )

    def claim(
        self,
        *,
        interrupt_id: str,
        claim_seconds: int = DEFAULT_CLAIM_SECONDS,
    ) -> BridgeClaim:
        data = self._request(
            "POST",
            "claim",
            {
                "control_ref": self.control_ref,
                "interrupt_id": interrupt_id,
                "claim_seconds": claim_seconds,
            },
        )
        return BridgeClaim(
            claimed=bool(data.get("claimed")),
            delivery_id=data.get("delivery_id"),
            delivery_state=str(data.get("delivery_state", "pending")),
            interaction_request_id=data.get("interaction_request_id"),
            decision_id=data.get("decision_id"),
            decision_type=data.get("decision_type"),
            value=data.get("value"),
        )

    def receipt(
        self,
        *,
        interrupt_id: str,
        delivery_id: str,
        receipt: DeliveryReceipt,
        safe_error_class: str | None = None,
        receipt_correlation: str | None = None,
    ) -> BridgeReceipt:
        body: dict[str, Any] = {
            "control_ref": self.control_ref,
            "interrupt_id": interrupt_id,
            "delivery_id": delivery_id,
            "receipt": receipt,
        }
        if safe_error_class:
            body["safe_error_class"] = safe_error_class
        if receipt_correlation:
            body["receipt_correlation"] = receipt_correlation
        data = self._request("POST", "receipt", body)
        return BridgeReceipt(
            delivery_id=str(data.get("delivery_id", delivery_id)),
            delivery_state=data.get("delivery_state", receipt),  # type: ignore[arg-type]
        )


@dataclass
class LangGraphGovernanceBridge:
    """
    Thin LangGraph governance bridge that keeps execution context local.

    On each ``register`` call (including after process restart) a new opaque
    control reference is generated and supersedes any prior binding.
    """

    api_base_url: str
    mission_id: str
    branch_id: str
    compiled_graph: Any
    invocation_config: dict[str, Any] | None = None
    checkpointer: Any = None
    lease_seconds: int = DEFAULT_LEASE_SECONDS
    claim_seconds: int = DEFAULT_CLAIM_SECONDS
    decision_mapper: Callable[[str, Any], Command] | None = None
    http_client: httpx.Client | None = None
    _control_ref: str | None = field(default=None, init=False, repr=False)
    _client: GovernanceBridgeClient | None = field(default=None, init=False, repr=False)
    _registration: BridgeRegistration | None = field(default=None, init=False)
    _applied_delivery_ids: set[str] = field(default_factory=set, init=False, repr=False)

    def __post_init__(self) -> None:
        self.invocation_config = dict(self.invocation_config or {})

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    @property
    def control_ref(self) -> str | None:
        """Private control reference; never emit to OTLP or public surfaces."""
        return self._control_ref

    @property
    def registration(self) -> BridgeRegistration | None:
        return self._registration

    def _ensure_client(self) -> GovernanceBridgeClient:
        if self._client is None or self._control_ref is None:
            raise RuntimeError("Bridge is not registered; call register() first")
        return self._client

    def _map_decision(self, decision_type: str, value: Any) -> Command:
        if self.decision_mapper is not None:
            return self.decision_mapper(decision_type, value)
        return map_decision_to_command(decision_type, value)

    def register(
        self,
        *,
        native_identity: NativeIdentity,
        interrupt_id: str | None = None,
        interaction_request_id: str | None = None,
        lease_seconds: int | None = None,
    ) -> BridgeRegistration:
        """Register (or re-register) with a fresh opaque control reference."""
        if self._client is not None:
            self._client.close()

        self._control_ref = generate_control_ref()
        self._client = GovernanceBridgeClient(
            api_base_url=self.api_base_url,
            mission_id=self.mission_id,
            branch_id=self.branch_id,
            control_ref=self._control_ref,
            http_client=self.http_client,
        )
        self._registration = self._client.register(
            native_identity=native_identity,
            interrupt_id=interrupt_id,
            interaction_request_id=interaction_request_id,
            lease_seconds=lease_seconds or self.lease_seconds,
        )
        return self._registration

    def renew(self, *, lease_seconds: int | None = None) -> BridgeRegistration:
        client = self._ensure_client()
        self._registration = client.renew(lease_seconds=lease_seconds or self.lease_seconds)
        return self._registration

    def claim_pending(self, *, interrupt_id: str) -> BridgeClaim:
        return self._ensure_client().claim(
            interrupt_id=interrupt_id,
            claim_seconds=self.claim_seconds,
        )

    def post_receipt(
        self,
        *,
        interrupt_id: str,
        delivery_id: str,
        receipt: DeliveryReceipt,
        safe_error_class: str | None = None,
        receipt_correlation: str | None = None,
    ) -> BridgeReceipt:
        return self._ensure_client().receipt(
            interrupt_id=interrupt_id,
            delivery_id=delivery_id,
            receipt=receipt,
            safe_error_class=safe_error_class,
            receipt_correlation=receipt_correlation,
        )

    def apply_claimed_delivery(self, claim: BridgeClaim, *, interrupt_id: str) -> BridgeReceipt | None:
        """
        Apply a claimed delivery at most once and post an idempotent receipt.

        Claim reservation alone does not mutate LangGraph state. Native mutation
        happens here via ``Command(resume=...)`` against the locally held graph.
        """
        if not claim.claimed or not claim.delivery_id or not claim.decision_id:
            return None
        if claim.delivery_id in self._applied_delivery_ids:
            logger.info("Skipping already-applied delivery %s", claim.delivery_id)
            return None
        if not claim.decision_type:
            self.post_receipt(
                interrupt_id=interrupt_id,
                delivery_id=claim.delivery_id,
                receipt="failed",
                safe_error_class="missing_decision_type",
            )
            self._applied_delivery_ids.add(claim.delivery_id)
            return None

        try:
            command = self._map_decision(claim.decision_type, claim.value)
        except BridgeDecisionMappingError:
            self.post_receipt(
                interrupt_id=interrupt_id,
                delivery_id=claim.delivery_id,
                receipt="failed",
                safe_error_class="unsupported_decision_mapping",
            )
            self._applied_delivery_ids.add(claim.delivery_id)
            return None

        # Inject observational resume/delivery correlation for adapter telemetry.
        # Never include control_ref, checkpoint payloads, or secrets.
        invoke_config = correlation_invoke_config(
            self.invocation_config,
            interrupt_id=interrupt_id,
            delivery_id=claim.delivery_id,
            decision_id=claim.decision_id,
            decision_type=claim.decision_type,
        )

        try:
            self.compiled_graph.invoke(command, config=invoke_config)
        except Exception as exc:
            logger.exception("LangGraph resume failed for delivery %s", claim.delivery_id)
            receipt = self.post_receipt(
                interrupt_id=interrupt_id,
                delivery_id=claim.delivery_id,
                receipt="failed",
                safe_error_class=exc.__class__.__name__,
            )
            self._applied_delivery_ids.add(claim.delivery_id)
            return receipt

        receipt = self.post_receipt(
            interrupt_id=interrupt_id,
            delivery_id=claim.delivery_id,
            receipt="accepted",
            receipt_correlation=claim.decision_id,
        )
        self._applied_delivery_ids.add(claim.delivery_id)
        return receipt

    def poll_and_apply(self, *, interrupt_id: str) -> BridgeReceipt | None:
        """Claim a pending delivery (if any) and apply it locally."""
        claim = self.claim_pending(interrupt_id=interrupt_id)
        return self.apply_claimed_delivery(claim, interrupt_id=interrupt_id)
