"""
Agent instrumentor - records agent activities as OpenTelemetry spans and events.
"""

from __future__ import annotations

import uuid
from typing import Any

from opentelemetry import trace
from opentelemetry.trace import Span, StatusCode, Tracer

from agentlens_otel_semconv.attributes import AgentAttributes, MissionAttributes
from agentlens_otel_semconv.events import AgentEvents
from agentlens_otel_semconv.frameworks import normalize_framework_name
from agentlens_otel_semconv.span_kinds import AgentSpanKind


class AgentInstrumentor:
    """
    Instruments a single agent's execution within a mission.

    Usage:
        with mission.agent("researcher", role="researcher") as agent:
            agent.record_tool_call("web_search", {"query": "AI safety"}, results)
            agent.record_handoff("writer", "Draft summary from findings")
    """

    def __init__(
        self,
        tracer: Tracer,
        mission_id: str,
        agent_id: str,
        agent_name: str,
        agent_role: str = "agent",
        agent_team: str | None = None,
        framework: str = "custom",
        **kwargs: Any,
    ):
        self._tracer = tracer
        self.mission_id = mission_id
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.agent_role = agent_role
        self.agent_team = agent_team
        self.framework = normalize_framework_name(framework)
        self._span: Span | None = None
        self._kwargs = kwargs

    def __enter__(self) -> AgentInstrumentor:
        attrs = {
            MissionAttributes.ID: self.mission_id,
            AgentAttributes.ID: self.agent_id,
            AgentAttributes.NAME: self.agent_name,
            AgentAttributes.ROLE: self.agent_role,
            AgentAttributes.FRAMEWORK: self.framework,
            "agent.span.kind": AgentSpanKind.AGENT_TASK,
        }
        if self.agent_team:
            attrs[AgentAttributes.TEAM] = self.agent_team

        self._span = self._tracer.start_span(
            name=f"agent:{self.agent_name}",
            attributes=attrs,
        )
        self._ctx = trace.use_span(self._span, end_on_exit=False)
        self._ctx.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._span:
            if exc_type:
                self._span.set_status(StatusCode.ERROR, str(exc_val))
            else:
                self._span.set_status(StatusCode.OK)
            self._ctx.__exit__(exc_type, exc_val, exc_tb)
            self._span.end()

    def set_confidence(self, confidence: float):
        """Set the agent's confidence score (0.0 to 1.0)."""
        if self._span:
            self._span.set_attribute(AgentAttributes.CONFIDENCE, str(confidence))

    def set_goal(self, goal: str):
        """Set the agent's current goal."""
        if self._span:
            self._span.set_attribute(AgentAttributes.GOAL, goal)

    def set_task(self, task: str):
        """Set the agent's current task description."""
        if self._span:
            self._span.set_attribute(AgentAttributes.TASK, task)

    def record_handoff(self, target_agent: str, task: str, reason: str = ""):
        """Record a handoff to another agent."""
        if self._span:
            self._span.add_event(AgentEvents.HANDOFF_REQUESTED, {
                AgentAttributes.HANDOFF_TARGET: target_agent,
                AgentAttributes.TASK: task,
                AgentAttributes.HANDOFF_REASON: reason,
            })

    def record_delegation(self, target_agent: str, task: str, reason: str = ""):
        """Legacy alias for record_handoff()."""
        self.record_handoff(target_agent, task, reason)

    def record_critique(self, target_agent: str, result: str, details: str = ""):
        """Record a critique of another agent's output."""
        if self._span:
            self._span.add_event(AgentEvents.CRITIQUE, {
                AgentAttributes.CRITIQUE_TARGET: target_agent,
                AgentAttributes.CRITIQUE_RESULT: result,
                "critique.details": details,
            })

    def record_review(self, result: str, details: str = ""):
        """Record a formal review result."""
        if self._span:
            event_name = {
                "approved": AgentEvents.REVIEW_APPROVED,
                "changes_requested": AgentEvents.REVIEW_CHANGES_REQUESTED,
                "rejected": AgentEvents.REVIEW_REJECTED,
            }.get(result, AgentEvents.REVIEW)

            self._span.add_event(event_name, {
                AgentAttributes.REVIEW_RESULT: result,
                "review.details": details,
            })

    def record_tool_call(
        self,
        tool_name: str,
        tool_input: Any = None,
        tool_output: Any = None,
        status: str = "success",
    ):
        """Record a tool invocation."""
        if self._span:
            attrs: dict[str, str] = {
                AgentAttributes.TOOL_NAME: tool_name,
                AgentAttributes.TOOL_STATUS: status,
            }
            if tool_input is not None:
                attrs[AgentAttributes.TOOL_INPUT] = str(tool_input)[:1000]
            if tool_output is not None:
                attrs[AgentAttributes.TOOL_OUTPUT] = str(tool_output)[:1000]

            self._span.add_event(AgentEvents.TOOL_CALL, attrs)

    def record_memory_write(self, key: str, value: Any = None):
        """Record a write to shared memory."""
        if self._span:
            attrs: dict[str, str] = {
                AgentAttributes.MEMORY_KEY: key,
                AgentAttributes.MEMORY_OPERATION: "write",
            }
            self._span.add_event(AgentEvents.MEMORY_WRITE, attrs)

    def record_memory_read(self, key: str, value: Any = None):
        """Record a read from shared memory."""
        if self._span:
            attrs: dict[str, str] = {
                AgentAttributes.MEMORY_KEY: key,
                AgentAttributes.MEMORY_OPERATION: "read",
            }
            self._span.add_event(AgentEvents.MEMORY_READ, attrs)

    def record_escalation(self, target: str, reason: str):
        """Record an escalation to human or supervisor."""
        if self._span:
            self._span.add_event(AgentEvents.ESCALATION, {
                AgentAttributes.ESCALATION_TARGET: target,
                AgentAttributes.ESCALATION_REASON: reason,
            })

    def record_reflection(self, insight: str):
        """Record an agent self-reflection."""
        if self._span:
            self._span.add_event(AgentEvents.REFLECTION, {
                "reflection.insight": insight,
            })

    def record_artifact(self, name: str, artifact_type: str = "document"):
        """Record that the agent produced an artifact."""
        if self._span:
            self._span.add_event(AgentEvents.ARTIFACT_CREATED, {
                "artifact.name": name,
                "artifact.type": artifact_type,
            })

    def request_human_review(
        self,
        reason: str,
        *,
        interrupt_id: str | None = None,
        resume_token: str | None = None,
        resume_url: str | None = None,
        timeout_at: str | None = None,
        required_review: bool = True,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Record a HITL interrupt request on the current agent span."""
        if not self._span:
            raise RuntimeError("request_human_review() requires an active agent span.")

        next_interrupt_id = interrupt_id or str(uuid.uuid4())
        next_resume_token = resume_token or f"{uuid.uuid4()}{uuid.uuid4()}"
        attrs: dict[str, str | bool] = {
            AgentAttributes.INTERRUPT_ID: next_interrupt_id,
            AgentAttributes.INTERRUPT_REASON: reason,
            AgentAttributes.RESUME_TOKEN: next_resume_token,
            AgentAttributes.POLICY_REQUIRED_REVIEW: required_review,
        }
        if resume_url:
            attrs[AgentAttributes.INTERRUPT_RESUME_URL] = resume_url
        if timeout_at:
            attrs[AgentAttributes.TIMEOUT_AT] = timeout_at
        if payload:
            for key, value in payload.items():
                attrs[f"interrupt.payload.{key}"] = str(value)[:500]

        self._span.add_event(AgentEvents.INTERRUPT_REQUESTED, attrs)
        self.record_escalation("human_reviewer", reason)
        return {
            "interrupt_id": next_interrupt_id,
            "resume_token": next_resume_token,
            "reason": reason,
            "required_review": required_review,
            "resume_url": resume_url,
            "timeout_at": timeout_at,
        }

    def record_human_decision(
        self,
        decision: str,
        *,
        comment: str = "",
        interrupt_id: str | None = None,
    ) -> None:
        """Record a human decision for a previously requested interrupt."""
        if not self._span:
            return

        attrs: dict[str, str] = {
            AgentAttributes.HUMAN_DECISION: decision,
        }
        if interrupt_id:
            attrs[AgentAttributes.INTERRUPT_ID] = interrupt_id
        if comment:
            attrs[AgentAttributes.HUMAN_INPUT] = comment[:1000]

        self._span.add_event(AgentEvents.HUMAN_DECISION, attrs)
        if decision == "resume":
            self._span.add_event(AgentEvents.INTERRUPT_RESUMED, attrs)
