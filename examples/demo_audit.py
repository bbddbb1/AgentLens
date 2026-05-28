from __future__ import annotations
from typing import TypedDict
import httpx

from langgraph.graph import END, START, StateGraph
from agentlens_sdk import AgentLens, ToolExecutionProxy
from common import (
    ROOT, auto_instrument, contains_any, load_dotenv,
    mission_ui_url, presign_and_upload_artifact,
    read_env, wait_for_human_decision, write_output
)

class DeploymentState(TypedDict, total=False):
    objective: str
    pr_id: int
    review_summary: str
    qa_summary: str
    approval_required: bool
    interrupt_id: str
    blocked_state: str

def build_graph(lens: AgentLens, mission):
    graph = StateGraph(DeploymentState)
    proxy = ToolExecutionProxy(mode="sandbox")
    
    def review_code(pr_id: int):
        return "def handler(): return 200"
        
    def run_tests():
        return "143 tests passed, 0 failed"
        
    safe_review = proxy.wrap_tool(review_code, tool_name="github.get_pr_diff")
    safe_test = proxy.wrap_tool(run_tests, tool_name="ci.run_tests")

    def reviewer(state: DeploymentState) -> DeploymentState:
        objective = state["objective"]
        pr_id = state.get("pr_id", 402)
        with mission.agent("code_reviewer", role="security_engineer", team="AppSec") as agent:
            agent.set_task("Review the pull request for security vulnerabilities")
            agent.set_goal(objective)
            agent.record_llm_call(
                model="claude-3-opus",
                prompt=f"Review PR #{pr_id} for security vulnerabilities.",
                completion="I will fetch the code diff first.",
                tokens_input=120, tokens_output=15, provider="anthropic"
            )
            
            try:
                diff = safe_review(pr_id=pr_id)
                agent.record_tool_call("github.get_pr_diff", {"pr_id": pr_id}, diff)
            except Exception as e:
                agent.record_tool_call("github.get_pr_diff", {"pr_id": pr_id}, status="error")
                
            agent.record_llm_call(
                model="claude-3-opus",
                prompt="The code is: def handler(): return 200",
                completion="Code looks safe. Approving PR and handing off to QA.",
                tokens_input=30, tokens_output=25, provider="anthropic"
            )
            review_summary = f"PR #{pr_id} passed security review. No vulnerabilities found."
            agent.record_memory_write("deployment.review_summary")
        return {"review_summary": review_summary}

    def qa(state: DeploymentState) -> DeploymentState:
        objective = state["objective"]
        with mission.agent("qa_engineer", role="tester", team="QA") as agent:
            agent.set_task("Run integration tests before deployment")
            agent.set_goal(objective)
            agent.record_llm_call(
                model="gpt-4o",
                prompt="Run tests for the approved PR.",
                completion="Executing CI test suite.",
                tokens_input=50, tokens_output=10, provider="openai"
            )
            
            test_result = safe_test()
            agent.record_tool_call("ci.run_tests", {}, test_result)
            
            qa_summary = "Integration tests completed successfully. System is stable."
            agent.record_memory_write("deployment.qa_summary")
        return {"qa_summary": qa_summary}

    def deploy_planner(state: DeploymentState) -> DeploymentState:
        objective = state["objective"]
        with mission.agent("release_manager", role="deployer", team="DevOps") as agent:
            agent.set_task("Prepare and authorize production deployment")
            agent.set_goal(objective)
            
            blocked_state = (
                "Deployment state: ready\n"
                "Target environment: production\n"
                "Version: v2.1.0\n"
                "Status: waiting for human authorization"
            )
            reason = "Policy 'rule-require-review-production' triggered. Production deployments require human authorization."
            agent.record_review("changes_requested", reason)
            
            interrupt = agent.request_human_review(
                reason,
                payload={
                    "verification_gate": "production_deployment_authorization",
                    "system_effect": "code_deployed_to_production",
                    "objective": objective,
                },
            )
            agent.record_memory_write("deployment.blocked_state")
            
        mission.set_phase("waiting_for_human")
        lens.flush()
        return {
            "approval_required": True,
            "interrupt_id": str(interrupt["interrupt_id"]),
            "blocked_state": blocked_state,
        }

    graph.add_node("reviewer", reviewer)
    graph.add_node("qa", qa)
    graph.add_node("deploy_planner", deploy_planner)
    
    graph.add_edge(START, "reviewer")
    graph.add_edge("reviewer", "qa")
    graph.add_edge("qa", "deploy_planner")
    graph.add_edge("deploy_planner", END)
    
    return graph.compile()


def continue_after_review(
    mission,
    *,
    decision: str,
    objective: str,
    blocked_state: str,
    review_summary: str,
    qa_summary: str,
    human_comment: str,
) -> tuple[str, str]:
    normalized = decision.lower()
    
    if normalized in {"approve", "approved", "resume", "resumed"}:
        mission.set_phase("executing")
        with mission.agent("executor", role="executor", team="DevOps") as agent:
            agent.set_task("Execute the approved production deployment")
            agent.set_goal(objective)
            agent.record_tool_call(
                "deploy_to_production",
                {"env": "prod", "tag": "v2.1.0"},
                {"status": "success", "deployment_id": "dep_99x"}
            )
            agent.record_memory_write("deployment.execution_state")
            
        with mission.agent("communicator", role="communicator", team="Operations") as agent:
            agent.set_task("Announce the successful release")
            agent.set_goal(objective)
            agent.record_artifact("outputs/deployment_report.md", "report")
            
        outcome = "deployed"
        final_state = "Deployment executed successfully. v2.1.0 is live."
        summary = "The human reviewer authorized the deployment, and the graph completed the rollout."
        mission.set_phase("completed")
        
    else:
        mission.set_phase("failed")
        with mission.agent("remediator", role="remediator", team="DevOps") as agent:
            agent.set_task("Halt deployment and notify developers")
            agent.set_goal(objective)
            agent.record_tool_call(
                "github.add_pr_comment",
                {"pr_id": 402, "body": f"Deployment rejected by Release Manager: {human_comment}"},
                {"status": "success"}
            )
            agent.record_artifact("outputs/deployment_report.md", "report")
            
        outcome = "aborted"
        final_state = "Deployment aborted. PR returned to development."
        summary = "The reviewer rejected the deployment, branching the workflow into a rollback/notification state."

    report = (
        "# Deployment Pipeline HITL Report\n\n"
        f"Decision path: {outcome}\n\n"
        "This scenario demonstrates the human-in-the-loop boundary on a live software deployment pipeline.\n\n"
        "Blocked state before review:\n"
        f"{blocked_state}\n\n"
        "Review Summary:\n"
        f"{review_summary}\n\n"
        "QA Summary:\n"
        f"{qa_summary}\n\n"
        "Human comment:\n"
        f"{human_comment}\n\n"
        "System state after review:\n"
        f"{final_state}\n\n"
        "Why this matters:\n"
        f"{summary}\n"
    )
    return outcome, report


def main() -> None:
    load_dotenv(ROOT / ".env")
    objective = read_env(
        "DEPLOYMENT_OBJECTIVE",
        "Review and deploy PR #402 to production, ensuring human authorization before rollout.",
    )
    endpoint = read_env("AGENTLENS_ENDPOINT", "http://localhost:8001")
    
    lens, mission, handler = auto_instrument(
        objective,
        endpoint=endpoint,
        service_name=read_env("DEPLOYMENT_SERVICE_NAME", "agentlens-deployment-demo"),
        demo="deployment_pipeline_hitl",
    )

    print("==========================================================")
    print(" AgentLens Demo: LangGraph Multi-Agent Deployment Pipeline")
    print("==========================================================")
    print(f"[*] AgentLens endpoint: {endpoint}")

    with mission:
        mission.set_phase("planning")
        graph = build_graph(lens, mission)
        
        # Invoke the graph
        result = graph.invoke({"objective": objective, "pr_id": 402}, config={"callbacks": [handler]})

        decision = "not_required"
        comment = "No human comment provided."
        outcome = "not_required"
        
        if result.get("approval_required"):
            decision, comment = wait_for_human_decision(
                lens,
                mission_id=mission.mission_id,
                interrupt_id=result["interrupt_id"],
                scenario="Production Deployment Authorization",
            )
            with mission.agent("human-review", role="human_review", team="Governance") as agent:
                agent.set_task("Record the human decision for the deployment workflow")
                agent.record_human_decision(decision, comment=comment, interrupt_id=result["interrupt_id"])
            
            lens.flush()
            
            outcome, report = continue_after_review(
                mission,
                decision=decision,
                objective=objective,
                blocked_state=result.get("blocked_state", ""),
                review_summary=result.get("review_summary", ""),
                qa_summary=result.get("qa_summary", ""),
                human_comment=comment,
            )
        else:
            report = "# Deployment Report\n\nNo interrupt was raised.\n"

    lens.shutdown()
    output_path = write_output("deployment_report.md", report)
    
    # Audit Verification
    print("\n5. Cryptographic Audit Verification...")
    try:
        response = httpx.get(f"http://localhost:8001/api/v1/missions/{mission.mission_id}/audit/verify")
        response.raise_for_status()
        report_json = response.json()
        
        is_valid = report_json.get('is_valid', False)
        status_color = "\033[92m" if is_valid else "\033[91m"
        reset_color = "\033[0m"
        
        print("\n==========================================================")
        print(f" AUDIT RESULT: {status_color}{'[VALID] TAMPER-FREE' if is_valid else '[INVALID] COMPROMISED'}{reset_color}")
        print("==========================================================")
    except Exception as e:
        print(f"   [ERROR] Failed to verify audit: {e}")

    print("\n[+] Deployment demo complete")
    print(f"[+] Mission ID: {mission.mission_id}")
    print(f"[+] Review UI: {mission_ui_url(mission.mission_id)}")
    print(f"[+] Final decision: {decision}")
    print(f"[+] Outcome: {outcome}")
    print(f"[+] Output written: {output_path}")

if __name__ == "__main__":
    main()
