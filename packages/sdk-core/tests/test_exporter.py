"""
Tests for the OTLP JSON exporter encoding and export logic.
"""
import pytest
from unittest.mock import MagicMock, patch, ANY

from agentlens_sdk.exporter import (
    _encode_scalar,
    _encode_attribute_value,
    _encode_attributes,
    _status_code_to_otlp,
    _normalize_traces_endpoint,
    AgentLensOtlpJsonExporter,
    AgentLensExporter,
)


class TestNormalizeTracesEndpoint:
    def test_passes_through_traces_endpoint(self):
        assert _normalize_traces_endpoint("http://localhost:8001/v1/traces") == "http://localhost:8001/v1/traces"

    def test_converts_ingest_otlp_to_traces(self):
        result = _normalize_traces_endpoint("http://localhost:8001/api/v1/ingest/otlp")
        assert result == "http://localhost:8001/v1/traces"

    def test_appends_traces_to_base_url(self):
        assert _normalize_traces_endpoint("http://localhost:8001") == "http://localhost:8001/v1/traces"


class TestEncodeScalar:
    def test_bool_true(self):
        assert _encode_scalar(True) == {"boolValue": True}

    def test_bool_false(self):
        assert _encode_scalar(False) == {"boolValue": False}

    def test_int(self):
        assert _encode_scalar(42) == {"intValue": "42"}

    def test_int_zero(self):
        assert _encode_scalar(0) == {"intValue": "0"}

    def test_negative_int(self):
        assert _encode_scalar(-5) == {"intValue": "-5"}

    def test_float(self):
        assert _encode_scalar(3.14) == {"doubleValue": 3.14}

    def test_string(self):
        assert _encode_scalar("hello") == {"stringValue": "hello"}

    def test_string_of_non_string_types(self):
        assert _encode_scalar(None) == {"stringValue": "None"}


class TestEncodeAttributeValue:
    def test_scalar_value(self):
        assert _encode_attribute_value(42) == {"intValue": "42"}

    def test_list_value(self):
        result = _encode_attribute_value([1, "two", True])
        assert result == {
            "arrayValue": {
                "values": [
                    {"intValue": "1"},
                    {"stringValue": "two"},
                    {"boolValue": True},
                ]
            }
        }

    def test_tuple_value(self):
        result = _encode_attribute_value((1, 2))
        assert result == {
            "arrayValue": {
                "values": [
                    {"intValue": "1"},
                    {"intValue": "2"},
                ]
            }
        }


class TestEncodeAttributes:
    def test_empty(self):
        assert _encode_attributes({}) == []

    def test_none(self):
        assert _encode_attributes(None) == []

    def test_single_attribute(self):
        result = _encode_attributes({"key": "value"})
        assert result == [{"key": "key", "value": {"stringValue": "value"}}]

    def test_multiple_attributes(self):
        result = _encode_attributes({"a": 1, "b": True})
        assert len(result) == 2


class TestStatusCodeToOtlp:
    def test_ok(self):
        from opentelemetry.trace import StatusCode
        assert _status_code_to_otlp(StatusCode.OK) == 1

    def test_error(self):
        from opentelemetry.trace import StatusCode
        assert _status_code_to_otlp(StatusCode.ERROR) == 2

    def test_unset(self):
        from opentelemetry.trace import StatusCode
        assert _status_code_to_otlp(StatusCode.UNSET) == 0


class TestAgentLensOtlpJsonExporter:
    """Tests for span export and serialization."""

    def _make_mock_span(self, **overrides):
        """Build a mock ReadableSpan for testing serialization."""
        span = MagicMock()
        span.context.trace_id = overrides.get("trace_id", 12345)
        span.context.span_id = overrides.get("span_id", 67890)
        span.parent = overrides.get("parent", None)
        span.name = overrides.get("name", "test-span")
        span.start_time = overrides.get("start_time", 1_000_000_000)
        span.end_time = overrides.get("end_time", 2_000_000_000)
        span.attributes = overrides.get("attributes", {})
        span.events = overrides.get("events", [])
        span.status.status_code = overrides.get("status_code", None)
        span.status.description = overrides.get("status_description", "")
        span.resource = MagicMock()
        span.resource.attributes = overrides.get("resource_attrs", {})
        span.instrumentation_scope = MagicMock()
        span.instrumentation_scope.name = overrides.get("scope_name", "test-scope")
        span.instrumentation_scope.version = overrides.get("scope_version", "1.0.0")
        return span

    def test_constructor_normalizes_endpoint(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        assert exporter.endpoint == "http://localhost:8001/v1/traces"

    def test_constructor_with_api_key(self):
        exporter = AgentLensOtlpJsonExporter(
            endpoint="http://localhost:8001/v1/traces", api_key="secret"
        )
        assert "Bearer secret" in exporter._headers()["Authorization"]

    def test_constructor_without_api_key(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        assert "Authorization" not in exporter._headers()

    def test_export_empty_spans(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        from opentelemetry.sdk.trace.export import SpanExportResult
        assert exporter.export([]) == SpanExportResult.SUCCESS

    def test_export_success(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001/v1/traces")
        span = self._make_mock_span()
        from opentelemetry.sdk.trace.export import SpanExportResult

        mock_response = MagicMock()
        mock_response.status_code = 200
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            result = exporter.export([span])

        assert result == SpanExportResult.SUCCESS

    def test_export_http_failure(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001/v1/traces")
        span = self._make_mock_span()
        from opentelemetry.sdk.trace.export import SpanExportResult

        mock_response = MagicMock()
        mock_response.status_code = 500
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            result = exporter.export([span])

        assert result == SpanExportResult.FAILURE

    def test_export_exception_returns_failure(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001/v1/traces")
        span = self._make_mock_span()
        from opentelemetry.sdk.trace.export import SpanExportResult

        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.side_effect = Exception("Connection refused")
            result = exporter.export([span])

        assert result == SpanExportResult.FAILURE

    def test_serialize_span_basic_fields(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")

        span = self._make_mock_span(
            trace_id=0xABCDEF,
            span_id=0x123456,
            name="agent:test-agent",
            start_time=1_000_000_000,
            end_time=2_000_000_000,
        )

        mock_response = MagicMock(status_code=200)
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            exporter.export([span])

        call_args = mock_client.post.call_args
        payload = call_args[1]["json"]
        resource_spans = payload["resourceSpans"]
        assert len(resource_spans) == 1
        scope_spans = resource_spans[0]["scopeSpans"]
        assert len(scope_spans) == 1
        serialized = scope_spans[0]["spans"][0]
        assert serialized["traceId"] == format(0xABCDEF, "032x")
        assert serialized["spanId"] == format(0x123456, "016x")

    def test_serialize_span_with_parent(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        parent_mock = MagicMock()
        parent_mock.span_id = 0xDEAD
        span = self._make_mock_span(parent=parent_mock)

        mock_response = MagicMock(status_code=200)
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            exporter.export([span])

        payload = mock_client.post.call_args[1]["json"]
        serialized = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        assert serialized["parentSpanId"] == format(0xDEAD, "016x")

    def test_serialize_span_without_parent(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        span = self._make_mock_span(parent=None)

        mock_response = MagicMock(status_code=200)
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            exporter.export([span])

        payload = mock_client.post.call_args[1]["json"]
        serialized = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        assert serialized["parentSpanId"] == ""

    def test_serialize_span_with_events(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")

        mock_event = MagicMock()
        mock_event.name = "test.event"
        mock_event.timestamp = 1_500_000_000
        mock_event.attributes = {"event.key": "event.value"}

        span = self._make_mock_span(events=[mock_event])

        mock_response = MagicMock(status_code=200)
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            exporter.export([span])

        payload = mock_client.post.call_args[1]["json"]
        serialized = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        assert len(serialized["events"]) == 1
        assert serialized["events"][0]["name"] == "test.event"

    def test_serialize_span_attributes(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        span = self._make_mock_span(attributes={"agent.id": "agent-1", "count": 42})

        mock_response = MagicMock(status_code=200)
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            exporter.export([span])

        payload = mock_client.post.call_args[1]["json"]
        serialized = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        assert len(serialized["attributes"]) == 2

    def test_groups_spans_by_resource(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")

        span_a = self._make_mock_span(
            trace_id=1, span_id=1, resource_attrs={"service.name": "svc-a"}
        )
        span_b = self._make_mock_span(
            trace_id=2, span_id=2, resource_attrs={"service.name": "svc-b"}
        )

        mock_response = MagicMock(status_code=200)
        with patch.object(exporter, '_client') as mock_client:
            mock_client.post.return_value = mock_response
            exporter.export([span_a, span_b])

        payload = mock_client.post.call_args[1]["json"]
        assert len(payload["resourceSpans"]) == 2

    def test_force_flush(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        assert exporter.force_flush() is True

    def test_shutdown_closes_client(self):
        exporter = AgentLensOtlpJsonExporter(endpoint="http://localhost:8001")
        with patch.object(exporter, '_client') as mock_client:
            exporter.shutdown()
            mock_client.close.assert_called_once()


class TestAgentLensExporterDeprecated:
    def test_deprecation_warning(self):
        with pytest.warns(DeprecationWarning, match="deprecated"):
            AgentLensExporter(endpoint="http://localhost:8001")
