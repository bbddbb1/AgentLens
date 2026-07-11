"""Semantic fingerprinting for LangGraph adapter fixture drift detection."""

from __future__ import annotations

import hashlib
import json
import re
from importlib import metadata
from typing import Any

# Attribute keys that carry semantic native/runtime identity or lifecycle facts.
SEMANTIC_ATTR_KEYS = (
    "gen_ai.agent.id",
    "gen_ai.agent.name",
    "gen_ai.agent.framework",
    "gen_ai.agent.task",
    "gen_ai.tool.name",
    "gen_ai.tool.status",
    "gen_ai.request.model",
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens",
    "gen_ai.agent.handoff.target",
    "gen_ai.agent.handoff.reason",
    "gen_ai.agent.interrupt.id",
    "agent.span.kind",
    "agentlens.langgraph.run_id",
    "agentlens.langgraph.parent_run_id",
    "agentlens.langgraph.thread_id",
    "agentlens.langgraph.checkpoint_id",
    "agentlens.langgraph.checkpoint_ns",
    "agentlens.langgraph.activity_correlation_id",
    "agentlens.langgraph.interrupt_request_id",
    "agentlens.langgraph.resume_of_interrupt_id",
    "agentlens.langgraph.retrieval",
    "agentlens.langgraph.explicit_handoff",
    "agentlens.native_execution_key",
)

UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
HEX_ID_RE = re.compile(r"\b[0-9a-f]{16,32}\b", re.IGNORECASE)


def recorded_library_versions() -> dict[str, str]:
    """Best-effort installed package versions for fixture provenance."""
    versions: dict[str, str] = {}
    for dist_name, key in (
        ("langgraph", "langgraph"),
        ("langchain-core", "langchain_core"),
        ("agentlens-sdk-core", "agentlens_sdk_core"),
        ("agentlens-sdk-langgraph", "agentlens_sdk_langgraph"),
        ("opentelemetry-api", "opentelemetry_api"),
    ):
        try:
            versions[key] = metadata.version(dist_name)
        except metadata.PackageNotFoundError:
            versions[key] = "unavailable"
    return versions


def _canonicalize_value(value: Any, id_map: dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {k: _canonicalize_value(v, id_map) for k, v in sorted(value.items(), key=lambda item: item[0])}
    if isinstance(value, list):
        return [_canonicalize_value(item, id_map) for item in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    text = str(value)
    # Map UUIDs and long hex ids to stable placeholders by first-seen order.
    def repl(match: re.Match[str]) -> str:
        raw = match.group(0).lower()
        if raw not in id_map:
            id_map[raw] = f"id:{len(id_map) + 1}"
        return id_map[raw]

    text = UUID_RE.sub(repl, text)
    text = HEX_ID_RE.sub(repl, text)
    return text


def _pick_semantic_attrs(attrs: dict[str, Any] | None) -> dict[str, Any]:
    attrs = attrs or {}
    return {key: attrs[key] for key in SEMANTIC_ATTR_KEYS if key in attrs}


def semantic_fixture_fingerprint(
    spans: list[dict[str, Any]],
    oracle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build a canonical semantic fingerprint of adapter-emitted facts.

    Timestamps and raw IDs are canonicalized; lifecycle, event names, and
    important attributes remain comparable for drift detection.
    """
    id_map: dict[str, str] = {}
    span_facts: list[dict[str, Any]] = []
    for span in spans:
        events = []
        for event in span.get("events") or []:
            events.append(
                {
                    "name": event.get("name"),
                    "attributes": _canonicalize_value(_pick_semantic_attrs(event.get("attributes")), id_map),
                }
            )
        span_facts.append(
            {
                "name": span.get("name") or span.get("operation_name"),
                "status_code": span.get("status_code"),
                "attributes": _canonicalize_value(_pick_semantic_attrs(span.get("attributes")), id_map),
                "events": events,
                "has_parent": bool(span.get("parent_span_id")),
            }
        )

    payload = {
        "spans": span_facts,
        "oracle": _canonicalize_value(oracle or {}, id_map),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return {
        "algorithm": "sha256",
        "digest": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        "canonical": payload,
    }


def fingerprints_equal(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left.get("digest") == right.get("digest")
