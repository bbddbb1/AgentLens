"""
LangGraph instrumentation callback handler.

Preserves explicitly observable LangGraph-native facts in AgentLens OTLP
telemetry. Ordinary parent-child nesting is correlation only — handoff events
are emitted only from explicit handoff/delegation evidence.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID
import logging
import json

from langchain_core.callbacks import BaseCallbackHandler
from langgraph.errors import GraphInterrupt
from langgraph.types import Interrupt

from agentlens_sdk.client import AgentLens
from agentlens_sdk.mission import Mission
from agentlens_sdk.agent import AgentInstrumentor
from agentlens_otel_semconv.attributes import AgentAttributes, LLMAttributes
from agentlens_otel_semconv.events import AgentEvents

from agentlens_langgraph.native_attrs import (
    LangGraphNativeAttributes,
    derive_native_execution_key,
)

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


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _first_present(mapping: Dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return _as_str(mapping[key])
    return None


def _extract_native_identity(
    *,
    run_id: UUID | None,
    parent_run_id: UUID | None = None,
    metadata: Optional[Dict[str, Any]] = None,
    tags: Optional[List[str]] = None,
    kwargs: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    """Collect observational native identity from explicit callback facts only."""
    metadata = metadata or {}
    kwargs = kwargs or {}
    configurable = {}
    if isinstance(metadata.get("configurable"), dict):
        configurable = metadata["configurable"]
    elif isinstance(kwargs.get("configurable"), dict):
        configurable = kwargs["configurable"]

    identity: Dict[str, str] = {}
    if run_id is not None:
        run_s = str(run_id)
        identity[LangGraphNativeAttributes.RUN_ID] = run_s
        identity[LangGraphNativeAttributes.ACTIVITY_CORRELATION_ID] = run_s
    if parent_run_id is not None:
        identity[LangGraphNativeAttributes.PARENT_RUN_ID] = str(parent_run_id)

    thread_id = _first_present(
        metadata,
        "thread_id",
        "langgraph_thread_id",
    ) or _first_present(configurable, "thread_id")
    if thread_id:
        identity[LangGraphNativeAttributes.THREAD_ID] = thread_id

    checkpoint_id = _first_present(
        metadata,
        "checkpoint_id",
        "langgraph_checkpoint_id",
    ) or _first_present(configurable, "checkpoint_id")
    if checkpoint_id:
        identity[LangGraphNativeAttributes.CHECKPOINT_ID] = checkpoint_id

    checkpoint_ns = _first_present(
        metadata,
        "checkpoint_ns",
        "langgraph_checkpoint_ns",
    ) or _first_present(configurable, "checkpoint_ns")
    if checkpoint_ns:
        identity[LangGraphNativeAttributes.CHECKPOINT_NS] = checkpoint_ns

    interrupt_id = _first_present(
        metadata,
        "interrupt_id",
        "langgraph_interrupt_id",
        "interrupt_request_id",
    )
    if interrupt_id:
        identity[LangGraphNativeAttributes.INTERRUPT_REQUEST_ID] = interrupt_id

    resume_of = _first_present(
        metadata,
        "resume_of_interrupt_id",
        "langgraph_resume_of",
        "resumed_interrupt_id",
    )
    if resume_of:
        identity[LangGraphNativeAttributes.RESUME_OF_INTERRUPT_ID] = resume_of

    if tags:
        for tag in tags:
            if tag.startswith("resume_of:"):
                identity[LangGraphNativeAttributes.RESUME_OF_INTERRUPT_ID] = tag.split(":", 1)[1]
            elif tag.startswith("interrupt:"):
                identity[LangGraphNativeAttributes.INTERRUPT_REQUEST_ID] = tag.split(":", 1)[1]

    native_key = derive_native_execution_key(
        thread_id=identity.get(LangGraphNativeAttributes.THREAD_ID),
        run_id=identity.get(LangGraphNativeAttributes.RUN_ID),
        activity_correlation_id=identity.get(LangGraphNativeAttributes.ACTIVITY_CORRELATION_ID),
    )
    if native_key:
        identity[LangGraphNativeAttributes.NATIVE_EXECUTION_KEY] = native_key

    return identity


def _extract_explicit_handoff_target(
    metadata: Optional[Dict[str, Any]],
    outputs: Any = None,
) -> str | None:
    """Return handoff target only from explicit handoff/delegation evidence.

    Ordinary Command.goto / output goto / workflow routing / parent-child nesting
    are NOT treated as Agent handoff.
    """
    metadata = metadata or {}
    for key in (
        "langgraph_handoff",
        "handoff_to",
        "handoff_target",
        "explicit_handoff_target",
        "delegation_target",
        "explicit_handoff",
    ):
        value = metadata.get(key)
        if value is True:
            # Boolean marker without target is insufficient.
            continue
        if value:
            return _as_str(value)

    if isinstance(outputs, dict):
        for key in (
            "langgraph_handoff",
            "handoff_to",
            "handoff_target",
            "explicit_handoff_target",
            "delegation_target",
        ):
            value = outputs.get(key)
            if value:
                return _as_str(value)

    return None


def _extract_interrupt_payload(outputs: Any, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, str] | None:
    """Observe interrupt request identity from explicit native outputs/metadata only."""
    metadata = metadata or {}
    interrupt_id = _first_present(
        metadata,
        "interrupt_id",
        "langgraph_interrupt_id",
        "interrupt_request_id",
    )
    interrupt_value = None
    if isinstance(outputs, dict):
        interrupt_value = outputs.get("__interrupt__") or outputs.get("interrupt")
        if isinstance(interrupt_value, (list, tuple)) and interrupt_value:
            first = interrupt_value[0]
            if hasattr(first, "id") and not interrupt_id:
                interrupt_id = _as_str(getattr(first, "id", None))
            elif isinstance(first, dict) and not interrupt_id:
                interrupt_id = _as_str(first.get("id") or first.get("interrupt_id"))
            elif not interrupt_id:
                interrupt_id = _as_str(first)
        elif isinstance(interrupt_value, dict) and not interrupt_id:
            interrupt_id = _as_str(interrupt_value.get("id") or interrupt_value.get("interrupt_id"))
        elif interrupt_value is not None and not interrupt_id:
            interrupt_id = _as_str(interrupt_value)

    if interrupt_value is None and not interrupt_id:
        return None

    result: Dict[str, str] = {}
    if interrupt_id:
        result[LangGraphNativeAttributes.INTERRUPT_REQUEST_ID] = interrupt_id
        result[AgentAttributes.INTERRUPT_ID] = interrupt_id
    reason = _first_present(metadata, "interrupt_reason") or "langgraph.interrupt"
    result[AgentAttributes.INTERRUPT_REASON] = reason
    # Display-safe request facts only — never export complete interrupt values or control context.
    prompt = _first_present(metadata, "interrupt_prompt", "safe_prompt")
    if prompt:
        # Bound prompt length for display safety.
        result[LangGraphNativeAttributes.INTERRUPT_PROMPT] = str(prompt)[:500]
    request_type = _first_present(metadata, "interrupt_request_type", "request_type") or "interrupt"
    result[LangGraphNativeAttributes.INTERRUPT_REQUEST_TYPE] = str(request_type)
    supported = _first_present(metadata, "supported_decisions", "supported_decision_types")
    if supported:
        result[LangGraphNativeAttributes.SUPPORTED_DECISIONS] = (
            supported if isinstance(supported, str) else str(supported)
        )
    else:
        result[LangGraphNativeAttributes.SUPPORTED_DECISIONS] = '["approve","reject"]'
    return result


def _extract_interrupt_payload_from_error(
    error: BaseException,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, str] | None:
    """Observe LangGraph's native ``GraphInterrupt`` callback payload.

    LangGraph reports a node-level interrupt through ``on_chain_error`` and
    returns the same native interrupt in the root ``__interrupt__`` result.
    The adapter consumes the callback-owned exception facts here so callers do
    not have to replay a lifecycle callback from the root result.
    """
    if not isinstance(error, GraphInterrupt):
        return None
    if len(error.args) != 1 or not isinstance(error.args[0], (list, tuple)):
        return None
    native_interrupts = error.args[0]
    if (
        not native_interrupts
        or not all(isinstance(item, Interrupt) for item in native_interrupts)
        or not all(_as_str(getattr(item, "id", None)) for item in native_interrupts)
    ):
        return None

    enriched_metadata = dict(metadata or {})
    first = native_interrupts[0]
    value = getattr(first, "value", None)
    if isinstance(first, dict):
        value = first.get("value")
    if isinstance(value, dict):
        if value.get("prompt") is not None:
            enriched_metadata["interrupt_prompt"] = str(value["prompt"])[:500]
        if value.get("request_type") is not None:
            enriched_metadata["interrupt_request_type"] = value["request_type"]
        if isinstance(value.get("supported_decisions"), (list, tuple)):
            enriched_metadata["supported_decisions"] = json.dumps(value["supported_decisions"])

    return _extract_interrupt_payload(
        {"__interrupt__": native_interrupts},
        enriched_metadata,
    )


def _token_usage_from_response(response: Any) -> Dict[str, int]:
    """Extract token counts only from explicit response/llm_output metadata."""
    usage: Dict[str, int] = {}
    candidates: list[Any] = []
    if response is None:
        return usage
    if isinstance(response, dict):
        candidates.append(response)
        candidates.append(response.get("llm_output") or {})
        generations = response.get("generations")
        if isinstance(generations, list) and generations:
            first_group = generations[0]
            if isinstance(first_group, list) and first_group:
                gen0 = first_group[0]
                if hasattr(gen0, "message"):
                    candidates.append(getattr(gen0.message, "response_metadata", None))
                if isinstance(gen0, dict):
                    candidates.append(gen0.get("generation_info") or {})
    else:
        candidates.append(getattr(response, "llm_output", None))
        candidates.append(getattr(response, "response_metadata", None))
        generations = getattr(response, "generations", None)
        if isinstance(generations, list) and generations:
            first_group = generations[0]
            if isinstance(first_group, list) and first_group:
                gen0 = first_group[0]
                message = getattr(gen0, "message", None)
                if message is not None:
                    candidates.append(getattr(message, "response_metadata", None))
                candidates.append(getattr(gen0, "generation_info", None))

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        token_usage = candidate.get("token_usage") or candidate.get("usage") or candidate
        if not isinstance(token_usage, dict):
            continue
        inp = token_usage.get("prompt_tokens") or token_usage.get("input_tokens")
        out = token_usage.get("completion_tokens") or token_usage.get("output_tokens")
        if inp is not None:
            usage["tokens_input"] = int(inp)
        if out is not None:
            usage["tokens_output"] = int(out)
        if usage:
            break
    return usage


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
        self._llm_models: Dict[UUID, str] = {}
        self._retriever_names: Dict[UUID, str] = {}
        self._run_metadata: Dict[UUID, Dict[str, Any]] = {}

    def _should_ignore_node(self, node_name: str) -> bool:
        return node_name in {"LangGraph", "RunnableSequence", "RunnableParallel", "StateGraph"}

    def _apply_native_identity(self, agent: AgentInstrumentor, identity: Dict[str, str]) -> None:
        if not agent or not getattr(agent, "_span", None):
            return
        for key, value in identity.items():
            agent._span.set_attribute(key, value)

    def _resolve_agent(self, parent_run_id: Optional[UUID]) -> AgentInstrumentor | None:
        if parent_run_id and parent_run_id in self._active_agents:
            return self._active_agents[parent_run_id]
        # Fall back to any active agent when callbacks nest under ignored framework nodes.
        if len(self._active_agents) == 1:
            return next(iter(self._active_agents.values()))
        return None

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
        self._run_metadata[run_id] = metadata

        node_name = metadata.get("langgraph_node")
        if not node_name:
            if tags:
                for tag in tags:
                    if tag.startswith("graph:step:"):
                        node_name = tag.split(":")[-1]
                        break
            if not node_name:
                node_name = serialized.get("name") or serialized.get("id")
        if not node_name:
            node_name = "unknown_node"

        if self._should_ignore_node(node_name):
            return

        if parent_run_id:
            self._parent_runs[run_id] = parent_run_id

        # Explicit handoff only — ordinary parent-child nesting is not handoff.
        handoff_target = _extract_explicit_handoff_target(metadata)
        if handoff_target and parent_run_id:
            parent_agent = self._active_agents.get(parent_run_id)
            if parent_agent and parent_agent._span:
                parent_agent._span.add_event(
                    AgentEvents.HANDOFF_REQUESTED,
                    {
                        AgentAttributes.HANDOFF_TARGET: handoff_target,
                        AgentAttributes.HANDOFF_REASON: "langgraph.explicit_handoff",
                        LangGraphNativeAttributes.EXPLICIT_HANDOFF: "true",
                        **{
                            k: v
                            for k, v in _extract_native_identity(
                                run_id=run_id,
                                parent_run_id=parent_run_id,
                                metadata=metadata,
                                tags=tags,
                                kwargs=kwargs,
                            ).items()
                            if k
                            in (
                                LangGraphNativeAttributes.RUN_ID,
                                LangGraphNativeAttributes.PARENT_RUN_ID,
                                LangGraphNativeAttributes.ACTIVITY_CORRELATION_ID,
                            )
                        },
                    },
                )

        task = node_name
        goal = ""

        if getattr(self.lens, "_get_injection", None):
            injection = self.lens._get_injection("prompt_injection", target=f"agent:{node_name}")
            if injection and isinstance(injection, dict):
                task = injection.get("task", node_name)
                goal = injection.get("goal", "")
                logger.info(
                    f"[AgentLens Sandbox] Injecting prompt override for agent {node_name}: "
                    f"task='{task}' goal='{goal}'"
                )

        agent = self.mission.agent(
            agent_id=node_name,
            role=node_name,
            name=node_name,
        )
        agent.__enter__()
        self._active_agents[run_id] = agent
        self._node_names[run_id] = node_name

        identity = _extract_native_identity(
            run_id=run_id,
            parent_run_id=parent_run_id,
            metadata=metadata,
            tags=tags,
            kwargs=kwargs,
        )
        self._apply_native_identity(agent, identity)

        # Observe resume only when explicitly identified.
        resume_of = identity.get(LangGraphNativeAttributes.RESUME_OF_INTERRUPT_ID)
        if resume_of and agent._span:
            resume_attrs = {
                AgentAttributes.INTERRUPT_ID: resume_of,
                LangGraphNativeAttributes.RESUME_OF_INTERRUPT_ID: resume_of,
                LangGraphNativeAttributes.RUN_ID: str(run_id),
            }
            delivery_id = _first_present(metadata, "governance_delivery_id", "delivery_id")
            if delivery_id:
                resume_attrs[LangGraphNativeAttributes.DELIVERY_ID] = delivery_id
                resume_attrs[LangGraphNativeAttributes.CONTINUED_WITH_INPUT] = "true"
            agent._span.add_event(
                AgentEvents.INTERRUPT_RESUMED,
                resume_attrs,
            )

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
        stored_parent = self._parent_runs.pop(run_id, None)
        metadata = self._run_metadata.pop(run_id, {})
        parent_run_id = parent_run_id or stored_parent

        if agent:
            interrupt = _extract_interrupt_payload(outputs, metadata)
            if interrupt and agent._span:
                agent._span.add_event(AgentEvents.INTERRUPT_REQUESTED, interrupt)
                interrupt_id = interrupt.get(LangGraphNativeAttributes.INTERRUPT_REQUEST_ID)
                if interrupt_id:
                    agent._span.set_attribute(
                        LangGraphNativeAttributes.INTERRUPT_REQUEST_ID,
                        interrupt_id,
                    )

            handoff_target = _extract_explicit_handoff_target(metadata, outputs)
            if handoff_target and agent._span:
                agent._span.add_event(
                    AgentEvents.HANDOFF_REQUESTED,
                    {
                        AgentAttributes.HANDOFF_TARGET: handoff_target,
                        AgentAttributes.HANDOFF_REASON: "langgraph.explicit_handoff",
                        LangGraphNativeAttributes.EXPLICIT_HANDOFF: "true",
                    },
                )

            if outputs:
                name = node_name or "unknown_node"
                agent.record_memory_write(f"{name}.outputs", str(outputs)[:500])
            agent.__exit__(None, None, None)

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._active_agents.pop(run_id, None)
        self._node_names.pop(run_id, None)
        self._parent_runs.pop(run_id, None)
        metadata = self._run_metadata.pop(run_id, {})

        if agent:
            interrupt = _extract_interrupt_payload_from_error(error, metadata)
            if interrupt and agent._span:
                agent._span.add_event(AgentEvents.INTERRUPT_REQUESTED, interrupt)
                interrupt_id = interrupt.get(LangGraphNativeAttributes.INTERRUPT_REQUEST_ID)
                if interrupt_id:
                    agent._span.set_attribute(
                        LangGraphNativeAttributes.INTERRUPT_REQUEST_ID,
                        interrupt_id,
                    )
            agent.__exit__(type(error), error, getattr(error, "__traceback__", None))

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
        agent = self._resolve_agent(parent_run_id)
        tool_name = (serialized or {}).get("name", "unknown_tool")
        if run_id:
            self._tool_names[run_id] = tool_name
        if agent and agent._span:
            identity = _extract_native_identity(
                run_id=run_id,
                parent_run_id=parent_run_id,
                metadata=metadata,
                tags=tags,
                kwargs=kwargs,
            )
            agent._span.add_event(
                AgentEvents.TOOL_CALL,
                {
                    AgentAttributes.TOOL_NAME: tool_name,
                    AgentAttributes.TOOL_STATUS: "active",
                    AgentAttributes.TOOL_INPUT: str(input_str)[:1000],
                    **identity,
                },
            )

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        tool_name = self._tool_names.pop(run_id, "tool_call_completed")
        if agent and agent._span:
            identity = _extract_native_identity(run_id=run_id, parent_run_id=parent_run_id)
            attrs = {
                AgentAttributes.TOOL_NAME: tool_name,
                AgentAttributes.TOOL_STATUS: "success",
                AgentAttributes.TOOL_OUTPUT: str(output)[:1000],
                **identity,
            }
            agent._span.add_event(AgentEvents.TOOL_CALL, attrs)

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        tool_name = self._tool_names.pop(run_id, "tool_call_failed")
        if agent and agent._span:
            identity = _extract_native_identity(run_id=run_id, parent_run_id=parent_run_id)
            agent._span.add_event(
                AgentEvents.TOOL_CALL,
                {
                    AgentAttributes.TOOL_NAME: tool_name,
                    AgentAttributes.TOOL_STATUS: "error",
                    **identity,
                },
            )

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        model = (serialized or {}).get("name") or (metadata or {}).get("ls_model_name") or "unknown_model"
        self._llm_models[run_id] = str(model)
        if agent and agent._span:
            identity = _extract_native_identity(
                run_id=run_id,
                parent_run_id=parent_run_id,
                metadata=metadata,
                tags=tags,
                kwargs=kwargs,
            )
            attrs = {
                LLMAttributes.MODEL_NAME: str(model),
                **identity,
            }
            if prompts:
                attrs[LLMAttributes.PROMPT] = str(prompts[0])[:1000]
            agent._span.add_event(AgentEvents.LLM_CALL, attrs)

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        prompts = [str(messages)[:1000]] if messages else []
        self.on_llm_start(
            serialized,
            prompts,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        model = self._llm_models.pop(run_id, "unknown_model")
        if not agent:
            return
        usage = _token_usage_from_response(response)
        agent.record_llm_call(
            model=model,
            tokens_input=usage.get("tokens_input"),
            tokens_output=usage.get("tokens_output"),
        )
        if agent._span:
            identity = _extract_native_identity(run_id=run_id, parent_run_id=parent_run_id)
            for key, value in identity.items():
                # Keep correlation on the closing event via a lightweight marker event attr set.
                # Attributes already recorded on start; re-attach run correlation for event merge.
                pass
            if identity:
                agent._span.set_attribute(
                    LangGraphNativeAttributes.ACTIVITY_CORRELATION_ID,
                    identity.get(
                        LangGraphNativeAttributes.ACTIVITY_CORRELATION_ID,
                        str(run_id),
                    ),
                )

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        model = self._llm_models.pop(run_id, "unknown_model")
        if agent and agent._span:
            identity = _extract_native_identity(run_id=run_id, parent_run_id=parent_run_id)
            agent._span.add_event(
                AgentEvents.LLM_ERROR,
                {
                    LLMAttributes.MODEL_NAME: model,
                    "error.original": str(error)[:500],
                    **identity,
                },
            )

    def on_retriever_start(
        self,
        serialized: Dict[str, Any],
        query: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        name = (serialized or {}).get("name", "retriever")
        self._retriever_names[run_id] = name
        if agent and agent._span:
            identity = _extract_native_identity(
                run_id=run_id,
                parent_run_id=parent_run_id,
                metadata=metadata,
                tags=tags,
                kwargs=kwargs,
            )
            agent._span.add_event(
                AgentEvents.TOOL_CALL,
                {
                    AgentAttributes.TOOL_NAME: name,
                    AgentAttributes.TOOL_STATUS: "active",
                    AgentAttributes.TOOL_INPUT: str(query)[:1000],
                    LangGraphNativeAttributes.RETRIEVAL_MARKER: "true",
                    **identity,
                },
            )

    def on_retriever_end(
        self,
        documents: Sequence[Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        name = self._retriever_names.pop(run_id, "retriever")
        if agent and agent._span:
            identity = _extract_native_identity(run_id=run_id, parent_run_id=parent_run_id)
            agent._span.add_event(
                AgentEvents.TOOL_CALL,
                {
                    AgentAttributes.TOOL_NAME: name,
                    AgentAttributes.TOOL_STATUS: "success",
                    AgentAttributes.TOOL_OUTPUT: f"documents:{len(documents)}",
                    LangGraphNativeAttributes.RETRIEVAL_MARKER: "true",
                    **identity,
                },
            )

    def on_retriever_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        agent = self._resolve_agent(parent_run_id)
        name = self._retriever_names.pop(run_id, "retriever")
        if agent and agent._span:
            identity = _extract_native_identity(run_id=run_id, parent_run_id=parent_run_id)
            agent._span.add_event(
                AgentEvents.TOOL_CALL,
                {
                    AgentAttributes.TOOL_NAME: name,
                    AgentAttributes.TOOL_STATUS: "error",
                    LangGraphNativeAttributes.RETRIEVAL_MARKER: "true",
                    **identity,
                },
            )
