"""
Tests for the LangGraph callback handler.
"""
import uuid
from unittest.mock import MagicMock, patch, ANY

import pytest

from agentlens_langgraph.instrumentor import (
    auto_instrument,
    AgentLensLangGraphCallbackHandler,
)
from agentlens_sdk.mission import Mission
from agentlens_sdk.agent import AgentInstrumentor


class TestAutoInstrument:
    def test_returns_lens_mission_handler_tuple(self):
        with patch("agentlens_langgraph.instrumentor.AgentLens") as mock_lens_cls:
            mock_lens = MagicMock()
            mock_mission = MagicMock(spec=Mission)
            mock_lens_cls.return_value = mock_lens
            mock_lens.mission.return_value = mock_mission

            lens, mission, handler = auto_instrument("Research AI")

            assert lens is mock_lens
            assert mission is mock_mission
            assert isinstance(handler, AgentLensLangGraphCallbackHandler)
            mock_lens.mission.assert_called_with("Research AI", mission_id=None)


class TestAgentLensLangGraphCallbackHandler:
    def _make_handler(self):
        lens = MagicMock()
        mission = MagicMock(spec=Mission)
        return AgentLensLangGraphCallbackHandler(lens, mission), lens, mission

    def _make_mock_agent(self):
        agent = MagicMock(spec=AgentInstrumentor)
        agent._span = MagicMock()
        return agent

    # --- should_ignore_node ---

    @pytest.mark.parametrize("node_name", [
        "LangGraph", "RunnableSequence", "RunnableParallel", "StateGraph",
    ])
    def test_should_ignore_framework_nodes(self, node_name):
        handler, _, _ = self._make_handler()
        assert handler._should_ignore_node(node_name) is True

    def test_should_not_ignore_custom_nodes(self):
        handler, _, _ = self._make_handler()
        assert handler._should_ignore_node("researcher") is False
        assert handler._should_ignore_node("writer") is False

    # --- on_chain_start ---

    def test_on_chain_start_creates_agent(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        mission.agent.return_value = mock_agent

        run_id = uuid.uuid4()
        handler.on_chain_start(
            serialized={"name": "researcher"},
            inputs={"task": "find"},
            run_id=run_id,
        )

        mission.agent.assert_called_once_with(
            agent_id="researcher", role="researcher", name="researcher"
        )

    def test_on_chain_start_uses_metadata_langgraph_node(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        mission.agent.return_value = mock_agent

        run_id = uuid.uuid4()
        handler.on_chain_start(
            serialized={"name": "ignored"},
            inputs={},
            run_id=run_id,
            metadata={"langgraph_node": "supervisor"},
        )

        mission.agent.assert_called_once_with(
            agent_id="supervisor", role="supervisor", name="supervisor"
        )

    def test_on_chain_start_ignores_framework_nodes(self):
        handler, lens, mission = self._make_handler()
        run_id = uuid.uuid4()
        handler.on_chain_start(
            serialized={"name": "LangGraph"},
            inputs={},
            run_id=run_id,
        )
        mission.agent.assert_not_called()

    def test_on_chain_start_handles_parent_handoff(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        mission.agent.return_value = mock_agent

        parent_run_id = uuid.uuid4()
        run_id = uuid.uuid4()

        # Register a parent agent first
        parent_agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = parent_agent

        handler.on_chain_start(
            serialized={"name": "researcher"},
            inputs={},
            run_id=run_id,
            parent_run_id=parent_run_id,
        )

        parent_agent._span.add_event.assert_called_with(
            "agent.handoff.requested",
            {
                "agent.handoff.target": "researcher",
                "agent.handoff.reason": "langgraph.chain_start",
            },
        )

    def test_on_chain_start_sets_task(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        mission.agent.return_value = mock_agent

        run_id = uuid.uuid4()
        handler.on_chain_start(
            serialized={"name": "researcher"},
            inputs={},
            run_id=run_id,
        )

        mock_agent.set_task.assert_called_with("researcher")

    def test_on_chain_start_records_memory_read_with_inputs(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        mission.agent.return_value = mock_agent

        run_id = uuid.uuid4()
        handler.on_chain_start(
            serialized={"name": "researcher"},
            inputs={"query": "AI papers"},
            run_id=run_id,
        )

        mock_agent.record_memory_read.assert_called()

    # --- on_chain_end ---

    def test_on_chain_end_closes_agent(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        run_id = uuid.uuid4()
        handler._active_agents[run_id] = mock_agent
        handler._node_names[run_id] = "researcher"

        handler.on_chain_end(outputs={}, run_id=run_id)

        mock_agent.__exit__.assert_called_with(None, None, None)

    def test_on_chain_end_records_memory_write_with_outputs(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        run_id = uuid.uuid4()
        handler._active_agents[run_id] = mock_agent
        handler._node_names[run_id] = "researcher"

        handler.on_chain_end(outputs={"result": "done"}, run_id=run_id)

        mock_agent.record_memory_write.assert_called()

    def test_on_chain_end_cleans_up_tracking(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        run_id = uuid.uuid4()
        handler._active_agents[run_id] = mock_agent
        handler._node_names[run_id] = "researcher"

        handler.on_chain_end(outputs={}, run_id=run_id)

        assert run_id not in handler._active_agents
        assert run_id not in handler._node_names

    def test_on_chain_end_handles_parent_handoff_accepted(self):
        handler, lens, mission = self._make_handler()
        parent_run_id = uuid.uuid4()
        child_run_id = uuid.uuid4()

        parent_agent = self._make_mock_agent()
        child_agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = parent_agent
        handler._active_agents[child_run_id] = child_agent
        handler._node_names[child_run_id] = "researcher"
        handler._parent_runs[child_run_id] = parent_run_id

        handler.on_chain_end(outputs={}, run_id=child_run_id)

        parent_agent._span.add_event.assert_called_with(
            "agent.handoff.accepted",
            {
                "agent.handoff.target": "researcher",
                "agent.handoff.reason": "langgraph.chain_end",
            },
        )

    # --- on_chain_error ---

    def test_on_chain_error_closes_agent_with_error(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        run_id = uuid.uuid4()
        handler._active_agents[run_id] = mock_agent
        handler._node_names[run_id] = "researcher"

        error = ValueError("task failed")
        handler.on_chain_error(error, run_id=run_id)

        mock_agent.__exit__.assert_called_once()
        args = mock_agent.__exit__.call_args
        assert args[0][0] == ValueError
        assert args[0][1] is error

    def test_on_chain_error_handles_parent_rejection(self):
        handler, lens, mission = self._make_handler()
        parent_run_id = uuid.uuid4()
        child_run_id = uuid.uuid4()

        parent_agent = self._make_mock_agent()
        child_agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = parent_agent
        handler._active_agents[child_run_id] = child_agent
        handler._node_names[child_run_id] = "researcher"
        handler._parent_runs[child_run_id] = parent_run_id

        error = ValueError("boom")
        handler.on_chain_error(error, run_id=child_run_id)

        parent_agent._span.add_event.assert_called_with(
            "agent.handoff.rejected",
            {
                "agent.handoff.target": "researcher",
                "agent.handoff.reason": "boom",
            },
        )

    def test_on_chain_error_removes_tracking(self):
        handler, lens, mission = self._make_handler()
        mock_agent = self._make_mock_agent()
        run_id = uuid.uuid4()
        handler._active_agents[run_id] = mock_agent
        handler._node_names[run_id] = "researcher"

        handler.on_chain_error(ValueError("err"), run_id=run_id)

        assert run_id not in handler._active_agents
        assert run_id not in handler._node_names

    # --- on_tool_start ---

    def test_on_tool_start_records_tool_event(self):
        handler, lens, mission = self._make_handler()
        parent_run_id = uuid.uuid4()
        agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = agent

        run_id = uuid.uuid4()
        handler.on_tool_start(
            serialized={"name": "web_search"},
            input_str='{"query": "AI"}',
            run_id=run_id,
            parent_run_id=parent_run_id,
        )

        agent._span.add_event.assert_called_with("agent.tool.call", {
            "agent.tool.name": "web_search",
            "agent.tool.status": "active",
            "agent.tool.input": '{"query": "AI"}',
        })

    def test_on_tool_start_without_parent_agent_does_nothing(self):
        handler, lens, mission = self._make_handler()
        run_id = uuid.uuid4()
        handler.on_tool_start(
            serialized={"name": "web_search"},
            input_str="input",
            run_id=run_id,
        )

    def test_on_tool_start_unknown_tool_name(self):
        handler, lens, mission = self._make_handler()
        parent_run_id = uuid.uuid4()
        agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = agent

        run_id = uuid.uuid4()
        handler.on_tool_start(
            serialized={},
            input_str="input",
            run_id=run_id,
            parent_run_id=parent_run_id,
        )

        call_args = agent._span.add_event.call_args
        assert call_args[0][1]["agent.tool.name"] == "unknown_tool"

    # --- on_tool_end ---

    def test_on_tool_end_records_completion(self):
        handler, lens, mission = self._make_handler()
        parent_run_id = uuid.uuid4()
        agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = agent
        run_id = uuid.uuid4()
        handler._tool_names[run_id] = "web_search"

        handler.on_tool_end(output="results", run_id=run_id, parent_run_id=parent_run_id)

        agent.record_tool_call.assert_called_with(tool_name="web_search", tool_output="results")

    def test_on_tool_end_without_agent(self):
        handler, lens, mission = self._make_handler()
        handler.on_tool_end(output="results", run_id=uuid.uuid4())

    # --- on_tool_error ---

    def test_on_tool_error_records_failure(self):
        handler, lens, mission = self._make_handler()
        parent_run_id = uuid.uuid4()
        agent = self._make_mock_agent()
        handler._active_agents[parent_run_id] = agent
        run_id = uuid.uuid4()
        handler._tool_names[run_id] = "web_search"

        handler.on_tool_error(
            ValueError("timeout"),
            run_id=run_id,
            parent_run_id=parent_run_id,
        )

        agent.record_tool_call.assert_called_with(tool_name="web_search", status="error")

    def test_on_tool_error_without_agent(self):
        handler, lens, mission = self._make_handler()
        handler.on_tool_error(ValueError("err"), run_id=uuid.uuid4())
