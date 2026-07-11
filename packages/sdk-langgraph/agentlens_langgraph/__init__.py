"""
AgentLens LangGraph Adapter

Provides callbacks and utility wrappers to automatically instrument
LangGraph graph execution.
"""

from agentlens_langgraph.instrumentor import (
    AgentLensLangGraphCallbackHandler,
    auto_instrument,
)
from agentlens_langgraph.governance_bridge import (
    BridgeDecisionMappingError,
    BridgeHttpError,
    GovernanceBridgeClient,
    LangGraphGovernanceBridge,
    NativeIdentity,
    correlation_invoke_config,
    generate_control_ref,
    map_decision_to_command,
)
from agentlens_langgraph.native_attrs import (
    LangGraphNativeAttributes,
    derive_native_execution_key,
)

__all__ = [
    "AgentLensLangGraphCallbackHandler",
    "auto_instrument",
    "BridgeDecisionMappingError",
    "BridgeHttpError",
    "GovernanceBridgeClient",
    "LangGraphGovernanceBridge",
    "LangGraphNativeAttributes",
    "NativeIdentity",
    "correlation_invoke_config",
    "derive_native_execution_key",
    "generate_control_ref",
    "map_decision_to_command",
]
