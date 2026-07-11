"""Runtime guard for version-sensitive MAF fixtures and tests."""

from importlib.metadata import PackageNotFoundError, version

MAF_CORE_DISTRIBUTION = "agent-framework-core"
MAF_CORE_VERSION = "1.10.0"


def assert_maf_core_version() -> str:
    """Return the installed MAF Core version or fail before fixture use."""
    try:
        installed_version = version(MAF_CORE_DISTRIBUTION)
    except PackageNotFoundError as error:
        raise RuntimeError(
            f"{MAF_CORE_DISTRIBUTION}=={MAF_CORE_VERSION} is required for MAF fixtures"
        ) from error

    if installed_version != MAF_CORE_VERSION:
        raise RuntimeError(
            "MAF fixture compatibility requires "
            f"{MAF_CORE_DISTRIBUTION}=={MAF_CORE_VERSION}; found {installed_version}"
        )
    return installed_version
