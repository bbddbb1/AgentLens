"""
OTLP JSON exporter for AgentLens.
"""

from __future__ import annotations

import warnings
from collections import defaultdict
from typing import Any, Sequence

import httpx
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import StatusCode


def _normalize_traces_endpoint(endpoint: str) -> str:
    normalized = endpoint.rstrip("/")
    if normalized.endswith("/api/v1/ingest/otlp"):
        return f"{normalized[: -len('/api/v1/ingest/otlp')]}/v1/traces"
    if normalized.endswith("/v1/traces"):
        return normalized
    return f"{normalized}/v1/traces"


def _encode_scalar(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int) and not isinstance(value, bool):
        return {"intValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    return {"stringValue": str(value)}


def _encode_attribute_value(value: Any) -> dict[str, Any]:
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [_encode_scalar(item) for item in value]}}
    return _encode_scalar(value)


def _encode_attributes(attributes: dict[str, Any] | Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for key, value in (attributes or {}).items():
        result.append({
            "key": str(key),
            "value": _encode_attribute_value(value),
        })
    return result


def _status_code_to_otlp(status_code: StatusCode | Any) -> int:
    if status_code == StatusCode.OK:
        return 1
    if status_code == StatusCode.ERROR:
        return 2
    return 0


class AgentLensOtlpJsonExporter(SpanExporter):
    """
    Export spans to AgentLens as OTLP/HTTP JSON.

    AgentLens currently accepts OTLP JSON at `/v1/traces`, so this exporter
    emits the standard JSON shape rather than protobuf bytes.
    """

    def __init__(self, endpoint: str, api_key: str | None = None):
        self.endpoint = _normalize_traces_endpoint(endpoint)
        self.api_key = api_key
        self._client = httpx.Client(timeout=10.0)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _resource_key(self, span: ReadableSpan) -> tuple[tuple[str, str], ...]:
        attributes = getattr(getattr(span, "resource", None), "attributes", {}) or {}
        return tuple(sorted((str(key), str(value)) for key, value in attributes.items()))

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        if not spans:
            return SpanExportResult.SUCCESS

        resource_groups: dict[tuple[tuple[str, str], ...], list[ReadableSpan]] = defaultdict(list)
        for span in spans:
            resource_groups[self._resource_key(span)].append(span)

        resource_spans: list[dict[str, Any]] = []
        for resource_key, grouped_spans in resource_groups.items():
            first_span = grouped_spans[0]
            resource_attributes = getattr(getattr(first_span, "resource", None), "attributes", {}) or {}
            scope_groups: dict[tuple[str, str], list[ReadableSpan]] = defaultdict(list)
            for span in grouped_spans:
                scope = getattr(span, "instrumentation_scope", None)
                scope_name = getattr(scope, "name", "") or ""
                scope_version = getattr(scope, "version", "") or ""
                scope_groups[(scope_name, scope_version)].append(span)

            scope_spans: list[dict[str, Any]] = []
            for (scope_name, scope_version), scoped_spans in scope_groups.items():
                scope_spans.append({
                    "scope": {
                        "name": scope_name,
                        "version": scope_version,
                    },
                    "spans": [
                        {
                            "traceId": format(span.context.trace_id, "032x"),
                            "spanId": format(span.context.span_id, "016x"),
                            "parentSpanId": format(span.parent.span_id, "016x") if span.parent else "",
                            "name": span.name,
                            "startTimeUnixNano": str(span.start_time or 0),
                            "endTimeUnixNano": str(span.end_time or 0),
                            "attributes": _encode_attributes(span.attributes),
                            "events": [
                                {
                                    "name": event.name,
                                    "timeUnixNano": str(event.timestamp),
                                    "attributes": _encode_attributes(event.attributes),
                                }
                                for event in span.events
                            ],
                            "status": {
                                "code": _status_code_to_otlp(getattr(span.status, "status_code", None)),
                                "message": getattr(span.status, "description", "") or "",
                            },
                        }
                        for span in scoped_spans
                    ],
                })

            resource_spans.append({
                "resource": {
                    "attributes": _encode_attributes(resource_attributes),
                },
                "scopeSpans": scope_spans,
            })

        try:
            response = self._client.post(
                self.endpoint,
                json={"resourceSpans": resource_spans},
                headers=self._headers(),
            )
            return SpanExportResult.SUCCESS if response.status_code == 200 else SpanExportResult.FAILURE
        except Exception:
            return SpanExportResult.FAILURE

    def shutdown(self):
        self._client.close()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


class AgentLensExporter(AgentLensOtlpJsonExporter):
    """
    Backward-compatible exporter name.
    """

    def __init__(self, endpoint: str, api_key: str | None = None):
        warnings.warn(
            "AgentLensExporter is deprecated. Use the AgentLens OTLP JSON path at "
            "/v1/traces for new integrations.",
            DeprecationWarning,
            stacklevel=2,
        )
        super().__init__(endpoint=endpoint, api_key=api_key)
