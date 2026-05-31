import os
import json
import tempfile
import sys
from unittest.mock import patch
import pytest

from agentlens_sdk.branch_worker import main

def test_branch_worker_sets_env_and_runs_entrypoint():
    # Create a dummy context.json
    ctx = {
        "branch_id": "branch-123",
        "mission_id": "mission-456",
        "forked_from_sequence_num": 42
    }
    
    # Create a dummy entrypoint
    entrypoint_code = """
import os
import sys
# Write the env vars to a file we can check
with open(sys.argv[1], 'w') as f:
    f.write(os.environ.get("AGENTLENS_BRANCH_ID", ""))
    f.write(",")
    f.write(os.environ.get("AGENTLENS_MISSION_ID", ""))
    f.write(",")
    f.write(os.environ.get("AGENTLENS_FORK_SEQUENCE_NUM", ""))
    f.write(",")
    f.write(os.environ.get("AGENTLENS_SANDBOX_MODE", ""))
"""

    with tempfile.TemporaryDirectory() as tmpdir:
        ctx_file = os.path.join(tmpdir, "context.json")
        entrypoint_file = os.path.join(tmpdir, "entry.py")
        output_file = os.path.join(tmpdir, "output.txt")
        
        with open(ctx_file, "w") as f:
            json.dump(ctx, f)
            
        with open(entrypoint_file, "w") as f:
            f.write(entrypoint_code)
            
        test_args = ["branch_worker", "--context", ctx_file, "--entrypoint", entrypoint_file, output_file]
        
        old_env = dict(os.environ)
        try:
            with patch.object(sys, 'argv', test_args):
                main()
        finally:
            for key in [
                "AGENTLENS_BRANCH_ID",
                "AGENTLENS_MISSION_ID",
                "AGENTLENS_FORK_SEQUENCE_NUM",
                "AGENTLENS_SANDBOX_MODE",
                "AGENTLENS_SANDBOX_OUTPUT_DIR",
            ]:
                if key in old_env:
                    os.environ[key] = old_env[key]
                elif key in os.environ:
                    del os.environ[key]
            
        with open(output_file, "r") as f:
            result = f.read()
            
        assert result == "branch-123,mission-456,42,1"
