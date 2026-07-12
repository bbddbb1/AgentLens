from agentlens_maf.capability_matrix import CAPABILITY_MATRIX
import json
from pathlib import Path


def test_capability_matrix_assesses_every_reference_area() -> None:
    required = {
        "workflow", "executor", "agent", "tool_function", "lifecycle", "failure",
        "relationship", "request", "response_correlation", "native_identity", "model_token",
        "source_traceability", "private_bridge_binding", "governance_binding_readiness",
    }
    rows = {row.key: row for row in CAPABILITY_MATRIX}

    assert set(rows) == required
    assert {row.status for row in CAPABILITY_MATRIX} <= {
        "covered", "partial", "not_observable", "not_applicable"
    }
    assert "control reference" not in " ".join(row.expected_fact for row in CAPABILITY_MATRIX).lower()


def test_every_capability_row_is_backed_by_a_checked_in_fixture() -> None:
    root = Path(__file__).parent / "fixtures" / "otlp"
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))

    for row in CAPABILITY_MATRIX:
        assert row.fixture in manifest["fixtures"]
        facts = json.loads((root / row.fixture / "expected_native_facts.json").read_text(encoding="utf-8"))
        capture = json.loads((root / row.fixture / manifest["capture_file"]).read_text(encoding="utf-8"))
        assert facts["primary_oracle"] == "captured_real_maf_telemetry"
        assert facts["captured_facts"]["span_count"] == len(capture["spans"])
        assert capture["spans"]


def test_capability_matrix_asserts_real_captured_facts() -> None:
    root = Path(__file__).parent / "fixtures" / "otlp"

    def facts(fixture: str) -> dict[str, object]:
        return json.loads((root / fixture / "expected_native_facts.json").read_text(encoding="utf-8"))["captured_facts"]

    success = facts("success")
    agent_tool = facts("agent_tool")
    request = facts("request")
    continuation = facts("continuation")
    failure = facts("explicit_failure")

    assert "workflow.build" in success["span_names"]
    assert "workflow.id" in success["attribute_keys"]
    assert "executor.id" in success["attribute_keys"]
    assert "gen_ai.agent.id" in agent_tool["attribute_keys"]
    assert "gen_ai.tool.name" in agent_tool["attribute_keys"]
    assert {"workflow.started", "workflow.completed"} <= set(success["event_names"])
    assert "workflow.error" in failure["event_names"]
    assert "agentlens.maf.request_info" in request["event_names"]
    assert {"agentlens.maf.request_id", "agentlens.maf.request_type", "agentlens.maf.response_type"} <= set(request["event_attribute_keys"])
    assert "agentlens.maf.response_accepted" in continuation["event_names"]
    assert "control_ref" not in json.dumps({row.fixture: facts(row.fixture) for row in CAPABILITY_MATRIX}).lower()
