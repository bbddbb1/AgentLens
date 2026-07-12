"""Real MAF OpenTelemetry capture helpers for fixtures and focused tests."""

import asyncio
from contextlib import contextmanager
from typing import Any, Iterator

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult, SpanExporter

from .reference_runtime import create_reference_workflow


class CapturingSpanExporter(SpanExporter):
    """Small local capture exporter; never used as the full-stack harness."""

    def __init__(self) -> None:
        self.spans: list[Any] = []

    def export(self, spans: tuple[Any, ...]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        return None


@contextmanager
def real_span_capture() -> Iterator[CapturingSpanExporter]:
    """Temporarily install a real SDK provider without leaking global test state."""
    exporter = CapturingSpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    # OpenTelemetry intentionally permits only one global provider. This is a
    # bounded test/fixture capture context that restores the prior provider.
    previous_provider = trace._TRACER_PROVIDER  # type: ignore[attr-defined]
    once = trace._TRACER_PROVIDER_SET_ONCE  # type: ignore[attr-defined]
    previous_done = once._done
    trace._TRACER_PROVIDER = provider  # type: ignore[attr-defined]
    once._done = True
    try:
        yield exporter
        provider.force_flush()
    finally:
        provider.shutdown()
        trace._TRACER_PROVIDER = previous_provider  # type: ignore[attr-defined]
        once._done = previous_done


def capture_reference_spans(value: str = "reference input") -> list[dict[str, object]]:
    """Run real MAF instrumentation and return a bounded native span baseline."""
    with real_span_capture() as exporter:
        asyncio.run(create_reference_workflow().run(value))
        return [
            {"name": span.name, "attributes": dict(span.attributes)}
            for span in exporter.spans
        ]
