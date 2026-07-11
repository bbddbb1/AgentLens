import importlib.util
import json
from pathlib import Path

from agentlens_maf.version import MAF_CORE_VERSION


def _generator_module():
    path = Path(__file__).with_name("generate_fixtures.py")
    spec = importlib.util.spec_from_file_location("maf_fixture_generator", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_generator_writes_all_required_version_fingerprinted_fixtures(tmp_path: Path) -> None:
    generator = _generator_module()
    names = generator.generate_all(tmp_path)

    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert names == list(generator.FIXTURE_NAMES)
    assert manifest["maf_core_version"] == MAF_CORE_VERSION
    assert manifest["fixture_generator"] == "packages/sdk-maf/tests/generate_fixtures.py"
    for name in names:
        facts = json.loads((tmp_path / name / "expected_native_facts.json").read_text(encoding="utf-8"))
        assert facts["maf_core_version"] == MAF_CORE_VERSION
