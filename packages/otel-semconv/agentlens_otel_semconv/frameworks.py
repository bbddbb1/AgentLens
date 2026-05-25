"""
Canonical framework identifiers for multi-agent OpenTelemetry instrumentation.

These values are used in the `agent.framework` and `mission.framework`
attributes so adapters for LangGraph, AutoGen, CrewAI, and future frameworks
emit the same semantic convention.
"""

from agentlens_otel_semconv.span_kinds import Frameworks, normalize_framework_name

__all__ = ["Frameworks", "normalize_framework_name"]