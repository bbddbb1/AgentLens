"""Validation for the static, test-only cross-framework conformance manifest."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

STATUSES = {"covered", "partial", "not_observable", "not_applicable"}
FRAMEWORKS = ("langgraph", "maf")
MANIFEST_PATH = Path(__file__).with_name("manifest.json")


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest(payload: dict[str, Any], repository_root: Path | None = None) -> list[str]:
    """Return shape/path errors without importing either framework package."""
    root = repository_root or MANIFEST_PATH.parents[2]
    errors: list[str] = []
    if payload.get("manifest_kind") != "test_only_cross_framework_invariant_manifest":
        errors.append("manifest_kind must identify the test-only invariant manifest")
    if payload.get("frameworks") != list(FRAMEWORKS):
        errors.append("frameworks must be exactly langgraph and maf")
    rows = payload.get("invariants")
    if not isinstance(rows, list) or not rows:
        return errors + ["invariants must be a non-empty list"]

    seen: set[str] = set()
    for index, row in enumerate(rows):
        prefix = f"invariants[{index}]"
        invariant_id = row.get("id") if isinstance(row, dict) else None
        if not isinstance(invariant_id, str) or not invariant_id.strip():
            errors.append(f"{prefix}: id is required")
            continue
        if invariant_id in seen:
            errors.append(f"{prefix}: duplicate invariant id {invariant_id}")
        seen.add(invariant_id)
        if not row.get("description"):
            errors.append(f"{prefix}: description is required")
        for framework in FRAMEWORKS:
            result = row.get(framework)
            result_prefix = f"{prefix}.{framework}"
            if not isinstance(result, dict):
                errors.append(f"{result_prefix}: framework result is required")
                continue
            status = result.get("status")
            if status not in STATUSES:
                errors.append(f"{result_prefix}: unsupported status {status!r}")
            if status != "covered" and not str(result.get("limitation") or "").strip():
                errors.append(f"{result_prefix}: {status} requires a limitation or rationale")
            evidence = result.get("evidence")
            if not isinstance(evidence, list) or not evidence or any(not isinstance(item, str) or not item.strip() for item in evidence):
                errors.append(f"{result_prefix}: evidence paths are required")
            else:
                for evidence_path in evidence:
                    if not (root / evidence_path).exists():
                        errors.append(f"{result_prefix}: missing evidence path {evidence_path}")
            commands = result.get("commands")
            if not isinstance(commands, list) or not commands or any(not isinstance(item, str) or not item.strip() for item in commands):
                errors.append(f"{result_prefix}: repository commands are required")
    return errors


def assert_valid_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    payload = load_manifest(path)
    errors = validate_manifest(payload)
    if errors:
        raise AssertionError("\n".join(errors))
    return payload


if __name__ == "__main__":
    assert_valid_manifest()
    print(f"valid conformance manifest: {MANIFEST_PATH.as_posix()}")
