"""
Mission context —Represents a single multi-agent objective execution.
"""

from __future__ import annotations

from typing import Any

from opentelemetry import trace
from opentelemetry.trace import Tracer, Span, StatusCode

from agentlens_otel_semconv.attributes import MissionAttributes, AgentAttributes
from agentlens_otel_semconv.events import AgentEvents
from agentlens_otel_semconv.frameworks import normalize_framework_name
from agentlens_otel_semconv.span_kinds import AgentSpanKind
from agentlens_sdk.agent import AgentInstrumentor


class Mission:
    """
    Represents a mission —one complete multi-agent objective execution.

    Usage:
        with lens.mission("Research report") as mission:
            with mission.agent("planner", role="planner") as planner:
                planner.record_delegation("researcher", "Find data")
    """

    def __init__(
        self,
        tracer: Tracer,
        mission_id: str,
        objective: str,
        framework: str = "custom",
        metadata: dict[str, Any] | None = None,
        branch_id: str | None = None,
        lens: Any | None = None,
    ):
        self._tracer = tracer
        self._lens = lens
        self.mission_id = mission_id
        self.objective = objective
        self.framework = normalize_framework_name(framework)
        self.metadata = metadata or {}
        self.branch_id = branch_id
        self._span: Span | None = None

    def __enter__(self) -> Mission:
        self._span = self._tracer.start_span(
            name=f"mission:{self.objective[:50]}",
            attributes={
                MissionAttributes.ID: self.mission_id,
                MissionAttributes.OBJECTIVE: self.objective,
                MissionAttributes.STATUS: "active",
                MissionAttributes.PHASE: "planning",
                MissionAttributes.FRAMEWORK: self.framework,
                "agent.span.kind": AgentSpanKind.MISSION,
                **({MissionAttributes.BRANCH_ID: self.branch_id} if self.branch_id else {}),
            },
        )
        self._ctx = trace.use_span(self._span, end_on_exit=False)
        self._ctx.__enter__()
        self._span.add_event(AgentEvents.MISSION_STARTED)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._span:
            if exc_type:
                self._span.set_status(StatusCode.ERROR, str(exc_val))
                self._span.add_event(AgentEvents.MISSION_FAILED, {
                    "error.type": str(exc_type.__name__) if exc_type else "",
                    "error.message": str(exc_val) if exc_val else "",
                })
            else:
                self._span.set_status(StatusCode.OK)
                self._span.add_event(AgentEvents.MISSION_COMPLETED)

            self._span.set_attribute(MissionAttributes.STATUS, "completed" if not exc_type else "failed")
            self._ctx.__exit__(exc_type, exc_val, exc_tb)
            self._span.end()

    def agent(
        self,
        agent_id: str,
        role: str = "agent",
        name: str | None = None,
        team: str | None = None,
        **kwargs: Any,
    ) -> AgentInstrumentor:
        """Create an instrumented agent context within this mission."""
        return AgentInstrumentor(
            tracer=self._tracer,
            mission_id=self.mission_id,
            agent_id=agent_id,
            agent_name=name or agent_id,
            agent_role=role,
            agent_team=team,
            framework=self.framework,
            lens=self._lens,
            **kwargs,
        )

    def set_phase(self, phase: str):
        """Update the mission phase."""
        if self._span:
            self._span.set_attribute(MissionAttributes.PHASE, phase)
            self._span.add_event(AgentEvents.MISSION_PHASE_CHANGED, {
                MissionAttributes.PHASE: phase,
            })
