"""
AgentLens LangGraph Adapter

Provides callbacks and utility wrappers to automatically instrument
LangGraph graph execution.
"""

from agentlens_langgraph.instrumentor import (
    AgentLensLangGraphCallbackHandler,
    auto_instrument,
)

__all__ = ["AgentLensLangGraphCallbackHandler", "auto_instrument"]
