"""Helpers to capture adapter-produced OTLP-shaped span payloads for fixtures."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

from agentlens_langgraph.instrumentor import AgentLensLangGraphCallbackHandler
from agentlens_langgraph.native_attrs import LangGraphNativeAttributes
from agentlens_sdk.agent import AgentInstrumentor


FIXTURES_ROOT = Path(__file__).resolve().parent.parent / "fixtures" / "otlp"


@dataclass
class CapturedSpan:
    span_id: str
    trace_id: str
    parent_span_id: str | None
    name: str
    attributes: dict[str, Any]
    events: list[dict[str, Any]]
    status_code: str
    start_time_unix_nano: int
    end_time_unix_nano: int


class RecordingSpan:
    """Minimal stand-in for an OTel span that records attributes/events/status."""

    _counter = 0

    def __init__(self, name: str, parent: "RecordingSpan | None" = None):
        RecordingSpan._counter += 1
        self.name = name
        self.span_id = f"{RecordingSpan._counter:016x}"
        self.trace_id = parent.trace_id if parent else f"{RecordingSpan._counter:032x}"
        self.parent_span_id = parent.span_id if parent else None
        self.attributes: dict[str, Any] = {}
        self.events: list[dict[str, Any]] = []
        self.status_code = "UNSET"
        self.status_message = ""
        self.start_time_unix_nano = 1_000_000_000_000 + RecordingSpan._counter * 1_000_000
        self.end_time_unix_nano = self.start_time_unix_nano + 500_000_000

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[str(key)] = value

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        self.events.append(
            {
                "name": name,
                "time_unix_nano": str(self.start_time_unix_nano + len(self.events) * 1_000),
                "attributes": dict(attributes or {}),
            }
        )

    def set_status(self, status: Any, description: str = "") -> None:
        code = getattr(status, "name", None) or str(status)
        if "ERROR" in str(code).upper():
            self.status_code = "ERROR"
        elif "OK" in str(code).upper():
            self.status_code = "OK"
        else:
            self.status_code = "UNSET"
        self.status_message = description

    def end(self) -> None:
        pass

    def to_dict(self) -> dict[str, Any]:
        return {
            "span_id": self.span_id,
            "trace_id": self.trace_id,
            "parent_span_id": self.parent_span_id or "",
            "name": self.name,
            "operation_name": self.name,
            "start_time_unix_nano": str(self.start_time_unix_nano),
            "end_time_unix_nano": str(self.end_time_unix_nano),
            "attributes": dict(self.attributes),
            "events": list(self.events),
            "status_code": self.status_code,
            "status_message": self.status_message,
        }


def make_handler_with_recording_agents() -> tuple[AgentLensLangGraphCallbackHandler, list[RecordingSpan]]:
    """Build a handler whose mission.agent() returns agents backed by RecordingSpan."""
    RecordingSpan._counter = 0
    lens = MagicMock()
    lens._get_injection = MagicMock(return_value=None)
    mission = MagicMock()
    recorded: list[RecordingSpan] = []
    parent_stack: list[RecordingSpan] = []

    def agent_factory(**kwargs: Any) -> AgentInstrumentor:
        parent = parent_stack[-1] if parent_stack else None
        span = RecordingSpan(name=f"agent:{kwargs.get('name') or kwargs.get('agent_id')}", parent=parent)
        # Seed framework identity like the real AgentInstrumentor.
        span.set_attribute("gen_ai.agent.id", kwargs.get("agent_id"))
        span.set_attribute("gen_ai.agent.name", kwargs.get("name"))
        span.set_attribute("gen_ai.agent.role", kwargs.get("role"))
        span.set_attribute("gen_ai.agent.framework", "langgraph")
        span.set_attribute("agent.span.kind", "invoke_agent")
        recorded.append(span)

        agent = MagicMock(spec=AgentInstrumentor)
        agent._span = span

        def enter():
            parent_stack.append(span)
            return agent

        def exit_fn(exc_type, exc, tb):
            if parent_stack and parent_stack[-1] is span:
                parent_stack.pop()
            if exc_type:
                span.set_status(type("S", (), {"name": "ERROR"})(), str(exc))
            else:
                span.set_status(type("S", (), {"name": "OK"})())

        agent.__enter__ = MagicMock(side_effect=enter)
        agent.__exit__ = MagicMock(side_effect=exit_fn)
        agent.set_task = MagicMock(side_effect=lambda task: span.set_attribute("gen_ai.agent.task", task))
        agent.set_goal = MagicMock(side_effect=lambda goal: span.set_attribute("gen_ai.agent.goal", goal))
        agent.record_memory_read = MagicMock(
            side_effect=lambda key, value=None: span.add_event(
                "agent.memory.read", {"gen_ai.agent.memory.key": key}
            )
        )
        agent.record_memory_write = MagicMock(
            side_effect=lambda key, value=None: span.add_event(
                "agent.memory.write", {"gen_ai.agent.memory.key": key}
            )
        )
        agent.record_tool_call = MagicMock(
            side_effect=lambda tool_name, tool_input=None, tool_output=None, status="success": span.add_event(
                "agent.tool.call",
                {
                    "gen_ai.tool.name": tool_name,
                    "gen_ai.tool.status": status,
                    **({"gen_ai.tool.output": str(tool_output)} if tool_output is not None else {}),
                },
            )
        )
        agent.record_llm_call = MagicMock(
            side_effect=lambda model, prompt=None, completion=None, tokens_input=None, tokens_output=None, **kw: span.add_event(
                "gen_ai.call",
                {
                    "gen_ai.request.model": model,
                    **({"gen_ai.usage.input_tokens": str(tokens_input)} if tokens_input is not None else {}),
                    **({"gen_ai.usage.output_tokens": str(tokens_output)} if tokens_output is not None else {}),
                },
            )
        )
        return agent

    mission.agent.side_effect = agent_factory
    handler = AgentLensLangGraphCallbackHandler(lens, mission)
    return handler, recorded


def write_fixture(
    fixture_id: str,
    spans: list[dict[str, Any]],
    expected_native_facts: dict[str, Any],
    *,
    library_versions: dict[str, str] | None = None,
) -> Path:
    """Write checked-in adapter-shaped spans + native-fact oracle for a scenario."""
    from helpers.fixture_fingerprint import recorded_library_versions, semantic_fixture_fingerprint

    dest = FIXTURES_ROOT / fixture_id
    dest.mkdir(parents=True, exist_ok=True)
    versions = library_versions or recorded_library_versions()
    fingerprint = semantic_fixture_fingerprint(spans, expected_native_facts)
    provenance = {
        "generator": "packages/sdk-langgraph/tests/generate_fixtures.py",
        "framework_version_context": versions,
        "native_evidence_source": "AgentLensLangGraphCallbackHandler callbacks and LangGraph-native interrupt/checkpoint metadata",
        "primary_oracle": "native_facts",
        "declared_test_doubles": [
            "RecordingSpan and MagicMock AgentLens/Mission used only by fixture capture",
        ],
        "regeneration_command": "uv run --directory packages/sdk-langgraph pytest tests/test_generate_fixtures.py -q",
    }
    payload = {
        "fixture_id": fixture_id,
        "generator": "packages/sdk-langgraph/tests/helpers/capture_otlp.py",
        "adapter": "AgentLensLangGraphCallbackHandler",
        "library_versions": versions,
        "provenance": provenance,
        "semantic_fingerprint": {
            "algorithm": fingerprint["algorithm"],
            "digest": fingerprint["digest"],
        },
        "spans": spans,
    }
    (dest / "spans.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    expected = {
        "fixture_id": fixture_id,
        "primary_oracle": "native_facts",
        "provenance": provenance,
        "oracle": expected_native_facts,
        "semantic_fingerprint": {
            "algorithm": fingerprint["algorithm"],
            "digest": fingerprint["digest"],
        },
        "legacy_comparison": {
            "authoritative": False,
            "notes": "Legacy projection equality is secondary; native facts win.",
        },
    }
    (dest / "expected_native_facts.json").write_text(
        json.dumps(expected, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return dest


def stable_uuid(label: str) -> UUID:
    """Deterministic UUID for fixture stability."""
    return UUID(bytes=(label.encode("utf-8") + b"\0" * 16)[:16])
