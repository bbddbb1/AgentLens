import pytest
from agentlens_otel_semconv.frameworks import normalize_framework_name
from agentlens_otel_semconv.span_kinds import AgentSpanKind, Frameworks


class TestNormalizeFrameworkName:
    def test_returns_custom_for_none(self):
        assert normalize_framework_name(None) == Frameworks.CUSTOM

    def test_returns_custom_for_empty_string(self):
        assert normalize_framework_name("") == Frameworks.CUSTOM

    def test_whitespace_only_strips_to_empty(self):
        assert normalize_framework_name("   ") == ""

    def test_preserves_custom(self):
        assert normalize_framework_name("custom") == Frameworks.CUSTOM

    def test_normalizes_langgraph(self):
        assert normalize_framework_name("langgraph") == Frameworks.LANGGRAPH

    def test_normalizes_langgraph_with_spaces(self):
        assert normalize_framework_name("Lang Graph") == Frameworks.LANGGRAPH

    def test_normalizes_langgraph_with_hyphens(self):
        assert normalize_framework_name("langchain-graph") == Frameworks.LANGGRAPH

    def test_normalizes_autogen(self):
        assert normalize_framework_name("autogen") == Frameworks.AUTOGEN
        assert normalize_framework_name("Auto Gen") == Frameworks.AUTOGEN

    def test_normalizes_crewai(self):
        assert normalize_framework_name("crewai") == Frameworks.CREWAI
        assert normalize_framework_name("Crew AI") == Frameworks.CREWAI

    def test_normalizes_openai_agents(self):
        assert normalize_framework_name("openai_agents") == Frameworks.OPENAI_AGENTS
        assert normalize_framework_name("OpenAI Agents") == Frameworks.OPENAI_AGENTS
        assert normalize_framework_name("openai agents sdk") == Frameworks.OPENAI_AGENTS

    def test_normalizes_ms_agent_framework(self):
        assert normalize_framework_name("ms_agent_framework") == Frameworks.MS_AGENT_FRAMEWORK
        assert normalize_framework_name("Microsoft Agent Framework") == Frameworks.MS_AGENT_FRAMEWORK
        assert normalize_framework_name("MS Agent Framework") == Frameworks.MS_AGENT_FRAMEWORK

    def test_unknown_framework_returns_snake_cased(self):
        result = normalize_framework_name("My Custom Framework")
        assert result == "my_custom_framework"

    def test_case_insensitive(self):
        assert normalize_framework_name("LANGGRAPH") == Frameworks.LANGGRAPH


class TestAgentSpanKindConstants:
    def test_mission_constant(self):
        assert AgentSpanKind.MISSION == "mission"

    def test_agent_task_constant(self):
        assert AgentSpanKind.AGENT_TASK == "invoke_agent"

    def test_task_alias(self):
        assert AgentSpanKind.TASK == AgentSpanKind.AGENT_TASK

    def test_tool_call_constant(self):
        assert AgentSpanKind.TOOL_CALL == "execute_tool"

    def test_memory_op_alias(self):
        assert AgentSpanKind.MEMORY == AgentSpanKind.MEMORY_OP


class TestFrameworksConstants:
    def test_all_frameworks_defined(self):
        assert Frameworks.CUSTOM == "custom"
        assert Frameworks.LANGGRAPH == "langgraph"
        assert Frameworks.AUTOGEN == "autogen"
        assert Frameworks.CREWAI == "crewai"
        assert Frameworks.OPENAI_AGENTS == "openai_agents"
        assert Frameworks.MS_AGENT_FRAMEWORK == "ms_agent_framework"
