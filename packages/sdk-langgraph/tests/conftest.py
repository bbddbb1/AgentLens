"""Make local fixture helpers importable under pytest's importlib mode.

The workspace contains test modules with the same basename in multiple SDKs.
Importlib mode prevents module collisions; this path setup preserves the
LangGraph fixture helpers' existing local imports under that mode.
"""

from __future__ import annotations

import sys
from pathlib import Path

TESTS_DIR = str(Path(__file__).parent)
if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)
