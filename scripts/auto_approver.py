import sys
import time
import httpx

def auto_approve(endpoint: str = "http://localhost:8001"):
    client = httpx.Client(base_url=endpoint, timeout=10.0)
    
    print("Watching for pending interrupts to auto-approve...")
    try:
        while True:
            try:
                missions_resp = client.get("/api/v1/missions?limit=10")
                if missions_resp.status_code == 200:
                    missions = missions_resp.json().get("missions", [])
                    for mission in missions:
                        if mission.get("status") == "executing" or mission.get("status") == "waiting_for_human":
                            mission_id = mission["id"]
                            interrupts_resp = client.get(f"/api/v1/missions/{mission_id}/interrupts?status=pending")
                            if interrupts_resp.status_code == 200:
                                interrupts = interrupts_resp.json().get("interrupts", [])
                                for interrupt in interrupts:
                                    interrupt_id = interrupt["interrupt_id"]
                                    print(f"Found pending interrupt: {interrupt_id} in mission {mission_id}")
                                    
                                    # Auto approve
                                    decision_resp = client.post(
                                        f"/api/v1/missions/{mission_id}/interrupts/{interrupt_id}/decision",
                                        json={
                                            "decision": "approve",
                                            "comment": "Auto-approved by automation script.",
                                            "idempotency_key": f"auto-app-{interrupt_id}-{int(time.time())}"
                                        }
                                    )
                                    if decision_resp.status_code in (200, 201):
                                        print(f"Successfully auto-approved: {interrupt_id}")
                                    else:
                                        print(f"Failed to approve {interrupt_id}: {decision_resp.text}")
            except Exception as e:
                print(f"Error checking API: {e}")
            
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nExiting auto-approver.")

if __name__ == "__main__":
    auto_approve()
