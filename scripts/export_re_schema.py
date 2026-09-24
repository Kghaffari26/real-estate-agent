"""Export `schemas/real_estate.schema.json` from the pydantic models in
`agents/real_estate/schema.py` — the site's contract, and what
`tests/test_schema.py`'s stability snapshot compares against.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script, not a module

from agents.real_estate.schema import export_json_schema  # noqa: E402

if __name__ == "__main__":
    export_json_schema()
    print("Wrote schemas/real_estate.schema.json")
