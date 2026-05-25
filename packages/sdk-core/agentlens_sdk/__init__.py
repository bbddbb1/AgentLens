"""
AgentLens SDK Core —Instrument multi-agent systems with OpenTelemetry.

Usage:
    from agentlens_sdk import AgentLens

    lens = AgentLens(endpoint="http://localhost:8001")

    with lens.mission("Research quarterly report") as mission:
        with mission.agent("planner", role="planner") as agent:
            agent.record_handoff("researcher", "Gather market data")
            agent.record_handoff("writer", "Draft executive summary")
"""

from agentlens_sdk.client import AgentLens
from agentlens_sdk.mission import Mission
from agentlens_sdk.agent import AgentInstrumentor

__all__ = ["AgentLens", "Mission", "AgentInstrumentor"]
