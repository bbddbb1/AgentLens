from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from common import AgentLens, ROOT, auto_instrument, contains_any, load_dotenv, mission_ui_url, read_env, wait_for_human_decision, write_output


class ReleaseGateState(TypedDict, total=False):
    objective: str
    change_plan: str
    evidence_summary: str
    risk_summary: str
    blocked_state: str
    approval_required: bool
    interrupt_id: str
    resume_token: str


def build_graph(lens: AgentLens, mission):
    graph = StateGraph(ReleaseGateState)

    def planner(state: ReleaseGateState) -> ReleaseGateState:
        objective = state["objective"]
        with mission.agent("release-planner", role="planner", team="Core") as agent:
            agent.set_task("Design the production rollout for the new support automation")
            agent.set_goal(objective)
            plan = (
                "1. Export customer support records.\n"
                "2. Send records to an external vendor model for classification.\n"
                "3. Use the classifications to stage a production rollout.\n"
                "4. Pause before release until human approval is recorded."
            )
            agent.record_reflection(
                "This rollout changes the entire production path, so the human gate must be visible and authoritative."
            )
            agent.record_memory_write("release.plan")
        return {"change_plan": plan}

    def analyst(state: ReleaseGateState) -> ReleaseGateState:
        objective = state["objective"]
        with mission.agent("data-steward", role="analyst", team="Operations") as agent:
            agent.set_task("Collect evidence about the production dataset and vendor dependency")
            agent.set_goal(objective)
            agent.record_tool_call(
                "support_export_inventory",
                {"scope": "production_support_exports"},
                {
                    "fields": ["email", "ticket_summary", "plan_tier", "usage_metadata"],
                    "contains_customer_data": True,
                    "vendor": "external_classifier",
                },
            )
            evidence_summary = (
                "The production export includes direct customer identifiers and ticket context.\n"
                "The proposed classifier is hosted by an external vendor.\n"
                "No legal or security approval is attached to the rollout request."
            )
            agent.record_memory_write("release.evidence")
        return {"evidence_summary": evidence_summary}

    def verifier(state: ReleaseGateState) -> ReleaseGateState:
        objective = state["objective"]
        with mission.agent("security-verifier", role="verifier", team="Security") as agent:
            agent.set_task("Decide whether the release can proceed without human approval")
            agent.set_goal(objective)
            risk_summary = (
                "Blocking issue: the rollout would transfer customer support data to an external model vendor "
                "without recorded approval, so the release gate must stay closed until a human reviewer decides."
            )
            blocked_state = (
                "Release gate: closed\n"
                "Production rollout: paused\n"
                "Vendor data transfer: blocked\n"
                "Operational posture: waiting for reviewer decision"
            )
            agent.record_review("changes_requested", risk_summary)
            interrupt = agent.request_human_review(
                risk_summary,
                payload={
                    "verification_gate": "security_vendor_approval",
                    "system_effect": "release_pipeline_blocked_or_unblocked",
                    "objective": objective,
                },
            )
            agent.record_memory_write("release.blocked_state")
        mission.set_phase("waiting_for_human")
        lens.flush()
        return {
            "risk_summary": risk_summary,
            "blocked_state": blocked_state,
            "approval_required": True,
            "interrupt_id": str(interrupt["interrupt_id"]),
            "resume_token": str(interrupt["resume_token"]),
        }

    graph.add_node("planner", planner)
    graph.add_node("analyst", analyst)
    graph.add_node("verifier", verifier)
    graph.add_edge(START, "planner")
    graph.add_edge("planner", "analyst")
    graph.add_edge("analyst", "verifier")
    graph.add_edge("verifier", END)
    return graph.compile()


def continue_after_review(
    mission,
    *,
    decision: str,
    objective: str,
    risk_summary: str,
    blocked_state: str,
    human_comment: str,
) -> tuple[str, str]:
    normalized = decision.lower()
    masking_requested = normalized in {"reject", "rejected"} and contains_any(
        human_comment,
        ("mask", "masked", "redact", "redacted", "anonym"),
    )

    with mission.agent("review-router", role="coordinator", team="Governance") as agent:
        agent.set_task("Translate the human decision into a system-level rollout action")
        agent.set_goal(objective)
        agent.record_memory_write("release.human_decision")

    if normalized in {"approve", "approved", "resume", "resumed"}:
        mission.set_phase("executing")
        with mission.agent("release-manager", role="executor", team="Operations") as agent:
            agent.set_task("Resume the rollout after human approval")
            agent.set_goal(objective)
            agent.record_tool_call(
                "deployment_gate",
                {"gate": "security_vendor_approval", "decision": "approved"},
                {
                    "production_release": "enabled",
                    "vendor_data_transfer": "enabled_with_human_approval",
                },
            )
            agent.record_memory_write("deployment.rollout_state")
            agent.record_artifact("outputs/release_gate_report.md", "report")
        outcome = "approved"
        final_state = (
            "Release gate: open\n"
            "Production rollout: resumed\n"
            "Vendor data transfer: enabled with human approval\n"
            "Operational posture: shipping"
        )
        summary = (
            "Human approval opened the release gate, resumed the rollout, and made the graph visibly continue into execution."
        )
        mission.set_phase("completed")
    elif masking_requested:
        mission.set_phase("executing")
        with mission.agent("privacy-remediator", role="remediator", team="Security") as agent:
            agent.set_task("Redesign the rollout to use a masked dataset")
            agent.set_goal(objective)
            agent.record_tool_call(
                "pii_masking_pipeline",
                {"policy": "mask_email_and_ticket_identifiers"},
                {
                    "dataset": "masked_support_export",
                    "email": "hashed",
                    "ticket_summary": "identifier_redacted",
                    "plan_tier": "retained",
                    "usage_metadata": "retained",
                },
            )
            agent.record_memory_write("privacy.masking_strategy")
        with mission.agent("release-manager", role="executor", team="Operations") as agent:
            agent.set_task("Resume the rollout on the masked-data path")
            agent.set_goal(objective)
            agent.record_tool_call(
                "deployment_gate",
                {"gate": "security_vendor_approval", "decision": "approved_after_masking"},
                {
                    "production_release": "enabled",
                    "vendor_data_transfer": "allowed_for_masked_dataset_only",
                },
            )
            agent.record_artifact("outputs/release_gate_report.md", "report")
        outcome = "remediated"
        final_state = (
            "Release gate: open after remediation\n"
            "Production rollout: resumed with masked dataset\n"
            "Vendor data transfer: allowed for masked data only\n"
            "Operational posture: shipping with reviewer-mandated controls"
        )
        summary = (
            "Human rejection forced a remediation branch. The system inserted masking controls and only then resumed execution."
        )
        mission.set_phase("completed")
    else:
        mission.set_phase("failed")
        with mission.agent("release-freeze", role="remediator", team="Security") as agent:
            agent.set_task("Freeze the rollout and redirect into remediation")
            agent.set_goal(objective)
            agent.record_tool_call(
                "deployment_freeze",
                {"gate": "security_vendor_approval", "decision": "rejected"},
                {
                    "production_release": "frozen",
                    "vendor_data_transfer": "blocked",
                },
            )
            agent.record_memory_write("deployment.rollout_state")
            agent.record_artifact("outputs/release_gate_report.md", "report")
        outcome = "rejected"
        final_state = (
            "Release gate: closed\n"
            "Production rollout: frozen\n"
            "Vendor data transfer: blocked\n"
            "Operational posture: remediation required"
        )
        summary = (
            "Human rejection kept the gate closed and visibly stopped the workflow instead of letting it progress."
        )

    report = (
        "# Release Gate HITL Report\n\n"
        f"Decision path: {outcome}\n\n"
        "This scenario demonstrates AgentLens as a non-invasive control plane: LangGraph performs the work, "
        "AgentLens records the graph, and a human decision changes the mission outcome.\n\n"
        "Blocked state before review:\n"
        f"{blocked_state}\n\n"
        "Verifier findings:\n"
        f"{risk_summary}\n\n"
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
        "RELEASE_GATE_OBJECTIVE",
        "Prepare a support automation rollout that cannot ship until a human reviewer clears the data-sharing risk.",
    )
    endpoint = read_env("AGENTLENS_ENDPOINT", "http://localhost:8001")
    lens, mission, handler = auto_instrument(
        objective,
        endpoint=endpoint,
        service_name=read_env("RELEASE_GATE_SERVICE_NAME", "agentlens-release-gate-demo"),
        demo="release_gate_hitl",
    )

    print("[*] Starting LangGraph HITL release-gate demo")
    print(f"[*] AgentLens endpoint: {endpoint}")

    try:
        lens.register_branch_executor(
            mission_id=mission.mission_id,
            name="Local Demo Runner",
            docker_image="python:3.11-slim",
            python_entrypoint="examples/hitl_release_gate_demo.py",
        )
        print("[*] Registered branch executor")
    except Exception as e:
        print(f"[-] Failed to register branch executor: {e}")

    with mission:
        mission.set_phase("planning")
        graph = build_graph(lens, mission)
        result = graph.invoke({"objective": objective}, config={"callbacks": [handler]})

        decision = "not_required"
        comment = "No human comment provided."
        outcome = "not_required"
        if result.get("approval_required"):
            decision, comment = wait_for_human_decision(
                lens,
                mission_id=mission.mission_id,
                interrupt_id=result["interrupt_id"],
                scenario="Production release gate for external-model data sharing",
            )
            with mission.agent("human-review", role="human_review", team="Governance") as agent:
                agent.set_task("Record the human decision for the release gate")
                agent.record_human_decision(decision, comment=comment, interrupt_id=result["interrupt_id"])
            lens.flush()
            outcome, report = continue_after_review(
                mission,
                decision=decision,
                objective=objective,
                risk_summary=result.get("risk_summary", ""),
                blocked_state=result.get("blocked_state", ""),
                human_comment=comment,
            )
        else:
            report = "# Release Gate HITL Report\n\nNo interrupt was raised.\n"

    lens.shutdown()
    output_path = write_output("release_gate_report.md", report)

    print()
    print("[+] Release-gate demo complete")
    print(f"[+] Mission ID: {mission.mission_id}")
    print(f"[+] Review UI: {mission_ui_url(mission.mission_id)}")
    print(f"[+] Final decision: {decision}")
    print(f"[+] Outcome: {outcome}")
    print(f"[+] Output written: {output_path}")


if __name__ == "__main__":
    main()
