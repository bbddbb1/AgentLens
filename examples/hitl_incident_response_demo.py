from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from common import AgentLens, ROOT, auto_instrument, contains_any, load_dotenv, mission_ui_url, presign_and_upload_artifact, read_env, wait_for_human_decision, write_output


class IncidentState(TypedDict, total=False):
    objective: str
    alert_summary: str
    evidence_summary: str
    containment_plan: str
    approval_required: bool
    interrupt_id: str
    blocked_state: str


def build_graph(lens: AgentLens, mission):
    graph = StateGraph(IncidentState)

    def intake(state: IncidentState) -> IncidentState:
        objective = state["objective"]
        with mission.agent("incident-intake", role="coordinator", team="Security") as agent:
            agent.set_task("Triage the suspicious-account alert stream")
            agent.set_goal(objective)
            agent.record_tool_call(
                "alert_router",
                {"queue": "account_recovery_spike"},
                {"alerts": 17, "severity": "high", "suspected_scope": "enterprise_eu_customers"},
            )
            alert_summary = (
                "Seventeen account recovery alerts arrived in twelve minutes.\n"
                "The affected population appears to be enterprise EU users.\n"
                "The automated containment playbook would revoke active sessions platform-wide."
            )
            agent.record_memory_write("incident.alert_summary")
        return {"alert_summary": alert_summary}

    def investigator(state: IncidentState) -> IncidentState:
        objective = state["objective"]
        with mission.agent("forensics-analyst", role="investigator", team="Security") as agent:
            agent.set_task("Collect the minimum evidence needed to justify containment")
            agent.set_goal(objective)
            agent.record_tool_call(
                "session_correlation",
                {"window_minutes": 15},
                {
                    "correlated_accounts": 11,
                    "new_ip_clusters": 3,
                    "confidence": "medium",
                },
            )
            evidence_summary = (
                "Evidence suggests coordinated misuse but is not yet conclusive.\n"
                "A platform-wide session revoke would interrupt active enterprise work.\n"
                "Human judgment is required before the system performs a broad containment action."
            )
            containment_plan = (
                "Primary plan: revoke active sessions for the affected tenant cohort and force re-authentication.\n"
                "Fallback plan: hold containment, continue monitoring, and gather additional evidence."
            )
            agent.record_memory_write("incident.evidence_summary")
        return {
            "evidence_summary": evidence_summary,
            "containment_plan": containment_plan,
        }

    def commander(state: IncidentState) -> IncidentState:
        objective = state["objective"]
        with mission.agent("incident-commander", role="reviewer", team="Security") as agent:
            agent.set_task("Escalate the containment decision to a human reviewer")
            agent.set_goal(objective)
            blocked_state = (
                "Containment state: paused\n"
                "Customer sessions: unchanged\n"
                "Investigation posture: awaiting reviewer decision\n"
                "Operational risk: active but not yet contained"
            )
            reason = (
                "Human approval is required before the workflow revokes customer sessions across a live enterprise cohort."
            )
            agent.record_review("changes_requested", reason)
            interrupt = agent.request_human_review(
                reason,
                payload={
                    "verification_gate": "incident_containment_authorization",
                    "system_effect": "customer_sessions_revoked_or_left_active",
                    "objective": objective,
                },
            )
            agent.record_memory_write("incident.blocked_state")
        mission.set_phase("waiting_for_human")
        lens.flush()
        return {
            "approval_required": True,
            "interrupt_id": str(interrupt["interrupt_id"]),
            "blocked_state": blocked_state,
        }

    graph.add_node("intake", intake)
    graph.add_node("investigator", investigator)
    graph.add_node("commander", commander)
    graph.add_edge(START, "intake")
    graph.add_edge("intake", "investigator")
    graph.add_edge("investigator", "commander")
    graph.add_edge("commander", END)
    return graph.compile()


def continue_after_review(
    mission,
    *,
    decision: str,
    objective: str,
    blocked_state: str,
    evidence_summary: str,
    containment_plan: str,
    human_comment: str,
) -> tuple[str, str]:
    normalized = decision.lower()
    monitoring_requested = normalized in {"reject", "rejected"} and contains_any(
        human_comment,
        ("monitor", "evidence", "observe", "watch"),
    )

    with mission.agent("incident-router", role="coordinator", team="Governance") as agent:
        agent.set_task("Route the human decision into the incident workflow")
        agent.set_goal(objective)
        agent.record_memory_write("incident.human_decision")

    if normalized in {"approve", "approved", "resume", "resumed"}:
        mission.set_phase("executing")
        with mission.agent("containment-operator", role="executor", team="Security") as agent:
            agent.set_task("Execute the approved containment action")
            agent.set_goal(objective)
            agent.record_tool_call(
                "revoke_sessions",
                {"scope": "affected_enterprise_cohort"},
                {
                    "revoked_sessions": 11,
                    "forced_reauthentication": True,
                    "customer_impact_window_minutes": 15,
                },
            )
            agent.record_memory_write("incident.containment_state")
        with mission.agent("customer-comms", role="communicator", team="Operations") as agent:
            agent.set_task("Prepare the customer-facing advisory")
            agent.set_goal(objective)
            agent.record_artifact("outputs/incident_response_report.md", "report")
        outcome = "contained"
        final_state = (
            "Containment state: executed\n"
            "Customer sessions: revoked for affected cohort\n"
            "Investigation posture: stabilized\n"
            "Operational risk: reduced by human-authorized intervention"
        )
        summary = (
            "The human reviewer authorized a disruptive action, and the graph continued into explicit containment work."
        )
        mission.set_phase("completed")
    elif monitoring_requested:
        mission.set_phase("executing")
        with mission.agent("forensics-analyst", role="investigator", team="Security") as agent:
            agent.set_task("Collect additional evidence instead of revoking sessions immediately")
            agent.set_goal(objective)
            agent.record_tool_call(
                "extended_log_capture",
                {"duration_minutes": 30},
                {
                    "new_signals_requested": ["device_fingerprint", "geo_velocity", "tenant_admin_actions"],
                    "session_revocation": "deferred",
                },
            )
            agent.record_memory_write("incident.extended_monitoring")
            agent.record_artifact("outputs/incident_response_report.md", "report")
        outcome = "monitoring"
        final_state = (
            "Containment state: deferred\n"
            "Customer sessions: left active\n"
            "Investigation posture: extended evidence collection\n"
            "Operational risk: accepted temporarily under human direction"
        )
        summary = (
            "The reviewer rejected immediate containment but redirected the workflow into a deliberate evidence-gathering branch."
        )
        mission.set_phase("completed")
    else:
        mission.set_phase("failed")
        with mission.agent("incident-archive", role="remediator", team="Security") as agent:
            agent.set_task("Stop automated containment and hold the incident for manual follow-up")
            agent.set_goal(objective)
            agent.record_tool_call(
                "incident_hold",
                {"reason": "reviewer_rejected_containment"},
                {"automation": "stopped", "manual_followup_required": True},
            )
            agent.record_artifact("outputs/incident_response_report.md", "report")
        outcome = "held"
        final_state = (
            "Containment state: not executed\n"
            "Customer sessions: unchanged\n"
            "Investigation posture: handed off for manual follow-up\n"
            "Operational risk: unresolved"
        )
        summary = (
            "The reviewer kept the automation from taking broad action, so the workflow visibly terminated into a manual-handoff state."
        )

    report = (
        "# Incident Response HITL Report\n\n"
        f"Decision path: {outcome}\n\n"
        "This scenario demonstrates the human-in-the-loop boundary on a live operational action: the multi-agent workflow can investigate, "
        "but only a reviewer can authorize broad customer-impacting containment.\n\n"
        "Blocked state before review:\n"
        f"{blocked_state}\n\n"
        "Evidence collected before review:\n"
        f"{evidence_summary}\n\n"
        "Planned automated response:\n"
        f"{containment_plan}\n\n"
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
        "INCIDENT_RESPONSE_OBJECTIVE",
        "Investigate a suspicious recovery-event spike without allowing automation to revoke customer sessions until a human approves it.",
    )
    endpoint = read_env("AGENTLENS_ENDPOINT", "http://localhost:8001")
    lens, mission, handler = auto_instrument(
        objective,
        endpoint=endpoint,
        service_name=read_env("INCIDENT_RESPONSE_SERVICE_NAME", "agentlens-incident-response-demo"),
        demo="incident_response_hitl",
    )

    print("[*] Starting LangGraph HITL incident-response demo")
    print(f"[*] AgentLens endpoint: {endpoint}")

    with mission:
        mission.set_phase("triage")
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
                scenario="Customer-impacting incident containment approval",
            )
            with mission.agent("human-review", role="human_review", team="Governance") as agent:
                agent.set_task("Record the human decision for the incident workflow")
                agent.record_human_decision(decision, comment=comment, interrupt_id=result["interrupt_id"])
            lens.flush()
            outcome, report = continue_after_review(
                mission,
                decision=decision,
                objective=objective,
                blocked_state=result.get("blocked_state", ""),
                evidence_summary=result.get("evidence_summary", ""),
                containment_plan=result.get("containment_plan", ""),
                human_comment=comment,
            )
        else:
            report = "# Incident Response HITL Report\n\nNo interrupt was raised.\n"

    lens.shutdown()
    output_path = write_output("incident_response_report.md", report)
    presign_and_upload_artifact(
        endpoint,
        mission_id=mission.mission_id,
        file_path=output_path,
        artifact_type="report",
        metadata={"scenario": "incident_response"},
    )

    print()
    print("[+] Incident-response demo complete")
    print(f"[+] Mission ID: {mission.mission_id}")
    print(f"[+] Review UI: {mission_ui_url(mission.mission_id)}")
    print(f"[+] Final decision: {decision}")
    print(f"[+] Outcome: {outcome}")
    print(f"[+] Output written: {output_path}")


if __name__ == "__main__":
    main()
