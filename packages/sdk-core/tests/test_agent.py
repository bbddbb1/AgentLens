"""
Tests for AgentInstrumentor — span events and attributes recording.
"""
import pytest
from unittest.mock import MagicMock, call, ANY

from agentlens_sdk.agent import AgentInstrumentor


class TestAgentInstrumentor:
    def _make_agent(self, **overrides):
        tracer = MagicMock()
        mock_span = MagicMock()
        tracer.start_span.return_value = mock_span

        agent = AgentInstrumentor(
            tracer=tracer,
            mission_id=overrides.get("mission_id", "m1"),
            agent_id=overrides.get("agent_id", "a1"),
            agent_name=overrides.get("agent_name", "TestAgent"),
            agent_role=overrides.get("agent_role", "worker"),
            agent_team=overrides.get("agent_team", None),
            framework=overrides.get("framework", "langgraph"),
        )
        return agent, tracer, mock_span

    # --- Context Manager ---

    def test_enter_starts_span_with_correct_name(self):
        agent, tracer, span = self._make_agent()
        agent.__enter__()
        tracer.start_span.assert_called_once()
        assert tracer.start_span.call_args[1]["name"] == "agent:TestAgent"

    def test_enter_sets_attributes(self):
        agent, tracer, span = self._make_agent()
        agent.__enter__()
        attrs = tracer.start_span.call_args[1]["attributes"]
        assert attrs["gen_ai.workflow.id"] == "m1"
        assert attrs["gen_ai.agent.id"] == "a1"
        assert attrs["gen_ai.agent.name"] == "TestAgent"
        assert attrs["gen_ai.agent.role"] == "worker"
        assert attrs["gen_ai.agent.framework"] == "langgraph"
        assert attrs["agent.span.kind"] == "invoke_agent"

    def test_enter_includes_team_when_present(self):
        agent, tracer, span = self._make_agent(agent_team="core")
        agent.__enter__()
        attrs = tracer.start_span.call_args[1]["attributes"]
        assert attrs["gen_ai.agent.team"] == "core"

    def test_enter_excludes_team_when_none(self):
        agent, tracer, span = self._make_agent(agent_team=None)
        agent.__enter__()
        attrs = tracer.start_span.call_args[1]["attributes"]
        assert "gen_ai.agent.team" not in attrs

    def test_exit_success_path(self):
        agent, tracer, span = self._make_agent()
        agent.__enter__()
        agent.__exit__(None, None, None)

        span.set_status.assert_called()
        span.end.assert_called_once()

    def test_exit_error_path(self):
        agent, tracer, span = self._make_agent()
        agent.__enter__()
        agent.__exit__(ValueError, ValueError("boom"), None)

        span.set_status.assert_called()
        span.end.assert_called_once()

    # --- Setters ---

    def test_set_confidence(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.set_confidence(0.95)
        span.set_attribute.assert_called_with("gen_ai.agent.confidence", "0.95")

    def test_set_goal(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.set_goal("Analyze data")
        span.set_attribute.assert_called_with("gen_ai.agent.goal", "Analyze data")

    def test_set_task(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.set_task("Fetch papers")
        span.set_attribute.assert_called_with("gen_ai.agent.task", "Fetch papers")

    def test_setters_do_nothing_when_no_span(self):
        agent, _, _ = self._make_agent()
        agent.set_confidence(0.5)
        agent.set_goal("goal")
        agent.set_task("task")

    # --- Record Methods ---

    def test_record_handoff(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_handoff("researcher", "Find papers", "need help")

        span.add_event.assert_called_with("agent.handoff.requested", {
            "gen_ai.agent.handoff.target": "researcher",
            "gen_ai.agent.task": "Find papers",
            "gen_ai.agent.handoff.reason": "need help",
        })

    def test_record_delegation_calls_handoff(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_delegation("writer", "Draft", "reason")
        span.add_event.assert_called_with("agent.handoff.requested", ANY)

    def test_record_critique(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_critique("writer", "needs_revision", "missing sources")
        span.add_event.assert_called_with("agent.critique", {
            "gen_ai.agent.critique.target": "writer",
            "gen_ai.agent.critique.result": "needs_revision",
            "critique.details": "missing sources",
        })

    def test_record_review_approved(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_review("approved", "looks good")
        span.add_event.assert_called_with("agent.review.approved", ANY)

    def test_record_review_changes_requested(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_review("changes_requested", "fix typos")
        span.add_event.assert_called_with("agent.review.changes_requested", ANY)

    def test_record_review_rejected(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_review("rejected", "not acceptable")
        span.add_event.assert_called_with("agent.review.rejected", ANY)

    def test_record_review_unknown_defaults_to_generic(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_review("unknown_verdict")
        span.add_event.assert_called_with("agent.review", ANY)

    def test_record_tool_call(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_tool_call("web_search", {"query": "AI"}, "results")

        call_args = span.add_event.call_args
        assert call_args[0][0] == "agent.tool.call"
        assert call_args[0][1]["gen_ai.tool.name"] == "web_search"
        assert call_args[0][1]["gen_ai.tool.status"] == "success"

    def test_record_tool_call_preserves_full_input(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        long_input = "x" * 2000
        agent.record_tool_call("big_tool", long_input, None)
        call_args = span.add_event.call_args
        assert call_args[0][1]["gen_ai.tool.input"] == long_input

    def test_record_tool_call_with_error_status(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_tool_call("broken_tool", None, None, status="error")
        call_args = span.add_event.call_args
        assert call_args[0][1]["gen_ai.tool.status"] == "error"

    def test_record_memory_write(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_memory_write("shared_key")
        span.add_event.assert_called_with("agent.memory.write", {
            "gen_ai.agent.memory.key": "shared_key",
            "gen_ai.agent.memory.operation": "write",
        })

    def test_record_memory_read(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_memory_read("shared_key")
        span.add_event.assert_called_with("agent.memory.read", {
            "gen_ai.agent.memory.key": "shared_key",
            "gen_ai.agent.memory.operation": "read",
        })

    def test_record_escalation(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_escalation("human_reviewer", "needs approval")
        span.add_event.assert_called_with("agent.escalation", {
            "gen_ai.agent.escalation.target": "human_reviewer",
            "gen_ai.agent.escalation.reason": "needs approval",
        })

    def test_record_reflection(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_reflection("I should use better sources")
        span.add_event.assert_called_with("agent.reflection", {
            "reflection.insight": "I should use better sources",
        })

    def test_record_artifact(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_artifact("report.pdf", "document")
        span.add_event.assert_called_with("agent.artifact.created", {
            "artifact.name": "report.pdf",
            "artifact.type": "document",
        })

    def test_request_human_review(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        result = agent.request_human_review("Need approval for deploy")

        assert result["interrupt_id"] is not None
        assert result["resume_token"] is not None
        assert result["reason"] == "Need approval for deploy"
        assert result["required_review"] is True

        assert span.add_event.call_count >= 2
        event_names = [call[0][0] for call in span.add_event.call_args_list]
        assert "agent.interrupt.requested" in event_names
        assert "agent.escalation" in event_names
        interrupt_attrs = next(
            call[0][1] for call in span.add_event.call_args_list
            if call[0][0] == "agent.interrupt.requested"
        )
        assert "gen_ai.agent.resume.token" not in interrupt_attrs
        assert result["resume_token"] not in str(interrupt_attrs)

    def test_request_human_review_with_custom_ids(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        result = agent.request_human_review(
            "Check this",
            interrupt_id="int-123",
            resume_token="tok-456",
            resume_url="http://example.com/resume",
            timeout_at="2026-06-01T00:00:00Z",
            required_review=False,
        )

        assert result["interrupt_id"] == "int-123"
        assert result["resume_token"] == "tok-456"
        assert result["required_review"] is False

    def test_request_human_review_raises_without_span(self):
        agent, _, _ = self._make_agent()
        with pytest.raises(RuntimeError, match="requires an active agent span"):
            agent.request_human_review("boom")

    def test_record_human_decision(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_human_decision("approve", comment="Looks good", interrupt_id="int-1")

        # Check the human.decision event
        calls = span.add_event.call_args_list
        decision_call = calls[0]
        assert decision_call[0][0] == "agent.human.decision"
        assert decision_call[0][1]["gen_ai.agent.human.decision"] == "approve"
        assert decision_call[0][1]["gen_ai.agent.interrupt.id"] == "int-1"

        # Since decision is not "resume", only one add_event call
        assert len(calls) == 1

    def test_record_human_decision_resume_adds_extra_event(self):
        agent, _, span = self._make_agent()
        agent.__enter__()
        agent.record_human_decision("resume")

        calls = span.add_event.call_args_list
        assert len(calls) == 2
        assert calls[0][0][0] == "agent.human.decision"
        assert calls[1][0][0] == "agent.interrupt.resumed"

    def test_record_human_decision_no_span_does_nothing(self):
        agent, _, _ = self._make_agent()
        agent.record_human_decision("approve")

    def test_record_methods_noop_when_no_span(self):
        agent, _, _ = self._make_agent()
        # These should not raise
        agent.record_handoff("a", "t")
        agent.record_critique("a", "r")
        agent.record_review("approved")
        agent.record_tool_call("t")
        agent.record_memory_write("k")
        agent.record_memory_read("k")
        agent.record_escalation("h", "r")
        agent.record_reflection("i")
        agent.record_artifact("f.pdf")

    def test_agent_name_defaults_to_agent_id(self):
        tracer = MagicMock()
        mock_span = MagicMock()
        tracer.start_span.return_value = mock_span
        agent = AgentInstrumentor(
            tracer=tracer, mission_id="m1",
            agent_id="bot-42", agent_name="bot-42",
            agent_role="worker",
        )
        agent.__enter__()
        assert agent.agent_name == "bot-42"
