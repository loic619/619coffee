"""Copa Café buying-table accumulator: gviz parsing, session dating, upsert."""
import datetime as dt
import json
from zoneinfo import ZoneInfo

from scraper.sources import brazil_coffeecopa as m

# Verbatim shape of the sheet's gviz answer on 2026-09-03 (probe log): JSONP
# wrapper, a trailing space in "Duro ", an unpriced Cereja Descascado row and
# four empty trailing columns.
GVIZ = ('/*O_o*/\ngoogle.visualization.Query.setResponse(' + json.dumps({
    "version": "0.6", "reqId": "0", "status": "ok",
    "table": {
        "cols": [{"id": "A", "label": "Qualidade", "type": "string"},
                 {"id": "B", "label": "Cata", "type": "number"},
                 {"id": "C", "label": "Preço", "type": "number"},
                 {"id": "D", "label": "D", "type": "string"},
                 {"id": "E", "label": "E", "type": "string"},
                 {"id": "F", "label": "F", "type": "string"},
                 {"id": "G", "label": "G", "type": "string"}],
        "rows": [
            {"c": [{"v": "Rio Minas"}, {"v": 0.2, "f": "20%"}, {"v": 1300.0, "f": "R$ 1.300,00"}, None, None, None, {"v": None}]},
            {"c": [{"v": "Rio Minas"}, {"v": 0.25, "f": "25%"}, {"v": 1280.0, "f": "R$ 1.280,00"}, None, None, None, {"v": None}]},
            {"c": [{"v": "Rio Minas"}, {"v": 0.3, "f": "30%"}, {"v": 1260.0, "f": "R$ 1.260,00"}, None, None, None, {"v": None}]},
            {"c": [{"v": "Duro "}, {"v": 0.2, "f": "20%"}, {"v": 1600.0, "f": "R$ 1.600,00"}, None, None, None, {"v": None}]},
            {"c": [{"v": "Duro "}, {"v": 0.25, "f": "25%"}, {"v": 1570.0, "f": "R$ 1.570,00"}, None, None, None, {"v": None}]},
            {"c": [{"v": "Duro "}, {"v": 0.3, "f": "30%"}, {"v": 1540.0, "f": "R$ 1.540,00"}, None, None, None, {"v": None}]},
            {"c": [{"v": "Cereja Descascado"}, {"v": 0.1, "f": "10%"}, None, None, None, None, {"v": None}]},
        ],
    },
}) + ");")

BRT = ZoneInfo("America/Sao_Paulo")


def test_parse_gviz_reads_priced_rows_only():
    rows = m.parse_gviz(GVIZ)
    assert [(r["grade"], r["cata"], r["price"]) for r in rows] == [
        ("Rio Minas", 20, 1300.0), ("Rio Minas", 25, 1280.0), ("Rio Minas", 30, 1260.0),
        ("Duro", 20, 1600.0), ("Duro", 25, 1570.0), ("Duro", 30, 1540.0),
    ]
    assert [m.quote_key(r) for r in rows] == [
        "rio_minas_20", "rio_minas_25", "rio_minas_30", "duro_20", "duro_25", "duro_30"]


def test_session_date_follows_the_table_opening_hours():
    # Thursday 04:23 BRT (the 07:23 UTC export): Wednesday's list is in force.
    assert m.session_date(dt.datetime(2026, 9, 3, 4, 23, tzinfo=BRT)) == dt.date(2026, 9, 2)
    # Thursday 10:00 BRT: today's.
    assert m.session_date(dt.datetime(2026, 9, 3, 10, 0, tzinfo=BRT)) == dt.date(2026, 9, 3)
    # Monday 04:23 BRT: Friday's.
    assert m.session_date(dt.datetime(2026, 9, 7, 4, 23, tzinfo=BRT)) == dt.date(2026, 9, 4)
    # Saturday, any hour: Friday's.
    assert m.session_date(dt.datetime(2026, 9, 5, 12, 0, tzinfo=BRT)) == dt.date(2026, 9, 4)


def test_export_upserts_one_row_per_session(tmp_path, monkeypatch):
    out = tmp_path / "brazil_coffeecopa.json"
    monkeypatch.setattr(m, "OUT", out)
    monkeypatch.setattr(m, "fetch", lambda: m.parse_gviz(GVIZ))

    m.export_brazil_coffeecopa(now=dt.datetime(2026, 9, 3, 7, 23, tzinfo=dt.UTC))
    doc = json.loads(out.read_text())
    assert [e["date"] for e in doc["history"]] == ["2026-09-02"]
    assert doc["latest"]["quotes"]["rio_minas_20"] == 1300.0
    assert doc["latest"]["quotes"]["duro_20"] == 1600.0
    assert doc["unit"] == "BRL/saca_60kg"

    # Same session again (an afternoon re-run) overwrites rather than duplicates.
    m.export_brazil_coffeecopa(now=dt.datetime(2026, 9, 3, 14, 0, tzinfo=dt.UTC))
    doc = json.loads(out.read_text())
    assert [e["date"] for e in doc["history"]] == ["2026-09-02", "2026-09-03"]
    assert len({e["date"] for e in doc["history"]}) == 2
