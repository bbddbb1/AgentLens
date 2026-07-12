from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).parents[2]


def test_named_conformance_commands_are_exposed_and_documented() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]
    expected = {
        "conformance:fast",
        "conformance:system:langgraph",
        "conformance:system:maf",
        "conformance:system",
        "conformance:report",
        "conformance:release",
    }
    assert expected <= scripts.keys()
    runner = (ROOT / "scripts" / "conformance.mjs").read_text(encoding="utf-8")
    for mode in ("fast", "system:langgraph", "system:maf", "system", "report", "release"):
        assert mode in runner
    docs = (ROOT / "docs" / "cross-framework-conformance.md").read_text(encoding="utf-8")
    for command in expected:
        assert f"pnpm {command}" in docs


def test_ci_has_separate_fast_and_postgresql_system_layers() -> None:
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "conformance-fast:" in ci
    assert "conformance-system:" in ci
    assert "postgres:16" in ci
    assert "pnpm conformance:release" in ci
