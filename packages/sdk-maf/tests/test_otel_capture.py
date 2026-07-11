from agentlens_maf.otel_capture import capture_reference_spans


def test_native_maf_otel_baseline_captures_workflow_executor_agent_and_tool() -> None:
    spans = capture_reference_spans()
    names = {span["name"] for span in spans}

    assert "workflow.run" in names
    assert "executor.process agentlens-reference-executor" in names
    assert "invoke_agent AgentLens Reference Agent" in names
    assert "execute_tool classify_reference_input" in names
