import json
from pathlib import Path

from agentlens_maf.version import MAF_CORE_VERSION, assert_maf_core_version


def test_harness_manifest_identifies_real_components_and_doubles() -> None:
    manifest = json.loads((Path(__file__).parent / "harness_manifest.json").read_text(encoding="utf-8"))

    assert manifest["maf_core_version"] == assert_maf_core_version() == MAF_CORE_VERSION
    assert manifest["components"] == {
        "maf_workflow": "real",
        "otel_otlp": "real",
        "agentlens_express_http": "real",
        "service_authentication": "real",
        "private_bridge_http": "real",
        "postgresql": "real",
        "model_client": "deterministic_test_double",
    }
    assert manifest["declared_test_doubles"] == ["DeterministicModelClient"]
    assert set(manifest["scenarios"]) == {"positive", "accepted_without_terminal", "wrong_scope", "public_output"}
    assert "unique mission" in manifest["database_isolation"]
    assert "no assertion retry" in manifest["readiness_policy"]
    assert "finally" in manifest["cleanup_policy"]
