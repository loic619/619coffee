# backend/scraper/tests/test_cepea_conilon_indicator.py
"""CEPEA conilon indicator: table parsing + upsert round-trip (offline)."""
import io
import json
import urllib.request

from scraper.sources import cepea_conilon_indicator as cci

# Shape of the noticiasagricolas indicador page: a sidebar cotação table
# (no "Valor" header — must be skipped) followed by the indicator table
# `Data | Valor R$ | Variação (%)` with one row per session.
_PAGE = """
<html><body>
<table>
  <tr><th>Contrato</th><th>Último</th></tr>
  <tr><td>CNLF27</td><td>1.100,00</td></tr>
</table>
<table>
  <tr><th>Data</th><th>Valor R$</th><th>Variação (%)</th></tr>
  <tr><td>12/08/2026</td><td>1.041,37</td><td>+0,25</td></tr>
  <tr><td>11/08/2026</td><td>1.038,77</td><td>-0,10</td></tr>
  <tr><td>10/08/2026</td><td>1.039,81</td><td>+0,42</td></tr>
</table>
</body></html>
"""


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _stub_urlopen(monkeypatch):
    seen = []

    def fake(req, timeout=0):
        seen.append(req.full_url)
        return _Resp(_PAGE.encode("utf-8"))

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return seen


def test_fetch_parses_every_indicator_row(monkeypatch):
    seen = _stub_urlopen(monkeypatch)
    rows = cci.fetch()
    assert seen == [cci.BASE]
    assert rows == [
        {"date": "2026-08-12", "price": 1041.37, "var": "+0,25"},
        {"date": "2026-08-11", "price": 1038.77, "var": "-0,10"},
        {"date": "2026-08-10", "price": 1039.81, "var": "+0,42"},
    ]
    # Date-suffix variant hits the dated URL.
    cci.fetch("2026-08-01")
    assert seen[-1] == cci.BASE + "/2026-08-01"


def test_export_upserts_and_sorts(tmp_path, monkeypatch):
    _stub_urlopen(monkeypatch)
    monkeypatch.setattr(cci, "OUT", tmp_path / "cepea_conilon_indicator.json")
    (tmp_path / "cepea_conilon_indicator.json").write_text(json.dumps({
        "unit": "BRL/saca_60kg", "source": "x",
        "history": [{"date": "2026-08-11", "price": 999.0, "var": ""},
                    {"date": "2026-08-07", "price": 1035.0, "var": "+0,10"}],
    }))
    cci.export_cepea_conilon_indicator()
    doc = json.loads((tmp_path / "cepea_conilon_indicator.json").read_text())
    hist = doc["history"]
    assert [e["date"] for e in hist] == ["2026-08-07", "2026-08-10", "2026-08-11", "2026-08-12"]
    # The fetched row wins over the stale stored value for the same date.
    assert hist[2]["price"] == 1038.77
