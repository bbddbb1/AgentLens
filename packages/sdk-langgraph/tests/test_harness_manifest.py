from __future__ import annotations

import json
from pathlib import Path


def test_langgraph_harness_manifest_discloses_real_components_and_scope() -> None:
    manifest = json.loads((Path(__file__).parent / "harness_manifest.json").read_text(encoding="utf-8"))
    assert manifest["framework"] == "langgraph"
    assert manifest["components"]["langgraph_graph"] == "real"
    assert manifest["components"]["agentlens_express_http"] == "real"
    assert manifest["components"]["private_bridge_http"] == "real"
    assert manifest["components"]["postgresql"] == "real via API configuration"
    assert manifest["declared_test_doubles"] == []
    assert set(manifest["scenarios"]) == {"positive", "accepted_without_terminal", "wrong_scope", "public_output"}
