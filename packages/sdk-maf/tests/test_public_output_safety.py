from agentlens_maf.governance_bridge import MafGovernanceBridge, MafNativeIdentity
from agentlens_maf.reference_runtime import create_reference_review_workflow


def test_public_bridge_payloads_never_expose_control_or_live_workflow_state() -> None:
    bridge = MafGovernanceBridge(
        "http://example.invalid", "mission", "main", create_reference_review_workflow(), "request-1"
    )
    identity = MafNativeIdentity("workflow-1", "request-1", "executor-1").payload()
    public_values = str(identity)

    assert bridge.control_ref not in public_values
    assert "workflow object" not in public_values.lower()
    assert "checkpoint" not in public_values.lower()
    assert "secret" not in public_values.lower()


def test_safe_terminal_attributes_do_not_contain_response_note() -> None:
    from agentlens_maf.enrichment import terminal_attributes
    from agentlens_maf.reference_runtime import ReferenceReviewResponse

    attrs = terminal_attributes("request-1", ReferenceReviewResponse(approved=True, note="credential=secret"))
    assert "credential=secret" not in str(attrs)
