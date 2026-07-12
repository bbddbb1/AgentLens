import asyncio

from agentlens_maf.governance_bridge import MafDeliveryClaim, MafGovernanceBridge, MafNativeIdentity
from agentlens_maf.reference_runtime import create_reference_review_workflow


def _bridge() -> MafGovernanceBridge:
    return MafGovernanceBridge("http://example.invalid", "mission", "main", create_reference_review_workflow(), "agentlens-reference-review-request")


def test_bridge_keeps_opaque_control_and_only_sends_native_identity() -> None:
    bridge = _bridge()
    payload = MafNativeIdentity("workflow-1", "request-1", "executor-1").payload()
    assert bridge.control_ref not in str(payload)
    assert payload["workflow_id"] == "workflow-1"


def test_bridge_applies_supported_decision_once() -> None:
    async def exercise() -> tuple[str, str]:
        bridge = _bridge()
        await bridge.workflow.run("review")
        claim = MafDeliveryClaim(True, "delivery-1", "decision-1", "approve")
        return await bridge.apply_claim(claim), await bridge.apply_claim(claim)

    assert asyncio.run(exercise()) == ("accepted", "stale")


def test_bridge_reports_invalid_decision_without_native_application() -> None:
    bridge = _bridge()
    assert asyncio.run(bridge.apply_claim(MafDeliveryClaim(True, "delivery-2", decision_type="unsupported"))) == "failed"


def test_bridge_maps_structured_response_and_non_claims_to_stale() -> None:
    async def exercise() -> tuple[str, str]:
        bridge = _bridge()
        await bridge.workflow.run("review")
        structured = await bridge.apply_claim(MafDeliveryClaim(
            True, "delivery-structured", "decision", "structured_response", {"approved": False, "note": "alternative"},
        ))
        stale = await bridge.apply_claim(MafDeliveryClaim(False, None))
        return structured, stale

    assert asyncio.run(exercise()) == ("accepted", "stale")


def test_bridge_rejects_invalid_structured_value() -> None:
    bridge = _bridge()
    claim = MafDeliveryClaim(True, "delivery-invalid", "decision", "structured_response", "not-an-object")
    assert asyncio.run(bridge.apply_claim(claim)) == "failed"


def test_bridge_marks_uncertain_native_application_without_retrying() -> None:
    class UncertainWorkflow:
        async def run(self, **_: object) -> None:
            raise RuntimeError("connection lost after native submission")

    bridge = MafGovernanceBridge("http://example.invalid", "mission", "main", UncertainWorkflow(), "request")
    claim = MafDeliveryClaim(True, "delivery-uncertain", "decision", "approve")
    assert asyncio.run(bridge.apply_claim(claim)) == "unknown"
    assert asyncio.run(bridge.apply_claim(claim)) == "stale"
