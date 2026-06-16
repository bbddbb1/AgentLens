from agentlens_otel_semconv.attributes import AgentAttributes, MissionAttributes


class TestAgentAttributes:
    def test_identity_attributes(self):
        assert AgentAttributes.ID == "gen_ai.agent.id"
        assert AgentAttributes.NAME == "gen_ai.agent.name"
        assert AgentAttributes.ROLE == "gen_ai.agent.role"
        assert AgentAttributes.TEAM == "gen_ai.agent.team"
        assert AgentAttributes.FRAMEWORK == "gen_ai.agent.framework"

    def test_objective_attributes(self):
        assert AgentAttributes.GOAL == "gen_ai.agent.goal"
        assert AgentAttributes.TASK == "gen_ai.agent.task"
        assert AgentAttributes.TASK_DESCRIPTION == "gen_ai.agent.task.description"

    def test_state_attributes(self):
        assert AgentAttributes.CONFIDENCE == "gen_ai.agent.confidence"
        assert AgentAttributes.STATUS == "gen_ai.agent.status"
        assert AgentAttributes.ITERATION == "gen_ai.agent.iteration"

    def test_communication_attributes(self):
        assert AgentAttributes.DELEGATION_TARGET == "gen_ai.agent.delegation.target"
        assert AgentAttributes.DELEGATION_REASON == "gen_ai.agent.delegation.reason"
        assert AgentAttributes.CRITIQUE_TARGET == "gen_ai.agent.critique.target"
        assert AgentAttributes.CRITIQUE_RESULT == "gen_ai.agent.critique.result"
        assert AgentAttributes.REVIEW_RESULT == "gen_ai.agent.review.result"
        assert AgentAttributes.REVIEW_TARGET == "gen_ai.agent.review.target"
        assert AgentAttributes.ESCALATION_TARGET == "gen_ai.agent.escalation.target"
        assert AgentAttributes.ESCALATION_REASON == "gen_ai.agent.escalation.reason"
        assert AgentAttributes.HANDOFF_TARGET == "gen_ai.agent.handoff.target"
        assert AgentAttributes.HANDOFF_REASON == "gen_ai.agent.handoff.reason"

    def test_memory_attributes(self):
        assert AgentAttributes.MEMORY_KEY == "gen_ai.agent.memory.key"
        assert AgentAttributes.MEMORY_OPERATION == "gen_ai.agent.memory.operation"

    def test_tool_attributes(self):
        assert AgentAttributes.TOOL_NAME == "gen_ai.tool.name"
        assert AgentAttributes.TOOL_INPUT == "gen_ai.tool.input"
        assert AgentAttributes.TOOL_OUTPUT == "gen_ai.tool.output"
        assert AgentAttributes.TOOL_STATUS == "gen_ai.tool.status"

    def test_interrupt_attributes(self):
        assert AgentAttributes.INTERRUPT_ID == "gen_ai.agent.interrupt.id"
        assert AgentAttributes.INTERRUPT_REASON == "gen_ai.agent.interrupt.reason"
        assert AgentAttributes.INTERRUPT_RESUME_URL == "gen_ai.agent.interrupt.resume_url"
        assert AgentAttributes.RESUME_TOKEN == "gen_ai.agent.resume.token"
        assert AgentAttributes.HUMAN_DECISION == "gen_ai.agent.human.decision"
        assert AgentAttributes.HUMAN_INPUT == "gen_ai.agent.human.input"
        assert AgentAttributes.TIMEOUT_AT == "gen_ai.agent.timeout_at"
        assert AgentAttributes.POLICY_REQUIRED_REVIEW == "gen_ai.agent.policy.required_review"


class TestMissionAttributes:
    def test_all_mission_attributes(self):
        assert MissionAttributes.ID == "gen_ai.workflow.id"
        assert MissionAttributes.OBJECTIVE == "gen_ai.workflow.name"
        assert MissionAttributes.PHASE == "gen_ai.workflow.phase"
        assert MissionAttributes.STATUS == "gen_ai.workflow.status"
        assert MissionAttributes.OWNER == "gen_ai.workflow.owner"
        assert MissionAttributes.TEAM_SIZE == "gen_ai.workflow.team_size"
        assert MissionAttributes.ENCRYPTION_ENABLED == "gen_ai.workflow.encryption.enabled"
        assert MissionAttributes.FRAMEWORK == "gen_ai.workflow.framework"
        assert MissionAttributes.VERSION == "gen_ai.workflow.version"
