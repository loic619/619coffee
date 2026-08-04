"""
cot_cropyear_xray.py
Cross-commodity generalization of the September X-ray: every liquid CFTC
market whose disaggregated COT carries a real old/other CROP-YEAR split gets
the same treatment — as the crop year's earlier delivery months expire, the
"old" bucket degenerates to the LAST crop-year contract alone, exposing
single-contract cohort positioning in the weeks before its delivery month.

Markets (CFTC contract codes are stable across renames):
  coffee  083731  Oct–Sep crop year → last old month Sep
  cocoa   073732  Oct–Sep → Sep (coffee's structural twin)
  sugar   080732  Oct–Sep → Jul (no Aug/Sep contract; Oct starts new crop)
  cotton  033661  Aug–Jul → Jul
  wheat   001602  Jun–May → May (CBOT SRW)
  corn    002602  Sep–Aug → detected
  beans   005602  Sep–Aug → detected

The last-old month is NOT hardcoded: each market-year's crop-year roll is
DETECTED from the data (the week `share_old` jumps from collapsed to ~all of
OI — the same signature validated on coffee, e.g. 0.3% → 94.9% on
2024-09-03), and the majority roll month across years anchors the alignment:
  dtr = days until the 1st of the roll month (the last old contract's
        delivery month). Rows span [roll − 120d, roll − 1d].

Same sourcing discipline as cot_sept_study: append-once per market-year with
source tags; CFTC zips fetched live (works in production/Actions, degrades
gracefully where cftc.gov is egress-blocked); coffee can fall back to the
app's own cot.json old/other fields.
"""
import csv
import io
import json
import urllib.request
import zipfile
from collections import Counter
from datetime import UTC, date, datetime

from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json, validate_cropyear_xray

OUT_PATH = OUT_DIR / "cropyear_xray.json"

CFTC_HIST_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_hist_2006_2016.zip"
CFTC_YEAR_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
FIRST_YEAR = 2006

MARKETS = [
    {"key": "coffee", "label": "Coffee C (KC)",    "code": "083731"},
    {"key": "cocoa",  "label": "Cocoa (CC)",       "code": "073732"},
    {"key": "sugar",  "label": "Sugar No. 11 (SB)", "code": "080732"},
    {"key": "cotton", "label": "Cotton No. 2 (CT)", "code": "033661"},
    {"key": "wheat",  "label": "Wheat SRW (W)",    "code": "001602"},
    {"key": "corn",   "label": "Corn (C)",         "code": "002602"},
    {"key": "beans",  "label": "Soybeans (S)",     "code": "005602"},
]
CODES = {m["code"]: m["key"] for m in MARKETS}


def _int(v) -> int:
    try:
        return int(float(str(v).strip().replace(",", "")))
    except Exception:
        return 0


def _row_date(row: dict):
    iso = (row.get("Report_Date_as_YYYY-MM-DD") or "").strip()
    if iso:
        try:
            return datetime.strptime(iso[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    raw = (row.get("As_of_Date_In_Form_YYMMDD") or "").strip()
    try:
        return datetime.strptime(raw, "%y%m%d").date()
    except ValueError:
        return None


def _get(row: dict, *names) -> int:
    for n in names:
        if n in row and str(row[n]).strip() != "":
            return _int(row[n])
    return 0


def _fetch_zip(url: str) -> dict[str, list[dict]]:
    """One CFTC disagg zip → {market_key: [normalized weekly records]}."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
    out: dict[str, list[dict]] = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            if not (name.endswith(".txt") or name.endswith(".csv")):
                continue
            with z.open(name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
                for row in reader:
                    code = (row.get("CFTC_Contract_Market_Code") or "").strip()
                    key = CODES.get(code)
                    if not key:
                        continue
                    d = _row_date(row)
                    if d is None:
                        continue
                    out.setdefault(key, []).append({
                        "date": d.isoformat(),
                        "oi": _get(row, "Open_Interest_Old"),
                        "oi_all": _get(row, "Open_Interest_All"),
                        "comm_l": _get(row, "Prod_Merc_Positions_Long_Old"),
                        "comm_s": _get(row, "Prod_Merc_Positions_Short_Old"),
                        "mm_l": _get(row, "M_Money_Positions_Long_Old"),
                        "mm_s": _get(row, "M_Money_Positions_Short_Old"),
                    })
    return out


def _coffee_fallback() -> list[dict]:
    """Coffee-only fallback from the app's stored COT (ny.*_old, 2024→now)."""
    rows = []
    for name in ("cot.json", "cot_recent.json"):
        try:
            data = json.loads((OUT_DIR / name).read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, list):
            rows.extend(data)
    by_date: dict[str, dict] = {}
    for r in rows:
        ny = (r or {}).get("ny") or {}
        if ny.get("mm_long_old") is None:
            continue
        g = lambda k, ny=ny: ny.get(k) or 0  # bind ny per-iteration (B023)
        oi_old = (g("pmpu_long_old") + g("swap_long_old") + g("swap_spread_old")
                  + g("mm_long_old") + g("mm_spread_old")
                  + g("other_long_old") + g("other_spread_old") + g("nr_long_old"))
        by_date[r["date"]] = {
            "date": r["date"], "oi": oi_old, "oi_all": g("oi_total"),
            "comm_l": g("pmpu_long_old"), "comm_s": g("pmpu_short_old"),
            "mm_l": g("mm_long_old"), "mm_s": g("mm_short_old"),
        }
    return sorted(by_date.values(), key=lambda x: x["date"])


def _detect_roll_month(records: list[dict]) -> int | None:
    """The crop-year roll month: share_old jumps from collapsed to ~all of OI
    between consecutive weeks. Majority month across all detected jumps."""
    recs = sorted(records, key=lambda r: r["date"])
    votes: Counter = Counter()
    for prev, curr in zip(recs, recs[1:]):
        if not prev["oi_all"] or not curr["oi_all"]:
            continue
        s0, s1 = prev["oi"] / prev["oi_all"], curr["oi"] / curr["oi_all"]
        if s0 < 0.35 and s1 > 0.60 and (s1 - s0) > 0.4:
            votes[int(curr["date"][5:7])] += 1
    if not votes:
        return None
    return votes.most_common(1)[0][0]


def _build_market(records: list[dict], roll_month: int, source: str,
                  existing: dict, current_year: int) -> dict:
    """Split a market's weekly records into per-crop-cycle windows aligned on
    days-to-roll (dtr): rows in [roll−120d, roll−1d]. Cycle year = the roll
    year. Append-once: existing cftc-sourced past years are kept."""
    years: dict[str, dict] = {
        y: v for y, v in (existing.get("years") or {}).items()
        if v.get("source") == "cftc" and int(y) < current_year
    }
    by_year: dict[int, list[dict]] = {}
    for rec in records:
        d = date.fromisoformat(rec["date"])
        roll = date(d.year if (d.month, d.day) < (roll_month, 1) else d.year + 1, roll_month, 1)
        dtr = (roll - d).days
        if not (1 <= dtr <= 120):
            continue
        r = dict(rec)
        r["dtr"] = dtr
        r["mm_net"] = r["mm_l"] - r["mm_s"]
        r["comm_net"] = r["comm_l"] - r["comm_s"]
        r["share"] = round(r["oi"] / r["oi_all"], 4) if r["oi_all"] else None
        by_year.setdefault(roll.year, []).append(r)
    for y, rows in by_year.items():
        if str(y) in years:
            continue
        years[str(y)] = {"source": source, "rows": sorted(rows, key=lambda x: x["date"])}
    return {"roll_month": roll_month, "years": dict(sorted(years.items()))}


def export_cot_cropyear_xray() -> None:
    today = datetime.now(UTC).date()
    existing = {}
    try:
        existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    existing_markets = existing.get("markets") or {}

    # Which years still need fetching? (any market missing that year)
    def _have(mkey: str, y: int) -> bool:
        yrs = (existing_markets.get(mkey) or {}).get("years") or {}
        v = yrs.get(str(y))
        return bool(v and v.get("source") == "cftc")

    needed_years = [
        y for y in range(FIRST_YEAR, today.year + 1)
        if y >= today.year or not all(_have(m["key"], y) for m in MARKETS)
    ]
    fetched: dict[str, list[dict]] = {}
    if needed_years:
        urls = ([(CFTC_HIST_URL, "hist")] if any(y <= 2016 for y in needed_years) else []) + \
               [(CFTC_YEAR_URL.format(year=y), y) for y in needed_years if y > 2016]
        for url, tag in urls:
            try:
                part = _fetch_zip(url)
                for k, v in part.items():
                    fetched.setdefault(k, []).extend(v)
                print(f"  cropyear_xray → fetched {tag}: " +
                      ", ".join(f"{k}:{len(v)}" for k, v in sorted(part.items())))
            except Exception as e:
                print(f"  cropyear_xray → CFTC fetch unavailable ({tag}): {e}")

    markets_out: dict[str, dict] = {}
    for m in MARKETS:
        key = m["key"]
        recs, source = fetched.get(key) or [], "cftc"
        if not recs and key == "coffee":
            recs, source = _coffee_fallback(), "app"
        prior = existing_markets.get(key) or {}
        roll = _detect_roll_month(recs) if recs else None
        roll = roll or prior.get("roll_month")
        if not roll:
            if prior:
                markets_out[key] = prior          # keep whatever we had
            continue
        built = _build_market(recs, roll, source, prior, today.year)
        built["label"] = m["label"]
        built["code"] = m["code"]
        markets_out[key] = built

    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "meta": {
            "premise": "For each market, the CFTC old-crop bucket degenerates to the crop year's LAST "
                       "delivery contract as earlier months expire — single-contract cohort positioning.",
            "alignment": "dtr = days until the 1st of the (empirically detected) crop-year roll month; "
                         "rows span the 120 days before the roll.",
            "roll_detection": "share_old jumping <0.35 → >0.60 week-over-week; majority month across years.",
            "units": "contracts",
        },
        "markets": markets_out,
    }
    safe_write_json(OUT_PATH, payload, validate_cropyear_xray)
    for k, v in sorted(markets_out.items()):
        yrs = v.get("years") or {}
        n = sum(len(x["rows"]) for x in yrs.values())
        print(f"  cropyear_xray: {k:7s} roll month {v.get('roll_month'):>2} · {len(yrs)} cycles · {n} rows")
