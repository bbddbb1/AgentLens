from agentlens_otel_semconv.attributes import AgentAttributes, MissionAttributes


class TestAgentAttributes:
    def test_identity_attributes(self):
        assert AgentAttributes.ID == "agent.id"
        assert AgentAttributes.NAME == "agent.name"
        assert AgentAttributes.ROLE == "agent.role"
        assert AgentAttributes.TEAM == "agent.team"
        assert AgentAttributes.FRAMEWORK == "agent.framework"

    def test_objective_attributes(self):
        assert AgentAttributes.GOAL == "agent.goal"
        assert AgentAttributes.TASK == "agent.task"
        assert AgentAttributes.TASK_DESCRIPTION == "agent.task.description"

    def test_state_attributes(self):
        assert AgentAttributes.CONFIDENCE == "agent.confidence"
        assert AgentAttributes.STATUS == "agent.status"
        assert AgentAttributes.ITERATION == "agent.iteration"

    def test_communication_attributes(self):
        assert AgentAttributes.DELEGATION_TARGET == "agent.delegation.target"
        assert AgentAttributes.DELEGATION_REASON == "agent.delegation.reason"
        assert AgentAttributes.CRITIQUE_TARGET == "agent.critique.target"
        assert AgentAttributes.CRITIQUE_RESULT == "agent.critique.result"
        assert AgentAttributes.REVIEW_RESULT == "agent.review.result"
        assert AgentAttributes.REVIEW_TARGET == "agent.review.target"
        assert AgentAttributes.ESCALATION_TARGET == "agent.escalation.target"
        assert AgentAttributes.ESCALATION_REASON == "agent.escalation.reason"
        assert AgentAttributes.HANDOFF_TARGET == "agent.handoff.target"
        assert AgentAttributes.HANDOFF_REASON == "agent.handoff.reason"

    def test_memory_attributes(self):
        assert AgentAttributes.MEMORY_KEY == "agent.memory.key"
        assert AgentAttributes.MEMORY_OPERATION == "agent.memory.operation"

    def test_tool_attributes(self):
        assert AgentAttributes.TOOL_NAME == "agent.tool.name"
        assert AgentAttributes.TOOL_INPUT == "agent.tool.input"
        assert AgentAttributes.TOOL_OUTPUT == "agent.tool.output"
        assert AgentAttributes.TOOL_STATUS == "agent.tool.status"

    def test_interrupt_attributes(self):
        assert AgentAttributes.INTERRUPT_ID == "agent.interrupt.id"
        assert AgentAttributes.INTERRUPT_REASON == "agent.interrupt.reason"
        assert AgentAttributes.INTERRUPT_RESUME_URL == "agent.interrupt.resume_url"
        assert AgentAttributes.RESUME_TOKEN == "agent.resume.token"
        assert AgentAttributes.HUMAN_DECISION == "agent.human.decision"
        assert AgentAttributes.HUMAN_INPUT == "agent.human.input"
        assert AgentAttributes.TIMEOUT_AT == "agent.timeout_at"
        assert AgentAttributes.POLICY_REQUIRED_REVIEW == "agent.policy.required_review"


class TestMissionAttributes:
    def test_all_mission_attributes(self):
        assert MissionAttributes.ID == "mission.id"
        assert MissionAttributes.OBJECTIVE == "mission.objective"
        assert MissionAttributes.PHASE == "mission.phase"
        assert MissionAttributes.STATUS == "mission.status"
        assert MissionAttributes.OWNER == "mission.owner"
        assert MissionAttributes.TEAM_SIZE == "mission.team_size"
        assert MissionAttributes.ENCRYPTION_ENABLED == "mission.encryption.enabled"
        assert MissionAttributes.FRAMEWORK == "mission.framework"
        assert MissionAttributes.VERSION == "mission.version"
