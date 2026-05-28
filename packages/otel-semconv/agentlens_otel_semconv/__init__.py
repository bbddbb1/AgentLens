"""
AgentLens OpenTelemetry Semantic Conventions for Multi-Agent Systems.

Defines standardized attribute keys, event names, and span kinds
for instrumenting multi-agent frameworks with OpenTelemetry.
"""

from agentlens_otel_semconv.attributes import AgentAttributes, MissionAttributes, LLMAttributes, ErrorAttributes
from agentlens_otel_semconv.frameworks import Frameworks, normalize_framework_name
from agentlens_otel_semconv.events import AgentEvents
from agentlens_otel_semconv.span_kinds import AgentSpanKind

__all__ = [
    "AgentAttributes",
    "MissionAttributes",
    "LLMAttributes",
    "ErrorAttributes",
    "AgentEvents",
    "AgentSpanKind",
    "Frameworks",
    "normalize_framework_name",
]
