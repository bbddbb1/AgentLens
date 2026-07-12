"""Contract tests: checked-in fixtures stay aligned with the current adapter emitter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from generate_fixtures import generate_all
from helpers.capture_otlp import FIXTURES_ROOT, make_handler_with_recording_agents, stable_uuid
from agentlens_langgraph.native_attrs import LangGraphNativeAttributes


@pytest.fixture(scope="module", autouse=True)
def _ensure_fixtures_generated():
    generate_all()


def test_manifest_lists_required_scenarios():
    manifest = json.loads((FIXTURES_ROOT / "manifest.json").read_text(encoding="utf-8"))
    required = {
        "agent_success",
        "tool_success",
        "tool_failed",
        "parent_child_correlation",
        "llm_token_usage",
        "retrieval_explicit",
        "interrupt_request",
        "interrupt_resume",
        "checkpoint_reference",
        "explicit_handoff",
        "unresolved_target",
        "non_causal_overlap",
        "unknown_telemetry",
    }
    assert required.issubset(set(manifest["fixtures"]))
    assert manifest["fixture_generator"] == "packages/sdk-langgraph/tests/generate_fixtures.py"
    assert manifest["native_evidence_source"]
    assert manifest["primary_oracle"] == "native_facts"
    assert manifest["fingerprint"]["algorithm"] == "sha256"
    assert set(manifest["fingerprints"]) == set(manifest["fixtures"])
    assert manifest["declared_test_doubles"]
    assert manifest["regeneration_command"].startswith("uv run")


@pytest.mark.parametrize(
    "fixture_id",
    [
        "agent_success",
        "tool_success",
        "tool_failed",
        "parent_child_correlation",
        "llm_token_usage",
        "retrieval_explicit",
        "interrupt_request",
        "interrupt_resume",
        "checkpoint_reference",
        "explicit_handoff",
        "unresolved_target",
        "non_causal_overlap",
        "unknown_telemetry",
    ],
)
def test_fixture_has_spans_and_native_oracle(fixture_id: str):
    spans_path = FIXTURES_ROOT / fixture_id / "spans.json"
    facts_path = FIXTURES_ROOT / fixture_id / "expected_native_facts.json"
    spans_doc = json.loads(spans_path.read_text(encoding="utf-8"))
    facts_doc = json.loads(facts_path.read_text(encoding="utf-8"))
    assert spans_doc["fixture_id"] == fixture_id
    assert spans_doc["adapter"] == "AgentLensLangGraphCallbackHandler"
    assert isinstance(spans_doc["spans"], list)
    assert facts_doc["primary_oracle"] == "native_facts"
    assert spans_doc["provenance"]["generator"] == "packages/sdk-langgraph/tests/generate_fixtures.py"
    assert facts_doc["provenance"]["primary_oracle"] == "native_facts"
    assert spans_doc["provenance"]["declared_test_doubles"]
    assert facts_doc["semantic_fingerprint"]["digest"] == spans_doc["semantic_fingerprint"]["digest"]
    assert facts_doc["legacy_comparison"]["authoritative"] is False


def test_parent_child_does_not_emit_handoff_events():
    handler, recorded = make_handler_with_recording_agents()
    parent = stable_uuid("pc-parent")
    child = stable_uuid("pc-child")
    handler.on_chain_start(
        {"name": "supervisor"}, {}, run_id=parent, metadata={"langgraph_node": "supervisor"}
    )
    handler.on_chain_start(
        {"name": "worker"},
        {},
        run_id=child,
        parent_run_id=parent,
        metadata={"langgraph_node": "worker"},
    )
    handler.on_chain_end({}, run_id=child, parent_run_id=parent)
    handler.on_chain_end({}, run_id=parent)
    event_names = [e["name"] for span in recorded for e in span.events]
    assert "agent.handoff.requested" not in event_names
    assert "agent.handoff.accepted" not in event_names
    # Parent run id preserved on child
    child_span = next(s for s in recorded if s.attributes.get("gen_ai.agent.name") == "worker")
    assert child_span.attributes.get(LangGraphNativeAttributes.PARENT_RUN_ID) == str(parent)
    assert child_span.attributes.get(LangGraphNativeAttributes.RUN_ID) == str(child)


def test_explicit_handoff_emits_handoff_with_marker():
    handler, recorded = make_handler_with_recording_agents()
    parent = stable_uuid("eh-parent")
    child = stable_uuid("eh-child")
    handler.on_chain_start(
        {"name": "supervisor"}, {}, run_id=parent, metadata={"langgraph_node": "supervisor"}
    )
    handler.on_chain_start(
        {"name": "specialist"},
        {},
        run_id=child,
        parent_run_id=parent,
        metadata={"langgraph_node": "specialist", "langgraph_handoff": "specialist"},
    )
    handler.on_chain_end({}, run_id=child)
    handler.on_chain_end({}, run_id=parent)
    parent_span = next(s for s in recorded if s.attributes.get("gen_ai.agent.name") == "supervisor")
    handoffs = [e for e in parent_span.events if e["name"] == "agent.handoff.requested"]
    assert handoffs
    assert handoffs[0]["attributes"].get(LangGraphNativeAttributes.EXPLICIT_HANDOFF) == "true"


def test_tool_failure_preserves_error_status():
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("tf-agent")
    tool_run = stable_uuid("tf-tool")
    handler.on_chain_start(
        {"name": "researcher"}, {}, run_id=agent_run, metadata={"langgraph_node": "researcher"}
    )
    handler.on_tool_start(
        {"name": "web_search"}, "q", run_id=tool_run, parent_run_id=agent_run
    )
    handler.on_tool_error(RuntimeError("boom"), run_id=tool_run, parent_run_id=agent_run)
    handler.on_chain_end({}, run_id=agent_run)
    tool_events = [
        e
        for e in recorded[0].events
        if e["name"] == "agent.tool.call" and e["attributes"].get("gen_ai.tool.status") == "error"
    ]
    assert tool_events
    assert tool_events[0]["attributes"].get(LangGraphNativeAttributes.RUN_ID) == str(tool_run)


def test_regenerated_fixtures_match_checked_in_semantic_fingerprint():
    """Re-running generation must not drift semantic adapter/oracle facts."""
    from helpers.fixture_fingerprint import fingerprints_equal, semantic_fixture_fingerprint

    before = {}
    for path in FIXTURES_ROOT.iterdir():
        if not path.is_dir():
            continue
        spans_doc = json.loads((path / "spans.json").read_text(encoding="utf-8"))
        facts_doc = json.loads((path / "expected_native_facts.json").read_text(encoding="utf-8"))
        before[path.name] = semantic_fixture_fingerprint(spans_doc["spans"], facts_doc["oracle"])

    generate_all()

    after = {}
    for path in FIXTURES_ROOT.iterdir():
        if not path.is_dir():
            continue
        spans_doc = json.loads((path / "spans.json").read_text(encoding="utf-8"))
        facts_doc = json.loads((path / "expected_native_facts.json").read_text(encoding="utf-8"))
        after[path.name] = semantic_fixture_fingerprint(spans_doc["spans"], facts_doc["oracle"])
        # Checked-in digest must match regenerated semantic fingerprint.
        assert spans_doc.get("semantic_fingerprint", {}).get("digest") == after[path.name]["digest"]
        assert facts_doc.get("semantic_fingerprint", {}).get("digest") == after[path.name]["digest"]
        # Library versions must be recorded (not placeholders).
        versions = spans_doc.get("library_versions") or {}
        assert versions
        assert "recorded-at-generation" not in versions.values()

    assert before.keys() == after.keys()
    for key in before:
        assert fingerprints_equal(before[key], after[key]), (
            f"semantic drift in fixture {key}: "
            f"{before[key]['digest']} -> {after[key]['digest']}"
        )


def test_goto_output_is_not_treated_as_handoff():
    handler, recorded = make_handler_with_recording_agents()
    run_id = stable_uuid("goto-not-handoff")
    handler.on_chain_start(
        {"name": "router"},
        {},
        run_id=run_id,
        metadata={"langgraph_node": "router"},
    )
    handler.on_chain_end({"goto": "worker", "command": {"goto": "worker"}}, run_id=run_id)
    event_names = [e["name"] for span in recorded for e in span.events]
    assert "agent.handoff.requested" not in event_names
