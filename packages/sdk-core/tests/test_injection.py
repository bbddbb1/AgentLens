import os
import json
import tempfile
from unittest.mock import patch
from agentlens_sdk.client import AgentLens

def test_sandbox_mode_loads_injections():
    injections_data = [
        {
            "type": "human_decision",
            "target": "security_vendor_approval",
            "decision": "reject",
            "comment": "Mask PII dataset please."
        },
        {
            "type": "prompt_injection",
            "target": "agent:planner",
            "task": "Test Task override"
        }
    ]
    
    with tempfile.TemporaryDirectory() as tmpdir:
        context_file = os.path.join(tmpdir, "context.json")
        with open(context_file, "w") as f:
            json.dump({
                "mission_id": "test-mission-123",
                "branch_id": "test-branch-abc",
                "injections": injections_data
            }, f)
            
        os.environ["AGENTLENS_SANDBOX_MODE"] = "1"
        
        # Patch os.path.exists and builtins.open
        original_exists = os.path.exists
        def mock_exists(path):
            if path == "/agentlens/context/context.json":
                return True
            return original_exists(path)
            
        original_open = open
        def mock_open(path, *args, **kwargs):
            if path == "/agentlens/context/context.json":
                return original_open(context_file, *args, **kwargs)
            return original_open(path, *args, **kwargs)
            
        with patch("os.path.exists", mock_exists), patch("builtins.open", mock_open):
            # Initialize client
            lens = AgentLens(endpoint="http://localhost:8001")
            
            # Check injections loaded
            assert len(lens._injections) == 2
            
            # Test _get_injection lookup
            inj_decision = lens._get_injection("human_decision", "security_vendor_approval")
            assert inj_decision is not None
            assert inj_decision["decision"] == "reject"
            
            inj_prompt = lens._get_injection("prompt_injection", "agent:planner")
            assert inj_prompt is not None
            assert inj_prompt["task"] == "Test Task override"
            
            # Test wait_for_interrupt_decision mocking
            decision_res = lens.wait_for_interrupt_decision("test-mission-123", "security_vendor_approval")
            assert decision_res["decision"] == "reject"
            assert decision_res["status"] == "rejected"
            assert decision_res["decision_comment"] == "Mask PII dataset please."
            
        del os.environ["AGENTLENS_SANDBOX_MODE"]
