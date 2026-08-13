"""
Generate checked-in LangGraph adapter fixtures from the real callback handler.

Run:
  uv run --directory packages/sdk-langgraph pytest tests/test_generate_fixtures.py -q
or:
  python -m tests.generate_fixtures  (from package root with PYTHONPATH set)
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from helpers.capture_otlp import (
    FIXTURES_ROOT,
    make_handler_with_recording_agents,
    stable_uuid,
    write_fixture,
)
from helpers.fixture_fingerprint import recorded_library_versions


def _span_dicts(recorded) -> list[dict]:
    return [span.to_dict() for span in recorded]


def generate_all() -> list[str]:
    generated: list[str] = []

    # --- agent_success ---
    handler, recorded = make_handler_with_recording_agents()
    run_id = stable_uuid("agent-success-run")
    handler.on_chain_start(
        {"name": "researcher"},
        {"query": "papers"},
        run_id=run_id,
        metadata={"langgraph_node": "researcher", "thread_id": "thread-1"},
    )
    handler.on_chain_end({"result": "ok"}, run_id=run_id)
    write_fixture(
        "agent_success",
        _span_dicts(recorded),
        {
            "activities": [
                {
                    "kind": "agent",
                    "name": "researcher",
                    "outcome": "success",
                    "framework": "langgraph",
                    "thread_id": "thread-1",
                    "run_id": str(run_id),
                    "has_native_execution_key": True,
                }
            ],
            "relationships": [],
            "intentional_legacy_corrections": [],
        },
    )
    generated.append("agent_success")

    # --- tool_success ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("tool-success-agent")
    tool_run = stable_uuid("tool-success-tool")
    handler.on_chain_start(
        {"name": "researcher"},
        {},
        run_id=agent_run,
        metadata={"langgraph_node": "researcher", "thread_id": "thread-tools"},
    )
    handler.on_tool_start(
        {"name": "web_search"},
        '{"q":"ai"}',
        run_id=tool_run,
        parent_run_id=agent_run,
    )
    handler.on_tool_end("hits", run_id=tool_run, parent_run_id=agent_run)
    handler.on_chain_end({"ok": True}, run_id=agent_run)
    write_fixture(
        "tool_success",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "researcher", "outcome": "success", "run_id": str(agent_run)},
                {
                    "kind": "tool",
                    "name": "web_search",
                    "outcome": "success",
                    "run_id": str(tool_run),
                    "activity_correlation_id": str(tool_run),
                },
            ],
            "relationships": [{"kind": "parent_child", "parent_run_id": str(agent_run), "child_run_id": str(tool_run)}],
        },
    )
    generated.append("tool_success")

    # --- tool_failed ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("tool-failed-agent")
    tool_run = stable_uuid("tool-failed-tool")
    handler.on_chain_start(
        {"name": "researcher"}, {}, run_id=agent_run, metadata={"langgraph_node": "researcher"}
    )
    handler.on_tool_start(
        {"name": "web_search"}, "q", run_id=tool_run, parent_run_id=agent_run
    )
    handler.on_tool_error(RuntimeError("timeout"), run_id=tool_run, parent_run_id=agent_run)
    handler.on_chain_end({}, run_id=agent_run)
    write_fixture(
        "tool_failed",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "researcher", "outcome": "success"},
                {"kind": "tool", "name": "web_search", "outcome": "failed", "never_success": True, "run_id": str(tool_run)},
            ],
            "safety": {"failure_never_success": True},
        },
    )
    generated.append("tool_failed")

    # --- parent_child_correlation (no handoff) ---
    handler, recorded = make_handler_with_recording_agents()
    parent = stable_uuid("parent-run")
    child = stable_uuid("child-run")
    handler.on_chain_start(
        {"name": "supervisor"}, {}, run_id=parent, metadata={"langgraph_node": "supervisor", "thread_id": "t-pc"}
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
    write_fixture(
        "parent_child_correlation",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "supervisor", "run_id": str(parent)},
                {"kind": "agent", "name": "worker", "run_id": str(child), "parent_run_id": str(parent)},
            ],
            "relationships": [{"kind": "parent_child", "parent_run_id": str(parent), "child_run_id": str(child)}],
            "handoff_edges_expected": 0,
            "intentional_legacy_corrections": [
                {
                    "id": "parent_child_not_handoff",
                    "description": "Ordinary parent-child nesting is correlation only; legacy emitted handoff events.",
                }
            ],
        },
    )
    generated.append("parent_child_correlation")

    # --- llm_token_usage ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("llm-agent")
    llm_run = stable_uuid("llm-run")
    handler.on_chain_start(
        {"name": "reasoner"}, {}, run_id=agent_run, metadata={"langgraph_node": "reasoner"}
    )
    handler.on_llm_start(
        {"name": "gpt-4o-mini"},
        ["hello"],
        run_id=llm_run,
        parent_run_id=agent_run,
        metadata={"ls_model_name": "gpt-4o-mini"},
    )
    handler.on_llm_end(
        {"llm_output": {"token_usage": {"prompt_tokens": 11, "completion_tokens": 7}}},
        run_id=llm_run,
        parent_run_id=agent_run,
    )
    handler.on_chain_end({}, run_id=agent_run)
    write_fixture(
        "llm_token_usage",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "reasoner"},
                {
                    "kind": "llm",
                    "model": "gpt-4o-mini",
                    "tokens_input": 11,
                    "tokens_output": 7,
                    "run_id": str(llm_run),
                },
            ],
            "coverage_notes": "Token usage depends on provider metadata; matrix status is partial.",
        },
    )
    generated.append("llm_token_usage")

    # --- retrieval_explicit ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("retr-agent")
    retr_run = stable_uuid("retr-run")
    handler.on_chain_start(
        {"name": "rag"}, {}, run_id=agent_run, metadata={"langgraph_node": "rag"}
    )
    handler.on_retriever_start(
        {"name": "vector_store"},
        "what is LangGraph?",
        run_id=retr_run,
        parent_run_id=agent_run,
    )
    handler.on_retriever_end(["doc1", "doc2"], run_id=retr_run, parent_run_id=agent_run)
    handler.on_chain_end({}, run_id=agent_run)
    write_fixture(
        "retrieval_explicit",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "rag"},
                {
                    "kind": "retrieval",
                    "name": "vector_store",
                    "outcome": "success",
                    "retrieval_marker": True,
                    "run_id": str(retr_run),
                },
            ],
            "notes": "Tool names alone must not claim Retrieval.",
        },
    )
    generated.append("retrieval_explicit")

    # --- interrupt_request ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("intr-agent")
    handler.on_chain_start(
        {"name": "approver"},
        {},
        run_id=agent_run,
        metadata={"langgraph_node": "approver", "interrupt_id": "intr-42"},
    )
    handler.on_chain_end({"__interrupt__": [{"id": "intr-42", "value": "need review"}]}, run_id=agent_run)
    write_fixture(
        "interrupt_request",
        _span_dicts(recorded),
        {
            "activities": [
                {
                    "kind": "agent",
                    "name": "approver",
                    "interrupt_request_id": "intr-42",
                    "observes_interrupt": True,
                    "issues_control": False,
                }
            ],
            "deferred": ["approval_control", "resume_control"],
        },
    )
    generated.append("interrupt_request")

    # --- interrupt_resume ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("resume-agent")
    handler.on_chain_start(
        {"name": "approver"},
        {},
        run_id=agent_run,
        metadata={
            "langgraph_node": "approver",
            "resume_of_interrupt_id": "intr-42",
        },
        tags=["resume_of:intr-42"],
    )
    handler.on_chain_end({"continued": True}, run_id=agent_run)
    write_fixture(
        "interrupt_resume",
        _span_dicts(recorded),
        {
            "activities": [
                {
                    "kind": "agent",
                    "name": "approver",
                    "resume_of_interrupt_id": "intr-42",
                    "issues_resume_command": False,
                }
            ],
            "notes": "Resume is observed only from explicit markers; not inferred from later activity.",
        },
    )
    generated.append("interrupt_resume")

    # --- checkpoint_reference ---
    handler, recorded = make_handler_with_recording_agents()
    agent_run = stable_uuid("ckpt-agent")
    handler.on_chain_start(
        {"name": "node_a"},
        {},
        run_id=agent_run,
        metadata={
            "langgraph_node": "node_a",
            "thread_id": "thread-ckpt",
            "checkpoint_id": "ckpt-99",
            "checkpoint_ns": "",
        },
    )
    handler.on_chain_end({}, run_id=agent_run)
    write_fixture(
        "checkpoint_reference",
        _span_dicts(recorded),
        {
            "activities": [
                {
                    "kind": "agent",
                    "name": "node_a",
                    "checkpoint_id": "ckpt-99",
                    "checkpoint_ns": "",
                    "checkpoint_payload_captured": False,
                }
            ],
        },
    )
    generated.append("checkpoint_reference")

    # --- explicit_handoff ---
    handler, recorded = make_handler_with_recording_agents()
    parent = stable_uuid("handoff-parent")
    child = stable_uuid("handoff-child")
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
    handler.on_chain_end({}, run_id=child, parent_run_id=parent)
    handler.on_chain_end({}, run_id=parent)
    write_fixture(
        "explicit_handoff",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "supervisor", "run_id": str(parent)},
                {"kind": "agent", "name": "specialist", "run_id": str(child)},
            ],
            "relationships": [
                {"kind": "handoff", "target": "specialist", "explicit": True, "resolution": "resolved"}
            ],
            "handoff_edges_expected": 1,
            "notes": "Handoff requires explicit langgraph_handoff/handoff_to evidence; Command.goto/output goto is not handoff.",
        },
    )
    generated.append("explicit_handoff")

    # --- unresolved_target ---
    handler, recorded = make_handler_with_recording_agents()
    parent = stable_uuid("unresolved-parent")
    handler.on_chain_start(
        {"name": "supervisor"},
        {},
        run_id=parent,
        metadata={"langgraph_node": "supervisor", "langgraph_handoff": "missing_agent"},
    )
    handler.on_chain_end({}, run_id=parent)
    write_fixture(
        "unresolved_target",
        _span_dicts(recorded),
        {
            "activities": [{"kind": "agent", "name": "supervisor"}],
            "relationships": [
                {"kind": "handoff", "target": "missing_agent", "resolution": "unresolved", "fabricate_edge": False}
            ],
            "safety": {"no_fabricated_edge": True},
        },
    )
    generated.append("unresolved_target")

    # --- non_causal_overlap ---
    handler, recorded = make_handler_with_recording_agents()
    a = stable_uuid("overlap-a")
    b = stable_uuid("overlap-b")
    handler.on_chain_start({"name": "alpha"}, {}, run_id=a, metadata={"langgraph_node": "alpha"})
    handler.on_chain_start({"name": "beta"}, {}, run_id=b, metadata={"langgraph_node": "beta"})
    handler.on_chain_end({}, run_id=a)
    handler.on_chain_end({}, run_id=b)
    write_fixture(
        "non_causal_overlap",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "alpha"},
                {"kind": "agent", "name": "beta"},
            ],
            "relationships": [],
            "safety": {"overlap_does_not_create_causality": True},
        },
    )
    generated.append("non_causal_overlap")

    # --- unknown_telemetry ---
    handler, recorded = make_handler_with_recording_agents()
    run_id = stable_uuid("unknown-agent")
    handler.on_chain_start(
        {"name": "node_x"},
        {},
        run_id=run_id,
        metadata={
            "langgraph_node": "node_x",
            "thread_id": "thread-u",
            "langgraph_future_field_xyz": {"nested": True},
        },
    )
    # Inject unknown event on the recorded span after start
    if recorded:
        recorded[0].add_event("langgraph.unknown.event", {"future.attr": "1"})
    handler.on_chain_end({}, run_id=run_id)
    write_fixture(
        "unknown_telemetry",
        _span_dicts(recorded),
        {
            "activities": [
                {"kind": "agent", "name": "node_x", "framework": "langgraph", "thread_id": "thread-u"}
            ],
            "safety": {"unknown_degrades_safely": True, "no_fabricated_semantics": True},
        },
    )
    generated.append("unknown_telemetry")

    fingerprints: dict[str, str] = {}
    for fixture_id in generated:
        fixture_dir = FIXTURES_ROOT / fixture_id
        spans_doc = json.loads((fixture_dir / "spans.json").read_text(encoding="utf-8"))
        fingerprints[fixture_id] = str(spans_doc["semantic_fingerprint"]["digest"])

    manifest = {
        "fixtures": generated,
        "root": "packages/sdk-langgraph/tests/fixtures/otlp",
        "fixture_generator": "packages/sdk-langgraph/tests/generate_fixtures.py",
        "framework_version_context": recorded_library_versions(),
        "native_evidence_source": "AgentLensLangGraphCallbackHandler callbacks and LangGraph-native graph/checkpointer facts",
        "primary_oracle": "native_facts",
        "fingerprint": {"algorithm": "sha256", "scope": "semantic spans plus native oracle"},
        "fingerprints": fingerprints,
        "declared_test_doubles": [
            "RecordingSpan and MagicMock AgentLens/Mission used only by fixture capture",
        ],
        "regeneration_command": "uv run --directory packages/sdk-langgraph pytest tests/test_generate_fixtures.py -q",
    }
    (FIXTURES_ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return generated


if __name__ == "__main__":
    names = generate_all()
    print(f"Generated {len(names)} fixtures: {', '.join(names)}")
