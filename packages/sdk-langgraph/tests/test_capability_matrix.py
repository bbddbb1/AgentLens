"""Tests for the LangGraph capability matrix and native-fact oracle format."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from capability_matrix import (
    REQUIRED_CAPABILITY_IDS,
    get_matrix,
    matrix_by_id,
    validate_matrix_completeness,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "otlp"


def test_matrix_contains_all_required_rows():
    by_id = matrix_by_id()
    for capability_id in REQUIRED_CAPABILITY_IDS:
        assert capability_id in by_id


def test_matrix_statuses_and_evidence_links_are_valid():
    errors = validate_matrix_completeness()
    assert errors == [], errors


def test_matrix_statuses_are_supported_literals():
    for row in get_matrix():
        assert row.status in {"covered", "partial", "not_observable", "not_applicable"}


def test_covered_rows_declare_adapter_telemetry_and_fixture():
    for row in get_matrix():
        if row.status != "covered":
            continue
        assert row.adapter_telemetry
        assert row.fixture
        assert row.expected_facts
        assert row.references


def test_partial_and_not_observable_rows_have_limitations():
    for row in get_matrix():
        if row.status in {"partial", "not_observable"}:
            assert row.limitation, row.capability_id


def test_native_fact_expectation_format_for_each_fixture_ref():
    """Each matrix fixture link has an expected_native_facts declaration beside OTLP."""
    from generate_fixtures import generate_all

    generate_all()
    fixtures_needed = {row.fixture for row in get_matrix()}
    for fixture_id in fixtures_needed:
        facts_path = FIXTURES_DIR / fixture_id / "expected_native_facts.json"
        assert facts_path.exists(), f"missing expected facts for fixture {fixture_id}"
        payload = json.loads(facts_path.read_text(encoding="utf-8"))
        assert payload.get("fixture_id") == fixture_id
        assert "oracle" in payload
        assert isinstance(payload["oracle"], dict)
        # Native facts are primary; legacy comparison is secondary metadata only.
        assert payload.get("primary_oracle") == "native_facts"
        if "legacy_comparison" in payload:
            assert payload["legacy_comparison"].get("authoritative") is False


def test_matrix_is_langgraph_specific_not_general_profile():
    for row in get_matrix():
        blob = " ".join(
            [
                row.capability_id,
                row.native_fact,
                row.native_source,
                row.projected_surface,
                row.limitation,
                *row.adapter_telemetry,
                *row.references,
            ]
        ).lower()
        assert "langgraph" in blob or "callback" in blob or "agentlens" in blob or "derived" in blob
        assert "telemetryprofile" not in blob
        assert "framework profile" not in blob
