"""Native OpenTelemetry capture helpers for the MAF reference workflow."""

import asyncio

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from .reference_runtime import create_reference_workflow


def capture_reference_spans(value: str = "reference input") -> list[dict[str, object]]:
    """Run real MAF instrumentation and return a bounded native span baseline."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    asyncio.run(create_reference_workflow().run(value))
    return [
        {"name": span.name, "attributes": dict(span.attributes)}
        for span in exporter.get_finished_spans()
    ]
