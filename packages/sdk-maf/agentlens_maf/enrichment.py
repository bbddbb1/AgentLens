"""Bounded OTel enrichment for MAF facts native spans do not retain."""

from typing import Mapping

from opentelemetry import trace

from .reference_runtime import ReferenceReviewRequest, ReferenceReviewResponse


def request_attributes(request_id: str, request: ReferenceReviewRequest) -> dict[str, str]:
    """Describe a native request without serializing its complete payload."""
    return {
        "agentlens.maf.request_id": request_id,
        "agentlens.maf.request_type": type(request).__name__,
        "agentlens.maf.response_type": ReferenceReviewResponse.__name__,
        "agentlens.maf.safe_data_state": "bounded",
    }


def emit_enrichment(name: str, attributes: Mapping[str, str]) -> None:
    """Attach explicit MAF enrichment to the active native workflow span when present."""
    span = trace.get_current_span()
    if span.is_recording():
        span.add_event(name, attributes=dict(attributes))


def terminal_attributes(
    request_id: str,
    response: ReferenceReviewResponse,
    terminal_outcome: str | None = None,
) -> dict[str, str]:
    attributes = {
        "agentlens.maf.request_id": request_id,
        "agentlens.maf.response_type": type(response).__name__,
        "agentlens.maf.terminal_outcome": terminal_outcome or ("continued" if response.approved else "alternative"),
    }
    if response.delivery_id:
        attributes["agentlens.maf.delivery_id"] = response.delivery_id
    return attributes
