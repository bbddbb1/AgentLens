"""Capture checked-in fixture evidence from the pinned, real MAF workflow.

The capture exporter is used only to create structural test fixtures. It is
not the system harness: `run_system_harness.py` uses OTLP/HTTP and the real
AgentLens API/PostgreSQL stack.
"""

from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any

from agentlens_maf.otel_capture import real_span_capture
from agentlens_maf.reference_runtime import (
    ReferenceReviewResponse,
    create_reference_review_workflow,
    create_reference_workflow,
)
from agentlens_maf.version import MAF_CORE_VERSION, assert_maf_core_version

FIXTURE_NAMES = (
    "success",
    "agent_tool",
    "request",
    "continuation",
    "alternative",
    "explicit_failure",
    "unknown_telemetry",
    "missing_identity",
    "conflicting_identity",
    "unrelated_later_activity",
    "post_acceptance_failure",
)


def _stable_value(key: str, value: object) -> object:
    """Keep structural facts while removing volatile/private fixture values."""
    if key in {"workflow.id", "agentlens.maf.workflow_id"}:
        return "<workflow-id>"
    if key == "workflow.definition":
        return "<redacted-workflow-definition>"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_stable_value(key, item) for item in value]
    return str(value)


def _capture_span(span: Any, trace_names: dict[int, str], span_names: dict[int, str]) -> dict[str, object]:
    def trace_name(value: int) -> str:
        return trace_names.setdefault(value, f"trace-{len(trace_names) + 1}")

    def span_name(value: int) -> str:
        return span_names.setdefault(value, f"span-{len(span_names) + 1}")

    return {
        "trace_id": trace_name(span.context.trace_id),
        "span_id": span_name(span.context.span_id),
        "parent_span_id": span_name(span.parent.span_id) if span.parent else None,
        "operation_name": span.name,
        "start_time_unix_nano": 0,
        "end_time_unix_nano": 1,
        "status_code": span.status.status_code.name,
        "attributes": {key: _stable_value(key, value) for key, value in span.attributes.items()},
        "events": [
            {
                "name": event.name,
                "timestamp": 0,
                "attributes": {key: _stable_value(key, value) for key, value in event.attributes.items()},
            }
            for event in span.events
        ],
    }


async def _run_fixture_workflow(name: str) -> None:
    if name in {"success", "agent_tool", "explicit_failure"}:
        workflow = create_reference_workflow()
        try:
            await workflow.run("fail" if name == "explicit_failure" else "fixture")
        except RuntimeError:
            if name != "explicit_failure":
                raise
        return

    workflow = create_reference_review_workflow()
    pending = await workflow.run(f"fixture-{name}")
    request = pending.get_request_info_events()[0]
    if name == "continuation":
        await workflow.run(responses={request.request_id: ReferenceReviewResponse(approved=True)})
    elif name == "alternative":
        await workflow.run(responses={request.request_id: ReferenceReviewResponse(approved=False)})
    elif name == "post_acceptance_failure":
        await workflow.run(
            responses={request.request_id: ReferenceReviewResponse(approved=True, post_acceptance_failure=True)}
        )
    elif name == "unrelated_later_activity":
        # A second real MAF workflow run has no request/delivery correlation to
        # the pending review request.
        await create_reference_workflow().run("unrelated-later-activity")


def _apply_documented_fixture_condition(name: str, spans: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[str]]:
    fixture = copy.deepcopy(spans)
    if name == "unknown_telemetry":
        for span in fixture:
            span["events"] = [event for event in span["events"] if event["name"] != "agentlens.maf.request_info"]
        return fixture, ["removed request_info enrichment from a real request capture to represent unclassified telemetry"]
    if name == "missing_identity":
        for span in fixture:
            attributes = span["attributes"]
            attributes.pop("workflow.id", None)
            attributes.pop("agentlens.maf.workflow_id", None)
        return fixture, ["removed workflow identity from a real request capture"]
    if name == "conflicting_identity":
        for span in fixture:
            for event in span["events"]:
                if event["name"] == "agentlens.maf.request_info":
                    event["attributes"]["agentlens.maf.workflow_id"] = "<conflicting-workflow-id>"
        return fixture, ["added an explicit conflicting workflow identity to a real request enrichment"]
    return fixture, []


def _capture_real_fixtures() -> dict[str, list[dict[str, object]]]:
    captured: dict[str, list[dict[str, object]]] = {}
    with real_span_capture() as exporter:
        for name in FIXTURE_NAMES:
            start = len(exporter.spans)
            asyncio.run(_run_fixture_workflow(name))
            trace_names: dict[int, str] = {}
            span_names: dict[int, str] = {}
            captured[name] = [_capture_span(span, trace_names, span_names) for span in exporter.spans[start:]]
    return captured


def _captured_facts(spans: list[dict[str, object]]) -> dict[str, object]:
    attributes = {
        key
        for span in spans
        for key in (span.get("attributes") or {}).keys()  # type: ignore[union-attr]
    }
    events = [
        event
        for span in spans
        for event in (span.get("events") or [])  # type: ignore[union-attr]
    ]
    return {
        "span_count": len(spans),
        "span_names": sorted({str(span["operation_name"]) for span in spans}),
        "event_names": sorted({str(event["name"]) for event in events}),
        "attribute_keys": sorted(attributes),
        "event_attribute_keys": sorted({key for event in events for key in (event.get("attributes") or {}).keys()}),
    }


def generate_all(root: Path) -> list[str]:
    """Capture real pinned MAF workflow telemetry and write stable fixtures."""
    installed = assert_maf_core_version()
    captured = _capture_real_fixtures()
    root.mkdir(parents=True, exist_ok=True)
    for name in FIXTURE_NAMES:
        fixture_dir = root / name
        fixture_dir.mkdir(exist_ok=True)
        spans, modification = _apply_documented_fixture_condition(name, captured[name])
        (fixture_dir / "captured_telemetry.json").write_text(
            json.dumps({"spans": spans}, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (fixture_dir / "expected_native_facts.json").write_text(
            json.dumps(
                {
                    "fixture": name,
                    "framework": "ms_agent_framework",
                    "maf_core_version": MAF_CORE_VERSION,
                    "primary_oracle": "captured_real_maf_telemetry",
                    "fixture_modification": modification,
                    "captured_facts": _captured_facts(spans),
                },
                indent=2,
                sort_keys=True,
            ) + "\n",
            encoding="utf-8",
        )
    manifest = {
        "fixtures": list(FIXTURE_NAMES),
        "maf_core_version": installed,
        "fixture_generator": "packages/sdk-maf/tests/generate_fixtures.py",
        "primary_oracle": "captured_real_maf_telemetry",
        "capture_file": "captured_telemetry.json",
        "remaining_test_double": "DeterministicModelClient only; MAF workflow, agent, tool, and telemetry are real.",
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return list(FIXTURE_NAMES)


if __name__ == "__main__":
    generate_all(Path(__file__).parent / "fixtures" / "otlp")
