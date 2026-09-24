"""Parse Census Building Permits Survey (BPS) CBSA-level ASCII files.

The Census Bureau publishes these as comma-separated ASCII text with a
title line, a rule line, a two-row header (grouping "Total" / "1-Unit" /
"2-Units" / "3-4 Units" / "5+ Units" over repeated Bldgs/Units/Value
triplets), and one data row per CBSA — see
https://www2.census.gov/econ/bps/Documentation/cbsaasc.pdf.

This parses by header *text* rather than fixed column offsets, since
Census right-pads columns with spaces and that padding isn't part of the
documented contract. Any structural surprise raises `PermitsParseError`,
which the agent orchestration treats as SPEC_REAL_ESTATE.md §10 requires:
set permits to null for this run, log a warning, and publish the rest —
permits is explicitly an optional source.

The exact monthly filename under https://www2.census.gov/econ/bps/ is
unverified in this build (Census's site is unreachable from this sandbox);
confirm it with `scripts/verify_re_sources.py` before relying on
`download_url_for`.
"""

from __future__ import annotations

from dataclasses import dataclass

BASE_URL = "https://www2.census.gov/econ/bps"


class PermitsParseError(RuntimeError):
    """The file doesn't match the documented CBSA ASCII layout."""


@dataclass(frozen=True)
class CbsaPermits:
    cbsa: str
    name: str
    permits_total: int
    permits_1unit: int
    permits_2unit: int
    permits_3to4unit: int
    permits_5plus: int


def download_url_for(year: int, month: int, kind: str = "cbsa") -> str:
    """Best-effort URL for a given month's CBSA current-month file.

    UNVERIFIED — the exact path and filename pattern must be confirmed
    against https://www2.census.gov/econ/bps/ once that host is reachable.
    """
    return f"{BASE_URL}/{kind.upper()}/{kind}{year:04d}{month:02d}c.txt"


def _find_header_row(lines: list[str]) -> int:
    for i, line in enumerate(lines):
        first_cell = line.split(",")[0].strip()
        if first_cell.upper() == "CSA":
            return i
    raise PermitsParseError("could not find the CSA/CBSA header row")


def parse_cbsa_file(text: str) -> list[CbsaPermits]:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise PermitsParseError("empty file")

    header_idx = _find_header_row(lines)
    headers = [h.strip() for h in lines[header_idx].split(",")]

    def col(name: str) -> int:
        try:
            return headers.index(name)
        except ValueError as exc:
            raise PermitsParseError(f"missing expected column {name!r}") from exc

    idx_cbsa = col("CBSA")
    idx_name = col("Name")

    # Five repeated Bldgs/Units/Value groups, in documented order: Total,
    # 1-Unit, 2-Units, 3-4 Units, 5+ Units. The "Units" header repeats once
    # per group, so take them positionally rather than by (ambiguous) name.
    units_positions = [i for i, h in enumerate(headers) if h == "Units"]
    if len(units_positions) < 5:
        raise PermitsParseError(f"expected 5 'Units' columns, found {len(units_positions)}")
    idx_total, idx_1unit, idx_2unit, idx_3to4, idx_5plus = units_positions[:5]

    out: list[CbsaPermits] = []
    for line in lines[header_idx + 1 :]:
        cells = [c.strip() for c in line.split(",")]
        if len(cells) <= max(idx_cbsa, idx_name, idx_5plus):
            continue
        cbsa = cells[idx_cbsa]
        if not cbsa or not cbsa.isdigit():
            continue  # a footnote/total row, not a CBSA

        def _int(cell: str) -> int:
            cell = cell.replace(",", "").strip()
            return int(cell) if cell else 0

        try:
            out.append(
                CbsaPermits(
                    cbsa=cbsa,
                    name=cells[idx_name],
                    permits_total=_int(cells[idx_total]),
                    permits_1unit=_int(cells[idx_1unit]),
                    permits_2unit=_int(cells[idx_2unit]),
                    permits_3to4unit=_int(cells[idx_3to4]),
                    permits_5plus=_int(cells[idx_5plus]),
                )
            )
        except ValueError as exc:
            raise PermitsParseError(f"could not parse numeric fields in row: {line!r}") from exc
    if not out:
        raise PermitsParseError("header row found but no data rows parsed")
    return out


def by_cbsa(records: list[CbsaPermits]) -> dict[str, CbsaPermits]:
    return {r.cbsa: r for r in records}
