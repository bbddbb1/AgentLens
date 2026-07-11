"""Generate version-guarded, checked-in MAF native-fact fixtures."""

from __future__ import annotations

import json
from pathlib import Path

from agentlens_maf.version import MAF_CORE_VERSION, assert_maf_core_version

FIXTURE_NAMES = (
    "success",
    "agent_tool",
    "request",
    "continuation",
    "alternative",
    "explicit_failure",
    "unknown_telemetry",
    "missing_identity",
    "conflicting_identity",
    "unrelated_later_activity",
)


def expected_native_facts(name: str) -> dict[str, object]:
    base: dict[str, object] = {
        "fixture": name,
        "framework": "ms_agent_framework",
        "maf_core_version": MAF_CORE_VERSION,
        "primary_oracle": "native_facts",
    }
    if name in {"success", "agent_tool"}:
        base["facts"] = ["workflow", "executor", "agent", "tool", "completed"]
    elif name == "request":
        base["facts"] = ["request_info", "request_id", "request_type", "response_type"]
    elif name in {"continuation", "alternative"}:
        base["facts"] = ["request_response_correlation", name]
    elif name == "explicit_failure":
        base["facts"] = ["executor", "failed"]
    elif name == "unknown_telemetry":
        base["facts"] = ["unknown_telemetry", "no_fabricated_semantics"]
    elif name == "missing_identity":
        base["facts"] = ["missing_workflow_or_request_identity", "non_actionable"]
    elif name == "conflicting_identity":
        base["facts"] = ["conflicting_native_identity", "non_actionable"]
    else:
        base["facts"] = ["unrelated_activity", "no_outcome_inference"]
    return base


def generate_all(root: Path) -> list[str]:
    """Write declarations tied to the installed, exact MAF runtime version."""
    installed = assert_maf_core_version()
    root.mkdir(parents=True, exist_ok=True)
    for name in FIXTURE_NAMES:
        fixture_dir = root / name
        fixture_dir.mkdir(exist_ok=True)
        (fixture_dir / "expected_native_facts.json").write_text(
            json.dumps(expected_native_facts(name), indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    manifest = {
        "fixtures": list(FIXTURE_NAMES),
        "maf_core_version": installed,
        "fixture_generator": "packages/sdk-maf/tests/generate_fixtures.py",
        "primary_oracle": "native_facts",
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return list(FIXTURE_NAMES)


if __name__ == "__main__":
    generate_all(Path(__file__).parent / "fixtures" / "otlp")
