
def test_commodity_specs_all_required_fields():
    """Every COMMODITY_SPECS entry has required fields."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    required = {"name", "sector", "exchange", "price_source", "contract_unit",
                "price_unit"}
    for sym, spec in COMMODITY_SPECS.items():
        missing = required - spec.keys()
        assert not missing, f"{sym} missing fields: {missing}"


def test_commodity_specs_sector_values():
    """All sectors are one of the allowed values."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    valid = {"hard", "grains", "meats", "softs", "micros"}
    for sym, spec in COMMODITY_SPECS.items():
        assert spec["sector"] in valid, f"{sym} has invalid sector: {spec['sector']}"


def test_commodity_specs_proxy_has_factor():
    """Proxy price_source entries have proxy_to_usd_per_mt_factor."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    for sym, spec in COMMODITY_SPECS.items():
        if spec["price_source"] == "proxy":
            assert "proxy_to_usd_per_mt_factor" in spec, f"{sym} proxy missing factor"
            assert spec["price_proxy"] is not None, f"{sym} proxy missing price_proxy"


def test_rough_rice_retired_and_replacements_present():
    """2026-07 swap: rice (dead price feed) out; audit-chosen markets in."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    assert "rough_rice" not in COMMODITY_SPECS
    assert COMMODITY_SPECS["wheat_hrw"]["cftc_filter"] == "WHEAT-HRW - CHICAGO BOARD OF TRADE"
    assert COMMODITY_SPECS["platinum"]["cftc_filter"] == "PLATINUM - NEW YORK MERCANTILE EXCHANGE"
    assert "palladium" not in COMMODITY_SPECS  # removed 2026-08-14
    # HRW filter must never swallow SRW or Spring wheat rows
    assert COMMODITY_SPECS["wheat"]["cftc_filter"].startswith("WHEAT-SRW")
