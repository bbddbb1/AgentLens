"""
LangGraph instrumentation callback handler.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID
import logging

from langchain_core.callbacks import BaseCallbackHandler

from agentlens_sdk.client import AgentLens
from agentlens_sdk.mission import Mission
from agentlens_sdk.agent import AgentInstrumentor
from agentlens_otel_semconv.attributes import AgentAttributes
from agentlens_otel_semconv.events import AgentEvents

logger = logging.getLogger("agentlens")


def auto_instrument(
    objective: str,
    *,
    endpoint: str = "http://localhost:8001",
    api_key: str | None = None,
    service_name: str = "agentlens-langgraph-app",
    mission_id: str | None = None,
    **metadata: Any,
) -> tuple[AgentLens, Mission, "AgentLensLangGraphCallbackHandler"]:
    """
    Create a native-OTLP AgentLens client, mission, and LangGraph callback handler.

    This keeps LangGraph integration to a small setup step while letting the backend
    receive standard OTLP spans at `/v1/traces`.
    """
    lens = AgentLens(
        endpoint=endpoint,
        api_key=api_key,
        service_name=service_name,
        framework="langgraph",
    )
    mission = lens.mission(objective, mission_id=mission_id, **metadata)
    handler = AgentLensLangGraphCallbackHandler(lens, mission)
    return lens, mission, handler

class AgentLensLangGraphCallbackHandler(BaseCallbackHandler):
    """
    Callback handler for LangGraph to automatically instrument
    nodes as agents and track data flow.
    """

    def __init__(self, lens: AgentLens, mission: Mission):
        self.lens = lens
        self.mission = mission
        self._active_agents: Dict[UUID, AgentInstrumentor] = {}
        self._node_names: Dict[UUID, str] = {}
        self._tool_names: Dict[UUID, str] = {}
        self._parent_runs: Dict[UUID, UUID] = {}

    def _should_ignore_node(self, node_name: str) -> bool:
        return node_name in {"LangGraph", "RunnableSequence", "RunnableParallel", "StateGraph"}

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        """Called when a LangGraph node starts."""
        serialized = serialized or {}
        metadata = metadata or {}

        node_name = metadata.get("langgraph_node")
        if not node_name:
            # Check tags for graph:step:node_name pattern
            if tags:
                for tag in tags:
                    if tag.startswith("graph:step:"):
                        node_name = tag.split(":")[-1]
                        break
            
            # Fallback to serialized name or ID
            if not node_name:
                node_name = serialized.get("name") or serialized.get("id")
        
        # Final fallback
        if not node_name:
            node_name = "unknown_node"

        if self._should_ignore_node(node_name):
            return

        if parent_run_id:
            self._parent_runs[run_id] = parent_run_id
            parent_agent = self._active_agents.get(parent_run_id)
            if parent_agent:
                parent_agent._span.add_event(
                    AgentEvents.HANDOFF_REQUESTED,
                    {
                        AgentAttributes.HANDOFF_TARGET: node_name,
                        AgentAttributes.HANDOFF_REASON: "langgraph.chain_start",
                    },
                )

        task = node_name
        goal = ""
        
        if getattr(self.lens, "_get_injection", None):
            injection = self.lens._get_injection("prompt_injection", target=f"agent:{node_name}")
            if injection and isinstance(injection, dict):
                task = injection.get("task", node_name)
                goal = injection.get("goal", "")
                logger.info(f"[AgentLens Sandbox] Injecting prompt override for agent {node_name}: task='{task}' goal='{goal}'")

        agent = self.mission.agent(
            agent_id=node_name,
            role=node_name,
            name=node_name,
        )
        agent.__enter__()
        self._active_agents[run_id] = agent
        self._node_names[run_id] = node_name

        agent.set_task(task)
        if goal:
            agent.set_goal(goal)

        if inputs:
            agent.record_memory_read(f"{node_name}.inputs", str(inputs)[:500])

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        """Called when a LangGraph node ends."""
        agent = self._active_agents.pop(run_id, None)
        node_name = self._node_names.pop(run_id, None)
        parent_run_id = self._parent_runs.pop(run_id, None)
        
        if agent:
            if outputs:
                name = node_name or "unknown_node"
                agent.record_memory_write(f"{name}.outputs", str(outputs)[:500])
            agent.__exit__(None, None, None)

        if parent_run_id:
            parent_agent = self._active_agents.get(parent_run_id)
            if parent_agent and node_name:
                parent_agent._span.add_event(
                    AgentEvents.HANDOFF_ACCEPTED,
                    {
                        AgentAttributes.HANDOFF_TARGET: node_name,
                        AgentAttributes.HANDOFF_REASON: "langgraph.chain_end",
                    },
                )

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._active_agents.pop(run_id, None)
        node_name = self._node_names.pop(run_id, None)
        parent_run_id = self._parent_runs.pop(run_id, None)
        
        if agent:
            agent.__exit__(type(error), error, getattr(error, '__traceback__', None))

        if parent_run_id:
            parent_agent = self._active_agents.get(parent_run_id)
            if parent_agent:
                parent_agent._span.add_event(
                    AgentEvents.HANDOFF_REJECTED,
                    {
                        AgentAttributes.HANDOFF_TARGET: node_name or "unknown_node",
                        AgentAttributes.HANDOFF_REASON: str(error)[:200],
                    },
                )

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        inputs: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        """Called when a tool starts."""
        agent = self._active_agents.get(parent_run_id) if parent_run_id else None
        tool_name = serialized.get("name", "unknown_tool")
        if run_id:
            self._tool_names[run_id] = tool_name
        if agent:
            agent._span.add_event(AgentEvents.TOOL_CALL, {
                AgentAttributes.TOOL_NAME: tool_name,
                AgentAttributes.TOOL_STATUS: "active",
                AgentAttributes.TOOL_INPUT: str(input_str)[:1000],
            })

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._active_agents.get(parent_run_id) if parent_run_id else None
        tool_name = self._tool_names.pop(run_id, "tool_call_completed")
        if agent:
            agent.record_tool_call(tool_name=tool_name, tool_output=str(output))

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._active_agents.get(parent_run_id) if parent_run_id else None
        tool_name = self._tool_names.pop(run_id, "tool_call_failed")
        if agent:
            agent.record_tool_call(tool_name=tool_name, status="error")
