from agentlens_maf.capability_matrix import CAPABILITY_MATRIX


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
