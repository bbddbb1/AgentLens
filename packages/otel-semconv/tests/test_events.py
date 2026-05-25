from agentlens_otel_semconv.events import AgentEvents


class TestAgentEvents:
    def test_delegation_events(self):
        assert AgentEvents.DELEGATION == "agent.delegation"
        assert AgentEvents.DELEGATION_ACCEPTED == "agent.delegation.accepted"
        assert AgentEvents.DELEGATION_REJECTED == "agent.delegation.rejected"

    def test_handoff_events(self):
        assert AgentEvents.HANDOFF == "agent.handoff"
        assert AgentEvents.HANDOFF_REQUESTED == "agent.handoff.requested"
        assert AgentEvents.HANDOFF_ACCEPTED == "agent.handoff.accepted"
        assert AgentEvents.HANDOFF_REJECTED == "agent.handoff.rejected"

    def test_review_events(self):
        assert AgentEvents.CRITIQUE == "agent.critique"
        assert AgentEvents.REVIEW == "agent.review"
        assert AgentEvents.REVIEW_APPROVED == "agent.review.approved"
        assert AgentEvents.REVIEW_CHANGES_REQUESTED == "agent.review.changes_requested"
        assert AgentEvents.REVIEW_REJECTED == "agent.review.rejected"

    def test_cognitive_events(self):
        assert AgentEvents.REFLECTION == "agent.reflection"
        assert AgentEvents.PLANNING == "agent.planning"
        assert AgentEvents.DECISION == "agent.decision"

    def test_error_and_escalation_events(self):
        assert AgentEvents.RETRY == "agent.retry"
        assert AgentEvents.ESCALATION == "agent.escalation"
        assert AgentEvents.APPROVAL == "agent.approval"
        assert AgentEvents.TIMEOUT == "agent.timeout"

    def test_memory_events(self):
        assert AgentEvents.MEMORY_READ == "agent.memory.read"
        assert AgentEvents.MEMORY_WRITE == "agent.memory.write"
        assert AgentEvents.MEMORY_DELETE == "agent.memory.delete"

    def test_tool_events(self):
        assert AgentEvents.TOOL_CALL == "agent.tool.call"
        assert AgentEvents.TOOL_RESULT == "agent.tool.result"
        assert AgentEvents.TOOL_ERROR == "agent.tool.error"

    def test_artifact_events(self):
        assert AgentEvents.ARTIFACT_CREATED == "agent.artifact.created"
        assert AgentEvents.ARTIFACT_UPDATED == "agent.artifact.updated"

    def test_interrupt_events(self):
        assert AgentEvents.INTERRUPT_REQUESTED == "agent.interrupt.requested"
        assert AgentEvents.INTERRUPT_RESUMED == "agent.interrupt.resumed"
        assert AgentEvents.HUMAN_DECISION == "agent.human.decision"

    def test_mission_events(self):
        assert AgentEvents.MISSION_STARTED == "mission.started"
        assert AgentEvents.MISSION_PHASE_CHANGED == "mission.phase.changed"
        assert AgentEvents.MISSION_COMPLETED == "mission.completed"
        assert AgentEvents.MISSION_FAILED == "mission.failed"
