"""Private MAF governance bridge; Core never receives live workflow state."""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from .enrichment import emit_enrichment, terminal_attributes
from .reference_runtime import ReferenceReviewResponse

DeliveryReceipt = Literal["accepted", "failed", "stale", "unknown"]


def generate_control_ref() -> str:
    return secrets.token_urlsafe(32)


@dataclass(frozen=True)
class MafNativeIdentity:
    workflow_id: str
    request_id: str
    executor_id: str | None = None
    request_type: str = "ReferenceReviewRequest"
    response_type: str = "ReferenceReviewResponse"

    def payload(self) -> dict[str, str]:
        payload = {"framework": "ms_agent_framework", "workflow_id": self.workflow_id,
                   "request_id": self.request_id, "request_type": self.request_type,
                   "response_type": self.response_type}
        if self.executor_id:
            payload["executor_id"] = self.executor_id
        return payload


@dataclass(frozen=True)
class MafDeliveryClaim:
    claimed: bool
    delivery_id: str | None = None
    decision_id: str | None = None
    decision_type: str | None = None
    value: Any = None


class MafGovernanceClient:
    def __init__(self, api_base_url: str, mission_id: str, branch_id: str, control_ref: str, client: httpx.Client | None = None):
        self.base_url = api_base_url.rstrip("/")
        self.mission_id, self.branch_id, self.control_ref = mission_id, branch_id, control_ref
        self._client = client or httpx.Client(base_url=self.base_url, timeout=30)

    def _request(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._client.post(
            f"/api/v1/missions/{self.mission_id}/branches/{self.branch_id}/maf/bridge/{action}",
            json={"control_ref": self.control_ref, **payload},
        )
        if response.status_code >= 400:
            raise RuntimeError(f"MAF bridge {action} failed: {response.status_code}")
        return response.json()

    def register(self, identity: MafNativeIdentity, lease_seconds: int = 60) -> dict[str, Any]:
        return self._request("register", {"lease_seconds": lease_seconds, "interaction_request_id": identity.request_id, "native_identity": identity.payload()})

    def renew(self, lease_seconds: int = 60) -> dict[str, Any]:
        return self._request("renew", {"lease_seconds": lease_seconds})

    def claim(self, request_id: str, claim_seconds: int = 60) -> MafDeliveryClaim:
        data = self._request("claim", {"interrupt_id": request_id, "claim_seconds": claim_seconds})
        return MafDeliveryClaim(bool(data.get("claimed")), data.get("delivery_id"), data.get("decision_id"), data.get("decision_type"), data.get("value"))

    def receipt(self, request_id: str, delivery_id: str, receipt: DeliveryReceipt, safe_error_class: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"interrupt_id": request_id, "delivery_id": delivery_id, "receipt": receipt}
        if safe_error_class:
            body["safe_error_class"] = safe_error_class
        return self._request("receipt", body)


@dataclass
class MafGovernanceBridge:
    api_base_url: str
    mission_id: str
    branch_id: str
    workflow: Any
    pending_request_id: str
    expected_response_type: type = ReferenceReviewResponse
    http_client: httpx.Client | None = None
    _control_ref: str = field(default_factory=generate_control_ref, init=False, repr=False)
    _applied_delivery_ids: set[str] = field(default_factory=set, init=False, repr=False)

    @property
    def control_ref(self) -> str:
        return self._control_ref

    def client(self) -> MafGovernanceClient:
        return MafGovernanceClient(self.api_base_url, self.mission_id, self.branch_id, self._control_ref, self.http_client)

    async def apply_claim(self, claim: MafDeliveryClaim) -> DeliveryReceipt:
        """Apply only one locally-held, pending native request; uncertainty is not retried."""
        if not claim.claimed or not claim.delivery_id:
            return "stale"
        if claim.delivery_id in self._applied_delivery_ids:
            return "stale"
        if claim.decision_type not in {"approve", "reject", "structured_response"}:
            return "failed"
        try:
            if claim.decision_type == "structured_response":
                if not isinstance(claim.value, dict):
                    return "failed"
                response = self.expected_response_type(**claim.value)
            else:
                response = self.expected_response_type(approved=claim.decision_type == "approve")
            await self.workflow.run(responses={self.pending_request_id: response})
        except (TypeError, ValueError):
            return "failed"
        except Exception:
            # Do not automatically reissue after uncertain native application.
            self._applied_delivery_ids.add(claim.delivery_id)
            return "unknown"
        self._applied_delivery_ids.add(claim.delivery_id)
        emit_enrichment("agentlens.maf.delivery_accepted", terminal_attributes(self.pending_request_id, response))
        return "accepted"
