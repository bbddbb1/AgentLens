from agentlens_maf.enrichment import request_attributes, terminal_attributes
from agentlens_maf.reference_runtime import ReferenceReviewRequest, ReferenceReviewResponse


def test_request_enrichment_is_typed_and_bounded() -> None:
    attrs = request_attributes("request-1", ReferenceReviewRequest(subject="private review"))

    assert attrs == {
        "agentlens.maf.request_id": "request-1",
        "agentlens.maf.request_type": "ReferenceReviewRequest",
        "agentlens.maf.response_type": "ReferenceReviewResponse",
        "agentlens.maf.safe_data_state": "bounded",
    }


def test_terminal_enrichment_keeps_response_values_out_of_telemetry() -> None:
    attrs = terminal_attributes("request-1", ReferenceReviewResponse(approved=False, note="secret"))

    assert attrs["agentlens.maf.terminal_outcome"] == "alternative"
    assert "secret" not in attrs.values()
