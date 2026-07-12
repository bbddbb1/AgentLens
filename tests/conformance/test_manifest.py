from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from manifest import assert_valid_manifest, load_manifest, validate_manifest


def test_checked_in_manifest_is_valid() -> None:
    payload = assert_valid_manifest()
    assert len(payload["invariants"]) == 12


@pytest.mark.parametrize(
    ("mutation", "needle"),
    [
        (lambda row: row["langgraph"].update(status="unsupported"), "unsupported status"),
        (lambda row: row["langgraph"].update(status="partial", limitation=""), "requires a limitation"),
        (lambda row: row["langgraph"].update(evidence=[]), "evidence paths are required"),
        (lambda row: row["langgraph"].update(commands=[]), "repository commands are required"),
        (lambda row: row["langgraph"].update(evidence=["missing/evidence.json"]), "missing evidence path"),
    ],
)
def test_manifest_rejects_invalid_rows(mutation, needle: str) -> None:
    payload = copy.deepcopy(load_manifest())
    mutation(payload["invariants"][0])
    errors = validate_manifest(payload)
    assert any(needle in error for error in errors), errors


def test_manifest_rejects_duplicate_invariant_ids() -> None:
    payload = copy.deepcopy(load_manifest())
    payload["invariants"].append(copy.deepcopy(payload["invariants"][0]))
    errors = validate_manifest(payload)
    assert any("duplicate invariant id" in error for error in errors)


def test_manifest_has_no_framework_package_import_protocol() -> None:
    payload = load_manifest()
    blob = str(payload).lower()
    for prohibited in ("evidenceprovider", "runtimeadapter", "governanceadapter", "telemetryprofile", "registry", "discovery"):
        assert prohibited not in blob
