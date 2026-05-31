from __future__ import annotations

import importlib
import json
import mimetypes
import os
import sys
import urllib.request
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
for package_path in (
    ROOT / "packages" / "sdk-core",
    ROOT / "packages" / "otel-semconv",
    ROOT / "packages" / "sdk-langgraph",
):
    sys.path.insert(0, str(package_path))

AgentLens = importlib.import_module("agentlens_sdk").AgentLens
auto_instrument = importlib.import_module("agentlens_langgraph").auto_instrument


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def read_env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def outputs_dir() -> Path:
    # Use sandbox output dir if available (writable volume)
    sandbox_output = os.environ.get("AGENTLENS_SANDBOX_OUTPUT_DIR")
    if sandbox_output:
        path = Path(sandbox_output)
        path.mkdir(exist_ok=True, parents=True)
        return path

    output_dir = Path(__file__).resolve().parent / "outputs"
    output_dir.mkdir(exist_ok=True)
    return output_dir


def write_output(filename: str, content: str) -> Path:
    path = outputs_dir() / filename
    path.write_text(content, encoding="utf-8")
    return path


def mission_ui_url(mission_id: str) -> str:
    base_url = read_env("AGENTLENS_UI_URL", "http://localhost:3000").rstrip("/")
    return f"{base_url}/missions/{mission_id}"


def contains_any(text: str, tokens: Iterable[str]) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return False
    return any(token in normalized for token in tokens)


def wait_for_human_decision(
    lens: AgentLens,
    *,
    mission_id: str,
    interrupt_id: str,
    scenario: str,
    timeout_seconds: float = 1800.0,
) -> tuple[str, str]:
    print()
    print("[*] Human review is now required.")
    print(f"[*] Scenario: {scenario}")
    print(f"[*] Mission ID: {mission_id}")
    print(f"[*] Interrupt ID: {interrupt_id}")
    print(f"[*] Review UI: {mission_ui_url(mission_id)}")
    print("[*] Approve or reject the interrupt in AgentLens, then return to this terminal.")
    print(
        "[*] Example PowerShell decision command:\n"
        f"    $body = @{{ decision = 'approve'; comment = 'Reviewed by human'; "
        "idempotency_key = 'manual-decision-1' } | ConvertTo-Json\n"
        f"    Invoke-RestMethod -Uri 'http://localhost:8001/api/v1/missions/{mission_id}/interrupts/{interrupt_id}/decision' "
        "-Method Post -ContentType 'application/json' -Body $body"
    )
    try:
        interrupt = lens.wait_for_interrupt_decision(
            mission_id,
            interrupt_id,
            poll_interval_seconds=2.0,
            timeout_seconds=timeout_seconds,
        )
    except TimeoutError as exc:
        raise RuntimeError(
            "Timed out waiting for a human decision. Keep the AgentLens API running on "
            "http://localhost:8001 and make the decision from the UI or decision API."
        ) from exc

    decision = str(interrupt.get("decision") or interrupt.get("status") or "")
    comment = str(interrupt.get("decision_comment") or "")
    return decision, comment


def presign_and_upload_artifact(
    endpoint: str,
    *,
    mission_id: str,
    file_path: Path,
    artifact_type: str = "document",
    metadata: dict[str, object] | None = None,
) -> bool:
    if not file_path.exists():
        print(f"[!] Artifact not found: {file_path}")
        return False

    base_url = endpoint.rstrip("/")
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    payload = {
        "name": file_path.name,
        "artifact_type": artifact_type,
        "content_type": content_type,
        "size_bytes": file_path.stat().st_size,
        "metadata": metadata or {},
    }

    try:
        request = urllib.request.Request(
            f"{base_url}/api/v1/missions/{mission_id}/artifacts/presign",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            presign_response = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        print(f"[!] Failed to presign artifact upload: {exc}")
        return False

    upload_url = presign_response.get("upload_url")
    if not upload_url:
        print("[!] Presign response missing upload_url")
        return False

    try:
        upload_request = urllib.request.Request(
            upload_url,
            data=file_path.read_bytes(),
            headers={"Content-Type": content_type},
            method="PUT",
        )
        with urllib.request.urlopen(upload_request, timeout=60) as response:
            if response.status >= 400:
                print(f"[!] Artifact upload failed with status {response.status}")
                return False
    except Exception as exc:
        print(f"[!] Artifact upload failed: {exc}")
        return False

    artifact = presign_response.get("artifact") or {}
    artifact_id = artifact.get("id")
    if artifact_id:
        print(f"[+] Artifact uploaded and registered (id={artifact_id})")
    else:
        print("[+] Artifact uploaded and registered")
    return True
