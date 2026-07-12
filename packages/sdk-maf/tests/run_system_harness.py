"""Executable real-stack MAF conformance harness.

Requires a running AgentLens API (which owns real PostgreSQL) and a service
token. The model client is the only deliberate double; MAF, OTLP HTTP, API,
bridge HTTP, and persistence are real.

Run:
  AGENTLENS_API_URL=http://localhost:8002 AGENTLENS_SERVICE_TOKEN=... \
  uv run --package agentlens-sdk-maf python packages/sdk-maf/tests/run_system_harness.py
"""
from __future__ import annotations

import asyncio
import argparse
import json
import os
import uuid

import httpx
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult, SpanExporter

from agentlens_maf.governance_bridge import MafGovernanceBridge, MafGovernanceClient, MafNativeIdentity
from agentlens_maf.reference_runtime import ReferenceReviewResponse, create_reference_review_workflow
from agentlens_maf.version import assert_maf_core_version


def _otlp_value(value: object) -> dict[str, object]:
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [_otlp_value(item) for item in value]}}
    return {"stringValue": str(value)}


def _otlp_attributes(attributes: object) -> list[dict[str, object]]:
    return [
        {"key": str(key), "value": _otlp_value(value)}
        for key, value in dict(attributes or {}).items()
    ]


class OtlpJsonHttpSpanExporter(SpanExporter):
    """A concrete OTLP/HTTP JSON exporter for AgentLens's OTLP JSON endpoint.

    The OpenTelemetry Python package's built-in HTTP exporter emits protobuf;
    AgentLens deliberately exposes the OTLP JSON variant at `/v1/traces`.
    This exporter receives real SDK spans and transmits the standardized OTLP
    JSON shape over HTTP. It is transport code, not a harness double.
    """

    def __init__(self, endpoint: str, headers: dict[str, str]) -> None:
        self._endpoint = endpoint
        self._headers = headers

    def export(self, spans) -> SpanExportResult:  # type: ignore[no-untyped-def]
        resource_spans: list[dict[str, object]] = []
        for span in spans:
            event_items = [
                {
                    "name": event.name,
                    "timeUnixNano": str(event.timestamp),
                    "attributes": _otlp_attributes(event.attributes),
                }
                for event in span.events
            ]
            resource_spans.append(
                {
                    "resource": {"attributes": _otlp_attributes(span.resource.attributes)},
                    "scopeSpans": [{"spans": [{
                        "traceId": trace.format_trace_id(span.context.trace_id),
                        "spanId": trace.format_span_id(span.context.span_id),
                        "parentSpanId": trace.format_span_id(span.parent.span_id) if span.parent else "",
                        "name": span.name,
                        "startTimeUnixNano": str(span.start_time),
                        "endTimeUnixNano": str(span.end_time),
                        "status": {"code": span.status.status_code.value},
                        "attributes": _otlp_attributes(span.attributes),
                        "events": event_items,
                    }]}],
                }
            )
        response = httpx.post(
            self._endpoint,
            headers={**self._headers, "Content-Type": "application/json"},
            json={"resourceSpans": resource_spans},
            timeout=30,
        )
        response.raise_for_status()
        return SpanExportResult.SUCCESS


    def shutdown(self) -> None:
        return None


def _public_interrupt(public: dict[str, object]) -> dict[str, object]:
    interrupts = public.get("interrupts")
    if not isinstance(interrupts, list) or len(interrupts) != 1 or not isinstance(interrupts[0], dict):
        raise AssertionError(f"expected exactly one public interrupt, got {public!r}")
    return interrupts[0]


def _assert_public_safety(interrupt: dict[str, object]) -> None:
    serialized = json.dumps(interrupt, sort_keys=True)
    for private_marker in ("workflow.definition", "workflow.id", "executor.id", "control_ref"):
        if private_marker in serialized:
            raise AssertionError(f"public MAF output leaked {private_marker}")
    if interrupt.get("framework") != "ms_agent_framework":
        raise AssertionError(f"unexpected public framework: {interrupt!r}")
    if interrupt.get("governance_available") is not True:
        raise AssertionError(f"MAF governance availability was not derived from the actual framework: {interrupt!r}")


def _assert_public_views(views: dict[str, object]) -> None:
    serialized = json.dumps(views, sort_keys=True)
    for private_marker in ("workflow.definition", "workflow.id", "executor.id", "control_ref", "checkpoint", "queue"):
        if private_marker in serialized:
            raise AssertionError(f"public API view leaked {private_marker}")


async def _run_two_requests(
    http: httpx.Client,
    api_url: str,
    mission_id: str,
    provider: TracerProvider,
) -> dict[str, object]:
    observed: list[tuple[MafGovernanceBridge, object]] = []
    for request_id in ("agentlens-reference-review-request-a", "agentlens-reference-review-request-b"):
        workflow = create_reference_review_workflow(request_id)
        pending = await workflow.run(f"system-harness-{request_id}")
        request = pending.get_request_info_events()[0]
        bridge = MafGovernanceBridge(api_url, mission_id, "main", workflow, request.request_id)
        bridge.client().register(MafNativeIdentity(workflow.id, request.request_id, request.source_executor_id))
        observed.append((bridge, request))
    provider.force_flush()
    public = http.get(f"/api/v1/missions/{mission_id}/interrupts?branch_id=main").raise_for_status().json()
    interrupts = public.get("interrupts")
    if not isinstance(interrupts, list) or {item.get("interrupt_id") for item in interrupts} != {
        request.request_id for _, request in observed
    }:
        raise AssertionError(f"two live requests were not persisted independently: {public!r}")
    if any(item.get("actionability") != "actionable" for item in interrupts):
        raise AssertionError(f"unrelated bindings caused an actionability conflict: {public!r}")
    _assert_public_views({"interactions": public})
    return {
        "scenario": "two_requests",
        "mission_id": mission_id,
        "actionability": [item.get("actionability") for item in interrupts],
        "maf_version": assert_maf_core_version(),
    }


async def run(scenario: str) -> dict[str, object]:
    api_url = os.environ.get("AGENTLENS_API_URL", "http://localhost:8002").rstrip("/")
    token = os.environ["AGENTLENS_SERVICE_TOKEN"]
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(base_url=api_url, headers=headers, timeout=30) as http:
        mission = http.post("/api/v1/missions", json={"objective": "real MAF system harness"}).raise_for_status().json()
        mission_id = mission["id"]
        provider = TracerProvider(resource=Resource.create({
            "gen_ai.workflow.id": mission_id,
            "gen_ai.workflow.branch_id": "main",
            "gen_ai.workflow.name": "real MAF system harness",
        }))
        provider.add_span_processor(
            SimpleSpanProcessor(
                OtlpJsonHttpSpanExporter(
                    endpoint=f"{api_url}/v1/traces",
                    headers={"Authorization": f"Bearer {token}"},
                )
            )
        )
        trace.set_tracer_provider(provider)
        if scenario == "two_requests":
            return await _run_two_requests(http, api_url, mission_id, provider)
        workflow = create_reference_review_workflow()
        pending = await workflow.run("system-harness")
        request = pending.get_request_info_events()[0]
        bridge = MafGovernanceBridge(api_url, mission_id, "main", workflow, request.request_id)
        identity = MafNativeIdentity(workflow.id, request.request_id, request.source_executor_id)
        bridge.client().register(identity, lease_seconds=5 if scenario == "binding_expiry_no_transfer" else 60)
        decision_body: dict[str, object] = {"decision": "approve", "idempotency_key": str(uuid.uuid4())}
        if scenario == "post_acceptance_failure":
            decision_body = {
                "decision": "revise",
                "payload": {"approved": True, "post_acceptance_failure": True},
                "idempotency_key": str(uuid.uuid4()),
            }
        decision = http.post(
            f"/api/v1/missions/{mission_id}/interrupts/{request.request_id}/decision?branch_id=main",
            json=decision_body,
        ).raise_for_status().json()
        if scenario == "binding_expiry_no_transfer":
            successor = MafGovernanceBridge(api_url, mission_id, "main", workflow, request.request_id)
            successor.client().register(identity)
            await asyncio.sleep(6)
            rejected = http.post(
                f"/api/v1/missions/{mission_id}/branches/main/maf/bridge/claim",
                json={"control_ref": successor.control_ref, "interrupt_id": request.request_id},
            )
            if rejected.status_code != 409:
                raise AssertionError(f"expired authorized binding transferred claim authority: {rejected.status_code} {rejected.text}")
            public = http.get(f"/api/v1/missions/{mission_id}/interrupts?branch_id=main").raise_for_status().json()
            interrupt = _public_interrupt(public)
            if interrupt.get("delivery_state") != "pending" or interrupt.get("runtime_outcome") != "awaiting_interaction":
                raise AssertionError(f"expired binding changed the durable delivery: {interrupt!r}")
            return {
                "scenario": scenario,
                "mission_id": mission_id,
                "claim_status": rejected.status_code,
                "delivery_state": interrupt["delivery_state"],
                "maf_version": assert_maf_core_version(),
            }
        if scenario == "nonmatching_binding":
            nonmatching = MafGovernanceBridge(api_url, mission_id, "main", workflow, request.request_id)
            # This second authenticated binding has the same framework,
            # mission, branch, and native identity. It still must not claim a
            # decision reconciled to the first authenticated binding.
            nonmatching.client().register(identity)
            rejected = http.post(
                f"/api/v1/missions/{mission_id}/branches/main/maf/bridge/claim",
                json={"control_ref": nonmatching.control_ref, "interrupt_id": request.request_id},
            )
            if rejected.status_code != 409 or rejected.json().get("reason") != "authenticated_binding_does_not_match_request":
                raise AssertionError(f"non-matching authenticated binding claimed a delivery: {rejected.status_code} {rejected.text}")
            provider.force_flush()
            public = http.get(f"/api/v1/missions/{mission_id}/interrupts?branch_id=main").raise_for_status().json()
            interrupt = _public_interrupt(public)
            _assert_public_safety(interrupt)
            if interrupt.get("runtime_outcome") != "awaiting_interaction":
                raise AssertionError(f"non-matching binding advanced runtime outcome: {interrupt!r}")
            return {
                "scenario": scenario,
                "mission_id": mission_id,
                "claim_status": rejected.status_code,
                "runtime_outcome": interrupt["runtime_outcome"],
                "maf_version": assert_maf_core_version(),
            }

        claim_data = bridge.client().claim(request.request_id)
        if not claim_data.claimed or not claim_data.delivery_id:
            raise AssertionError(f"expected one durable claim, got {claim_data!r}")
        if scenario == "unauthorized_receipt":
            other = MafGovernanceBridge(api_url, mission_id, "main", workflow, request.request_id)
            other.client().register(identity)
            for receipt_state in ("accepted", "failed", "stale", "unknown"):
                rejected = http.post(
                    f"/api/v1/missions/{mission_id}/branches/main/maf/bridge/receipt",
                    json={
                        "control_ref": other.control_ref,
                        "interrupt_id": request.request_id,
                        "delivery_id": claim_data.delivery_id,
                        "receipt": receipt_state,
                    },
                )
                if rejected.status_code != 409:
                    raise AssertionError(f"non-authorized receipt {receipt_state} changed delivery: {rejected.status_code} {rejected.text}")
            public = http.get(f"/api/v1/missions/{mission_id}/interrupts?branch_id=main").raise_for_status().json()
            interrupt = _public_interrupt(public)
            if interrupt.get("delivery_state") != "pending":
                raise AssertionError(f"non-authorized receipt mutated state: {interrupt!r}")
            return {
                "scenario": scenario,
                "mission_id": mission_id,
                "delivery_state": interrupt["delivery_state"],
                "maf_version": assert_maf_core_version(),
            }
        receipt = "accepted"
        if scenario in {"positive", "post_acceptance_failure"}:
            receipt = await bridge.apply_claim(claim_data)
        elif scenario == "missing_delivery":
            await workflow.run(responses={request.request_id: ReferenceReviewResponse(approved=True)})
        elif scenario == "wrong_delivery":
            await workflow.run(
                responses={request.request_id: ReferenceReviewResponse(approved=True, delivery_id=str(uuid.uuid4()))}
            )
        elif scenario != "accepted_without_terminal":
            raise AssertionError(f"unknown scenario {scenario}")
        bridge.client().receipt(request.request_id, claim_data.delivery_id, receipt)
        provider.force_flush()
        public = http.get(f"/api/v1/missions/{mission_id}/interrupts?branch_id=main").raise_for_status().json()
        interrupt = _public_interrupt(public)
        _assert_public_safety(interrupt)
        public_views = {
            "interactions": public,
            "replay": http.get(f"/api/v1/missions/{mission_id}/replay?branch_id=main").raise_for_status().json(),
            "graph": http.get(f"/api/v1/missions/{mission_id}/graph?branch_id=main").raise_for_status().json(),
            "audit": http.get(f"/api/v1/missions/{mission_id}/audit/events?branch_id=main").raise_for_status().json(),
            "explanation": http.get(f"/api/v1/missions/{mission_id}/explanation?branch_id=main").raise_for_status().json(),
        }
        _assert_public_views(public_views)
        expected_outcome = "failed" if scenario == "post_acceptance_failure" else "continued_with_input" if scenario == "positive" else "awaiting_interaction"
        if interrupt.get("delivery_state") != "accepted" or interrupt.get("runtime_outcome") != expected_outcome:
            raise AssertionError(
                f"{scenario} produced delivery={interrupt.get('delivery_state')!r} "
                f"outcome={interrupt.get('runtime_outcome')!r}; expected accepted/{expected_outcome}"
            )
        if scenario == "positive":
            restarted = MafGovernanceClient(api_url, mission_id, "main", bridge.control_ref).claim(request.request_id)
            if restarted.claimed or restarted.delivery_id != claim_data.delivery_id:
                raise AssertionError(f"Core reissued claimed delivery after bridge restart: {restarted!r}")
        return {
            "scenario": scenario,
            "mission_id": mission_id,
            "decision_id": decision["decision_id"],
            "delivery_id": claim_data.delivery_id,
            "delivery_state": interrupt["delivery_state"],
            "runtime_outcome": interrupt["runtime_outcome"],
            "maf_version": assert_maf_core_version(),
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run one real MAF-to-AgentLens conformance scenario.")
    parser.add_argument(
        "--scenario",
        choices=(
            "positive", "accepted_without_terminal", "missing_delivery", "wrong_delivery",
            "post_acceptance_failure", "nonmatching_binding", "binding_expiry_no_transfer",
            "unauthorized_receipt", "two_requests",
        ),
        default="positive",
    )
    print(json.dumps(asyncio.run(run(parser.parse_args().scenario)), sort_keys=True))
