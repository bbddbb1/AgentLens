from importlib.metadata import PackageNotFoundError

import pytest

from agentlens_maf import MAF_CORE_VERSION, assert_maf_core_version
from agentlens_maf import version as version_module


def test_installed_maf_core_matches_reference_version() -> None:
    assert assert_maf_core_version() == MAF_CORE_VERSION


def test_version_guard_rejects_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(version_module, "version", lambda _: "1.10.1")

    with pytest.raises(RuntimeError, match="found 1.10.1"):
        assert_maf_core_version()


def test_version_guard_rejects_missing_distribution(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(_: str) -> str:
        raise PackageNotFoundError

    monkeypatch.setattr(version_module, "version", missing)

    with pytest.raises(RuntimeError, match="is required"):
        assert_maf_core_version()
