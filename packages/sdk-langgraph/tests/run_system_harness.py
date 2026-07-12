"""Minimal real LangGraph-to-AgentLens conformance gate.

The primary gate uses a real LangGraph graph/checkpointer, the real callback
OTLP path, the real authenticated AgentLens API, the private bridge HTTP
routes, and the PostgreSQL database configured by that API process. Existing
mocked bridge tests remain available for isolated failure injection and are
not reported as this gate.

Run with the API and PostgreSQL already available:
  LANGGRAPH_GOVERNANCE_ENABLED=true AGENTLENS_SERVICE_TOKEN=... \
  AGENTLENS_API_URL=http://localhost:8001 \
  uv run --directory packages/sdk-langgraph python tests/run_system_harness.py --scenario all
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import tempfile
import uuid
from pathlib import Path
from typing import Any

import httpx

from agentlens_langgraph import (
    GovernanceBridgeClient,
    LangGraphGovernanceBridge,
    NativeIdentity,
    auto_instrument,
)
from agentlens_langgraph.reference_governance_graph import build_reference_governance_graph

PRIMARY_SCENARIOS = ("positive", "accepted_without_terminal", "wrong_scope", "public_output")
PRIVATE_MARKERS = (
    "control_ref",
    "checkpoint_payload",
    "resume_token",
    "authorized_binding_id",
    "workflow.definition",
    "queue",
    "secret",
)
_last_mission_id: str | None = None


def _error_code(exc: Exception) -> str:
    message = str(exc).lower()
    if "interrupt was not visible" in message:
        return "interrupt_not_visible"
    if "public output contained" in message:
        return "public_output_disclosure"
    if "durable claim" in message:
        return "claim_not_accepted"
    if "native continuation" in message:
        return "native_continuation_not_reached"
    return exc.__class__.__name__


def _api_url() -> str:
    return os.environ.get("AGENTLENS_API_URL", "http://localhost:8001").rstrip("/")


def _headers() -> dict[str, str]:
    token = (os.environ.get("AGENTLENS_SERVICE_TOKEN") or os.environ.get("AGENTLENS_API_KEY") or "").strip()
    if not token:
        raise RuntimeError("AGENTLENS_SERVICE_TOKEN or AGENTLENS_API_KEY is required")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _wait_for_api(client: httpx.Client) -> None:
    deadline = time.monotonic() + float(os.environ.get("CONFORMANCE_READINESS_TIMEOUT_SECONDS", "30"))
    last_error: str | None = None
    while time.monotonic() < deadline:
        try:
            response = client.get("/api/health")
            if response.status_code == 200:
                return
            last_error = f"status_{response.status_code}"
        except httpx.HTTPError as exc:
            last_error = exc.__class__.__name__
        time.sleep(0.25)
    raise RuntimeError(f"AgentLens API readiness failed: {last_error or 'timeout'}")


def _public_views(client: httpx.Client, mission_id: str, branch_id: str) -> dict[str, Any]:
    query = {"branch_id": branch_id}
    return {
        "interactions": client.get(f"/api/v1/missions/{mission_id}/interrupts", params=query).json(),
        "replay": client.get(f"/api/v1/missions/{mission_id}/replay", params=query).json(),
        "graph": client.get(f"/api/v1/missions/{mission_id}/graph", params=query).json(),
        "audit": client.get(f"/api/v1/missions/{mission_id}/audit/events", params=query).json(),
        "explanation": client.get(f"/api/v1/missions/{mission_id}/explanation", params=query).json(),
    }


def _assert_public_safety(views: dict[str, Any]) -> None:
    serialized = json.dumps(views, sort_keys=True).lower()
    for marker in PRIVATE_MARKERS:
        if marker in serialized:
            raise AssertionError(f"public output contained prohibited marker: {marker}")


def _find_interrupt(client: httpx.Client, mission_id: str, branch_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + float(os.environ.get("CONFORMANCE_READINESS_TIMEOUT_SECONDS", "30"))
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/missions/{mission_id}/interrupts", params={"branch_id": branch_id})
        response.raise_for_status()
        interrupts = response.json().get("interrupts", [])
        if isinstance(interrupts, list) and interrupts:
            return interrupts[0]
        time.sleep(0.25)
    raise AssertionError("LangGraph interrupt was not visible after real telemetry ingestion")


def _wait_for_public_state(
    client: httpx.Client,
    mission_id: str,
    branch_id: str,
    interrupt_id: str,
    *,
    expected_delivery_state: str,
    expected_runtime_outcomes: set[str],
) -> dict[str, Any]:
    deadline = time.monotonic() + float(os.environ.get("CONFORMANCE_READINESS_TIMEOUT_SECONDS", "30"))
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        response = client.get(
            f"/api/v1/missions/{mission_id}/interrupts",
            params={"branch_id": branch_id},
        )
        response.raise_for_status()
        for candidate in response.json().get("interrupts", []):
            if str(candidate.get("interrupt_id")) != interrupt_id:
                continue
            last = candidate
            if (
                candidate.get("delivery_state") == expected_delivery_state
                and candidate.get("runtime_outcome") in expected_runtime_outcomes
            ):
                return candidate
        time.sleep(0.25)
    raise AssertionError(
        "LangGraph persisted public state did not reach "
        f"delivery={expected_delivery_state!r}, outcome={sorted(expected_runtime_outcomes)!r}: {last!r}"
    )


def _decision(client: httpx.Client, mission_id: str, branch_id: str, interrupt_id: str) -> None:
    response = client.post(
        f"/api/v1/missions/{mission_id}/interrupts/{interrupt_id}/decision",
        params={"branch_id": branch_id},
        json={"decision": "approve", "idempotency_key": f"conformance-{uuid.uuid4()}"},
    )
    response.raise_for_status()


def _scenario(scenario: str) -> dict[str, str]:
    global _last_mission_id
    api_url = _api_url()
    headers = _headers()
    # The SDK's LangGraph callback exporter carries branch identity on the
    # mission span; the root branch is therefore used for all spans in one
    # unique mission while wrong-scope checks exercise a distinct branch.
    branch_id = "main"
    mission_id: str | None = None
    lens = None
    bridge = None
    cleanup_result = "not_run"
    result: dict[str, str] = {"scenario": scenario, "result": "failed", "error_class": "not_started"}
    try:
        with httpx.Client(base_url=api_url, headers=headers, timeout=30) as client:
            _wait_for_api(client)
            created = client.post("/api/v1/missions", json={"objective": f"LangGraph conformance {scenario}"})
            created.raise_for_status()
            mission_id = str(created.json()["id"])
            _last_mission_id = mission_id
            os.environ["AGENTLENS_BRANCH_ID"] = branch_id
            lens, mission, callback = auto_instrument(
                f"LangGraph conformance {scenario}",
                endpoint=api_url,
                api_key=headers["Authorization"].removeprefix("Bearer "),
                mission_id=mission_id,
            )
            graph = build_reference_governance_graph()
            thread_id = f"thread-{uuid.uuid4().hex}"
            invoke_config = {
                "configurable": {"thread_id": thread_id},
                "metadata": {"thread_id": thread_id, "branch_id": branch_id},
                "callbacks": [callback],
            }
            graph.invoke({"objective": f"real {scenario}"}, config=invoke_config)
            lens.flush()
            interrupt = _find_interrupt(client, mission_id, branch_id)
            interrupt_id = str(interrupt["interrupt_id"])
            bridge = LangGraphGovernanceBridge(
                api_base_url=api_url,
                mission_id=mission_id,
                branch_id=branch_id,
                compiled_graph=graph,
                invocation_config=invoke_config,
            )
            bridge.register(
                native_identity=NativeIdentity(
                    thread_id=thread_id,
                    interaction_request_id=interrupt_id,
                    interrupt_request_id=interrupt_id,
                ),
                interrupt_id=interrupt_id,
            )
            if scenario in {"positive", "accepted_without_terminal", "wrong_scope", "public_output"}:
                _decision(client, mission_id, branch_id, interrupt_id)
            claim = bridge.claim_pending(interrupt_id=interrupt_id)
            if not claim.claimed or not claim.delivery_id:
                raise AssertionError("real LangGraph bridge did not receive one durable claim")
            if scenario == "positive":
                receipt = bridge.apply_claimed_delivery(claim, interrupt_id=interrupt_id)
                if receipt is None or receipt.delivery_state != "accepted":
                    raise AssertionError("native Command(resume=...) delivery was not accepted")
                lens.flush()
                state = graph.get_state(invoke_config).values
                if state.get("status") not in {"approved", "completed", "continued"}:
                    raise AssertionError("LangGraph native continuation did not reach the expected state")
                persisted = _wait_for_public_state(
                    client,
                    mission_id,
                    branch_id,
                    interrupt_id,
                    expected_delivery_state="accepted",
                    expected_runtime_outcomes={"continued_with_input"},
                )
                result.update({
                    "persisted_delivery_state": str(persisted["delivery_state"]),
                    "persisted_runtime_outcome": str(persisted["runtime_outcome"]),
                    "graph_status": str(state.get("status")),
                })
            elif scenario == "accepted_without_terminal":
                receipt = bridge.post_receipt(
                    interrupt_id=interrupt_id,
                    delivery_id=claim.delivery_id,
                    receipt="accepted",
                )
                if receipt.delivery_state != "accepted":
                    raise AssertionError("accepted receipt did not remain accepted")
                persisted = _wait_for_public_state(
                    client,
                    mission_id,
                    branch_id,
                    interrupt_id,
                    expected_delivery_state="accepted",
                    expected_runtime_outcomes={"unknown", "awaiting_interaction"},
                )
                result.update({
                    "persisted_delivery_state": str(persisted["delivery_state"]),
                    "persisted_runtime_outcome": str(persisted["runtime_outcome"]),
                })
            elif scenario == "wrong_scope":
                wrong = GovernanceBridgeClient(
                    api_base_url=api_url,
                    mission_id=mission_id,
                    branch_id=f"wrong-{branch_id}",
                    control_ref=bridge.control_ref or "",
                )
                try:
                    try:
                        wrong.claim(interrupt_id=interrupt_id)
                    except Exception:
                        pass
                    else:
                        raise AssertionError("wrong branch accepted a LangGraph claim")
                finally:
                    wrong.close()
            views = _public_views(client, mission_id, branch_id)
            _assert_public_safety(views)
            result.update({"scenario": scenario, "result": "passed"})
    except Exception as exc:
        result = {"scenario": scenario, "result": "failed", "error_code": _error_code(exc)}
    finally:
        if bridge is not None:
            bridge.close()
        if lens is not None:
            try:
                lens.shutdown()
            except Exception:
                cleanup_result = "failed"
        if mission_id is not None:
            try:
                with httpx.Client(base_url=api_url, headers=headers, timeout=30) as cleanup_client:
                    response = cleanup_client.delete(f"/api/v1/missions/{mission_id}")
                    cleanup_result = "passed" if response.status_code in {204, 404} else "failed"
            except Exception:
                cleanup_result = "failed"
        if cleanup_result == "not_run":
            cleanup_result = "not_attempted"
    result["cleanup"] = cleanup_result
    return result


def run_gate(scenarios: tuple[str, ...]) -> dict[str, Any]:
    results: list[dict[str, str]] = []
    if len(scenarios) > 1:
        # OpenTelemetry providers are process-global. Keep each real scenario
        # isolated so one run cannot suppress the next run's exporter.
        for scenario in scenarios:
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as handle:
                summary_path = Path(handle.name)
            try:
                completed = subprocess.run(
                    [sys.executable, str(Path(__file__).resolve()), "--scenario", scenario, "--summary-path", str(summary_path)],
                    env=os.environ.copy(),
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if summary_path.exists():
                    child_summary = json.loads(summary_path.read_text(encoding="utf-8"))
                    results.extend(child_summary.get("scenarios", []))
                else:
                    results.append({
                        "scenario": scenario,
                        "result": "failed",
                        "error_code": f"child_exit_{completed.returncode}",
                        "cleanup": "not_attempted",
                    })
            finally:
                summary_path.unlink(missing_ok=True)
    else:
        for scenario in scenarios:
            try:
                result = _scenario(scenario)
            except Exception as exc:
                result = {
                    "scenario": scenario,
                    "result": "failed",
                    "error_code": _error_code(exc),
                    "cleanup": "not_attempted",
                }
            results.append(result)
    return {
        "framework": "langgraph",
        "gate": "system",
        "result": "passed" if all(item["result"] == "passed" for item in results) else "failed",
        "real_components": ["langgraph_graph", "callback_otlp_path", "agentlens_express_http", "service_authentication", "private_bridge_http", "postgresql"],
        "doubles": [],
        "scenarios": results,
        "evidence_paths": ["packages/sdk-langgraph/tests/harness_manifest.json", "packages/sdk-langgraph/tests/run_system_harness.py"],
        "cleanup_result": "passed" if all(item.get("cleanup") == "passed" for item in results) else "failed",
        "rerun_command": "pnpm conformance:system:langgraph",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=PRIMARY_SCENARIOS + ("all",), default="all")
    parser.add_argument("--summary-path", type=Path, default=Path("artifacts/conformance/langgraph.json"))
    args = parser.parse_args()
    scenarios = PRIMARY_SCENARIOS if args.scenario == "all" else (args.scenario,)
    summary = run_gate(scenarios)
    args.summary_path.parent.mkdir(parents=True, exist_ok=True)
    args.summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[conformance] framework=langgraph gate=system result={summary['result']}")
    for scenario in summary["scenarios"]:
        print(f"[conformance] scenario={scenario['scenario']} result={scenario['result']} cleanup={scenario['cleanup']}")
    print(f"[conformance] evidence={','.join(summary['evidence_paths'])}")
    print(f"[conformance] rerun={summary['rerun_command']}")
    return 0 if summary["result"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
