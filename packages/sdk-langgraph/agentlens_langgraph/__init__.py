"""
AgentLens LangGraph Adapter

Provides callbacks and utility wrappers to automatically instrument
LangGraph graph execution.
"""

from agentlens_langgraph.instrumentor import (
    AgentLensLangGraphCallbackHandler,
    auto_instrument,
)
from agentlens_langgraph.native_attrs import (
    LangGraphNativeAttributes,
    derive_native_execution_key,
)

__all__ = [
    "AgentLensLangGraphCallbackHandler",
    "auto_instrument",
    "LangGraphNativeAttributes",
    "derive_native_execution_key",
]
