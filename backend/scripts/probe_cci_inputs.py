#!/usr/bin/env python3
"""One-off diagnostic: can the CCI basket be widened to HNL, UGX and ETB?

Run in CI (the dev sandbox's egress proxy denies both endpoints), read the log,
then set the weights from what it actually reports rather than from memory.

Answers two questions:
  1. Does the jsDelivr currency-api carry hnl/ugx/etb, with the same history
     depth as the pairs already in the basket? A pegged or thinly-published
     currency that flat-lines would add weight without adding information.
  2. What are USDA PSD export volumes for every exporter in the basket, from
     ONE pull? The weights table documents raw world-export shares, but those
     cannot be reproduced from our own shipped series (Colombia's figure
     implies a 135.6M-bag world, Indonesia's a 170.4M one), so all eight shares
     have to be recomputed on a single consistent basis.
"""
import csv
import io
import sys
import zipfile
from collections import defaultdict

import requests

FX_BASE = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api"
BASKET = ["brl", "vnd", "cop", "idr", "pen", "gtq"]      # already tracked
CANDIDATES = ["hnl", "ugx", "etb"]                        # proposed additions

PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip"
UA = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

EXPORTERS = {
    "brazil": ("brazil",), "vietnam": ("vietnam",), "colombia": ("colombia",),
    "indonesia": ("indonesia",), "peru": ("peru",),
    "honduras": ("honduras",), "uganda": ("uganda",), "ethiopia": ("ethiopia",),
}


def probe_fx() -> None:
    print("=" * 70)
    print("1. FX API — currency availability")
    print("=" * 70)
    try:
        r = requests.get(f"{FX_BASE}@latest/v1/currencies/usd.json", timeout=30)
        r.raise_for_status()
        rates = r.json().get("usd", {})
    except Exception as e:
        print(f"  FAILED: {type(e).__name__}: {e}")
        return
    print(f"  currencies published: {len(rates)}")
    for c in BASKET + CANDIDATES:
        v = rates.get(c)
        tag = "tracked " if c in BASKET else "CANDIDATE"
        print(f"   {tag} {c.upper():4s} {'= ' + repr(v) if v is not None else 'MISSING'}")

    # Does a candidate actually MOVE, or is it pegged/stale? Sample ~8 months.
    print("\n  variation check (a flat series adds weight without information):")
    dates = ["2026-01-15", "2026-03-16", "2026-05-15", "2026-07-15", "2026-08-14"]
    series = defaultdict(list)
    for d in dates:
        try:
            rr = requests.get(f"{FX_BASE}@{d}/v1/currencies/usd.json", timeout=30)
            if not rr.ok:
                print(f"   {d}: HTTP {rr.status_code}")
                continue
            day = rr.json().get("usd", {})
            for c in BASKET + CANDIDATES:
                if day.get(c) is not None:
                    series[c].append((d, day[c]))
        except Exception as e:
            print(f"   {d}: {type(e).__name__}")
    for c in BASKET + CANDIDATES:
        pts = series.get(c, [])
        if len(pts) < 2:
            print(f"   {c.upper():4s} only {len(pts)} point(s) — cannot assess")
            continue
        vals = [v for _d, v in pts]
        rng = (max(vals) - min(vals)) / min(vals) * 100 if min(vals) else 0
        print(f"   {c.upper():4s} {len(pts)} pts  first={vals[0]:<14.6g} last={vals[-1]:<14.6g} range={rng:6.2f}%")


def probe_psd() -> None:
    print()
    print("=" * 70)
    print("2. USDA PSD — exports by origin, one consistent pull")
    print("=" * 70)
    try:
        r = requests.get(PSD_URL, headers=UA, timeout=120)
        r.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
            raw = zf.read(name)
    except Exception as e:
        print(f"  FAILED: {type(e).__name__}: {e}")
        return

    reader = csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace")))
    fields = {f.lower().strip(): f for f in (reader.fieldnames or [])}
    print(f"  columns: {list(fields)[:10]}")

    def g(row, *names):
        for n in names:
            if n in fields:
                return (row.get(fields[n]) or "").strip()
        return ""

    totals = defaultdict(dict)          # year -> country -> exports
    world = defaultdict(float)
    for row in reader:
        attr = g(row, "attribute_description", "attribute").lower()
        if "export" not in attr:
            continue
        country = g(row, "country_name", "country").lower()
        year = g(row, "market_year", "year")
        try:
            val = float(g(row, "value") or 0)
        except ValueError:
            continue
        if "bean" in attr or "roast" in attr or "soluble" in attr:
            continue      # keep the headline green-export attribute only
        for name, aliases in EXPORTERS.items():
            if country in aliases:
                totals[year][name] = totals[year].get(name, 0) + val
        world[year] += val

    for year in sorted(totals)[-3:]:
        w = world[year]
        print(f"\n  --- market year {year} (world total {w:,.0f} k bags) ---")
        for name in EXPORTERS:
            v = totals[year].get(name)
            if v is None:
                print(f"   {name:10s} — not found")
                continue
            print(f"   {name:10s} {v:>9,.0f} k bags   {v/w*100 if w else 0:5.2f}% of world")


if __name__ == "__main__":
    probe_fx()
    probe_psd()
    sys.stdout.flush()
