"""
Generic Branch Worker Entrypoint for AgentLens
"""
import argparse
import json
import runpy
import sys
import os

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--context", type=str, required=True, help="Path to context.json")
    parser.add_argument("--entrypoint", type=str, required=True, help="Module to run")
    args, unknown = parser.parse_known_args()

    # Load context
    with open(args.context, "r") as f:
        ctx = json.load(f)

    # Set up environment variables for the worker
    os.environ["AGENTLENS_BRANCH_ID"] = ctx.get("branch_id", "")
    os.environ["AGENTLENS_MISSION_ID"] = ctx.get("mission_id", "")
    os.environ["AGENTLENS_FORK_SEQUENCE_NUM"] = str(ctx.get("forked_from_sequence_num", 0))
    os.environ["AGENTLENS_SANDBOX_MODE"] = "1"
    os.environ["AGENTLENS_SANDBOX_OUTPUT_DIR"] = "/agentlens/output"

    # Run the user entrypoint
    entrypoint = args.entrypoint
    sys.argv = [entrypoint] + unknown
    
    # If it's a path to a file, add its directory to sys.path and run as path
    if os.path.isfile(entrypoint):
        script_dir = os.path.abspath(os.path.dirname(entrypoint))
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        runpy.run_path(entrypoint, run_name="__main__")
    else:
        try:
            runpy.run_module(entrypoint, run_name="__main__", alter_sys=True)
        except ImportError:
            # Fallback to run_path for safety
            runpy.run_path(entrypoint, run_name="__main__")

if __name__ == "__main__":
    main()
