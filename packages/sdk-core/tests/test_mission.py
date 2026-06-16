"""
Tests for Mission context manager.
"""
from unittest.mock import MagicMock, ANY

from agentlens_sdk.mission import Mission


class TestMission:
    def _make_mission(self, **overrides):
        tracer = MagicMock()
        mock_span = MagicMock()
        tracer.start_span.return_value = mock_span
        mission = Mission(
            tracer=tracer,
            mission_id=overrides.get("mission_id", "m1"),
            objective=overrides.get("objective", "Research AI trends"),
            framework=overrides.get("framework", "custom"),
            metadata=overrides.get("metadata", {"source": "test"}),
            branch_id=overrides.get("branch_id", None),
        )
        return mission, tracer, mock_span

    def test_enter_starts_mission_span(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        tracer.start_span.assert_called_once()
        name = tracer.start_span.call_args[1]["name"]
        assert "mission:" in name

    def test_enter_sets_mission_attributes(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        attrs = tracer.start_span.call_args[1]["attributes"]
        assert attrs["gen_ai.workflow.id"] == "m1"
        assert attrs["gen_ai.workflow.name"] == "Research AI trends"
        assert attrs["gen_ai.workflow.status"] == "active"
        assert attrs["gen_ai.workflow.phase"] == "planning"
        assert attrs["agent.span.kind"] == "mission"

    def test_enter_sets_branch_id_if_provided(self):
        mission, tracer, span = self._make_mission(branch_id="b123")
        mission.__enter__()
        attrs = tracer.start_span.call_args[1]["attributes"]
        assert attrs["gen_ai.workflow.branch_id"] == "b123"

    def test_enter_records_started_event(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        span.add_event.assert_called_with("mission.started")

    def test_truncates_long_objective_in_span_name(self):
        mission, tracer, span = self._make_mission(
            objective="A" * 100
        )
        mission.__enter__()
        name = tracer.start_span.call_args[1]["name"]
        assert len(name) <= 50 + len("mission:")

    def test_exit_success_path(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        mission.__exit__(None, None, None)

        span.set_status.assert_called()
        span.add_event.assert_called_with("mission.completed")
        span.set_attribute.assert_called_with("gen_ai.workflow.status", "completed")
        span.end.assert_called_once()

    def test_exit_failure_path(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        error = RuntimeError("something went wrong")
        mission.__exit__(RuntimeError, error, None)

        span.add_event.assert_called_with("mission.failed", ANY)
        span.set_attribute.assert_called_with("gen_ai.workflow.status", "failed")

    def test_set_phase(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        mission.set_phase("executing")
        span.set_attribute.assert_called_with("gen_ai.workflow.phase", "executing")
        span.add_event.assert_called_with("mission.phase.changed", {
            "gen_ai.workflow.phase": "executing",
        })

    def test_set_phase_does_nothing_without_span(self):
        mission, _, _ = self._make_mission()
        mission.set_phase("executing")

    def test_agent_creates_instrumentor(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        agent = mission.agent("researcher", role="researcher", name="R", team="search")
        assert agent.agent_id == "researcher"
        assert agent.agent_name == "R"
        assert agent.agent_role == "researcher"
        assert agent.agent_team == "search"

    def test_agent_name_defaults_to_agent_id(self):
        mission, tracer, span = self._make_mission()
        mission.__enter__()
        agent = mission.agent("bot-1")
        assert agent.agent_name == "bot-1"
