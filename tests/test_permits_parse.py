from __future__ import annotations

import pytest

from agents.real_estate.fetch_permits import CbsaPermits, PermitsParseError, parse_cbsa_file

# Minimal fixture matching the documented layout: a title line, a rule
# line, then a header row (first cell "CSA") with CBSA, Name, and five
# repeated "Units" columns in Total/1-Unit/2-Units/3-4 Units/5+ Units order,
# then data rows. The module splits on bare commas (no CSV quoting), so
# fixture fields never contain a comma, matching the real fixed-field layout.
HEADER_LINE = (
    "CSA,CBSA,Name,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,"
    "Bldgs,Units,Value,Bldgs,Units,Value"
)
FIXTURE_TEXT = f"""\
Table 1. New Privately-Owned Housing Units Authorized Unadjusted By CBSA
------------------------------------------------------------------------
{HEADER_LINE}
122,26420,Houston-The Woodlands-Sugar Land TX,900,1200,100000,800,850,80000,10,20,1000,5,15,500,85,315,18500
520,12060,Atlanta-Sandy Springs-Alpharetta GA,700,950,90000,600,650,60000,8,16,800,4,12,400,76,272,29200
"""


def test_parse_cbsa_file_returns_records_in_order():
    records = parse_cbsa_file(FIXTURE_TEXT)

    assert records == [
        CbsaPermits(
            cbsa="26420",
            name="Houston-The Woodlands-Sugar Land TX",
            permits_total=1200,
            permits_1unit=850,
            permits_2unit=20,
            permits_3to4unit=15,
            permits_5plus=315,
        ),
        CbsaPermits(
            cbsa="12060",
            name="Atlanta-Sandy Springs-Alpharetta GA",
            permits_total=950,
            permits_1unit=650,
            permits_2unit=16,
            permits_3to4unit=12,
            permits_5plus=272,
        ),
    ]


def test_parse_cbsa_file_header_check_is_case_insensitive():
    text = FIXTURE_TEXT.replace(HEADER_LINE, "csa," + HEADER_LINE.split(",", 1)[1])
    records = parse_cbsa_file(text)
    assert len(records) == 2


def test_parse_cbsa_file_skips_non_numeric_cbsa_rows():
    text = FIXTURE_TEXT + "U.S. Total,,Total,,,,,,,,,,,,,,,\n"
    records = parse_cbsa_file(text)
    assert len(records) == 2  # the footer row (non-numeric CBSA) is skipped


def test_parse_cbsa_file_strips_whitespace_padding_around_cells():
    # Census right-pads columns with spaces; cells are stripped before parsing.
    padded = FIXTURE_TEXT.replace(
        "122,26420,Houston-The Woodlands-Sugar Land TX,900,1200,100000",
        "122, 26420 , Houston-The Woodlands-Sugar Land TX , 900, 1200 ,100000",
    )
    records = parse_cbsa_file(padded)
    assert records[0].cbsa == "26420"
    assert records[0].permits_total == 1200


def test_parse_cbsa_file_treats_blank_units_cell_as_zero():
    text = FIXTURE_TEXT.replace(
        "122,26420,Houston-The Woodlands-Sugar Land TX,900,1200,100000,800,850,80000,10,20,1000,5,15,500,85,315,18500",
        "122,26420,Houston-The Woodlands-Sugar Land TX,900,1200,100000,800,850,80000,10,,1000,5,15,500,85,315,18500",
    )
    records = parse_cbsa_file(text)
    assert records[0].permits_2unit == 0


def test_parse_cbsa_file_missing_units_columns_raises():
    text = FIXTURE_TEXT.replace(HEADER_LINE, "CSA,CBSA,Name,Bldgs,Units,Value")
    with pytest.raises(PermitsParseError):
        parse_cbsa_file(text)


def test_parse_cbsa_file_missing_name_column_raises():
    text = FIXTURE_TEXT.replace("CSA,CBSA,Name,", "CSA,CBSA,")
    with pytest.raises(PermitsParseError):
        parse_cbsa_file(text)


def test_parse_cbsa_file_no_header_row_raises():
    text = "just,some,data\n1,2,3\n"
    with pytest.raises(PermitsParseError):
        parse_cbsa_file(text)


def test_parse_cbsa_file_empty_text_raises():
    with pytest.raises(PermitsParseError):
        parse_cbsa_file("")


def test_parse_cbsa_file_header_only_raises():
    header_only = FIXTURE_TEXT.splitlines()[0:3]
    with pytest.raises(PermitsParseError):
        parse_cbsa_file("\n".join(header_only) + "\n")
