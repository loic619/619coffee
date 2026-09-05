# Technical note — `futures_price_history.json` arabica "front" is a deferred contract for 26 months

_Found while building the ENSO × arbitrage study (2026-09-05). Not fixed here: the
study rebuilds its own series from the clean per-contract archive, and this repo's
rule is that production changes take their own PR. This note is the hand-off._

## Affected file

`frontend/public/data/futures_price_history.json`, key `arabica` (the robusta
key is clean). Written by `export_futures_price_history()` in
`backend/scraper/exporters/futures.py`, from `data/contract_prices_archive.json`.

## Period and size

| | |
|---|---|
| first wrong row | **2021-09-06** (front "rolls" KCZ21 → **KCZ23**) |
| last wrong row | **2023-11-03** (KCZ23 becomes the genuine Dec-23 front on 2023-11-06) |
| rows on KCZ23 in that span | **545** of 1,283 arabica rows |
| rows on any Z contract | 594 of 1,283 (Z is ~1/5 of the KC cycle, so ≈ 250 would be normal) |
| published − true front, ¢/lb | median **−4.3**, range −24.4 … +8.2 (e.g. 2022-10-05: 203.50 published vs KCZ22 224.65) |

The roll path the file records for arabica is `KCU21 → KCZ21 → KCZ23 → KCH24 → …`.
A correct path (the study's, from the same archive) is
`KCU21 → KCZ21 → KCH22 → KCK22 → KCN22 → KCU22 → KCZ22 → KCH23 → KCK23 → KCN23 → KCU23 → KCZ23 → KCH24 → …`.

## Cause

`_front_price_series()` picks the max-open-interest contract per day and then
holds the front **monotonic** — it refuses to step back to an earlier expiry
while the incumbent still trades — to stop max-OI flapping around a roll
(robusta really did go N26→K26→N26 in May 2026).

On 2021-09-06 the archive's OI print put **KCZ23** on top. That is a seed
artefact (the archive was seeded from CSV exports; the archive's own front on
that date, by max OI, is KCZ23 while KCK22 carried 125k lots six months later),
and the correct fix for one bad day would be to ignore it. The monotonic guard
did the opposite: once KCZ23 was the front, every later max-OI candidate
(KCH22, KCK22, … KCU23) had an *earlier* expiry, so each was rejected as a
"step back", and the guard held a contract twenty-six months out as the front
until the calendar caught up with it in November 2023.

One bad print plus a guard that can only move forward equals a two-year lock.
The guard needs a sanity bound: a candidate front must be one of the two
nearest unexpired contracts (or: never accept a jump of more than one cycle
month), and a max-OI winner outside that bound should be treated as a bad
print, not a roll.

## Downstream readers of the arabica series (verify each)

Backend:
- `backend/scraper/exporters/price_elasticity.py` — arabica elasticity series
- `backend/scraper/exporters/tender_parity.py` — reads the file (robusta leg; check nothing arabica)
- `backend/scraper/exporters/cot_swap_identity.py`
- `backend/scraper/exporters/options_gamma_map.py`
- `backend/scraper/export_static_json.py` (registry)

Frontend:
- `components/macro/OriginPricesPanel.tsx` — the Origin Farmgate overlay (the file's original purpose)
- `components/futures/B3CoffeePanel.tsx`
- `components/futures/CotDashboard/Step4IndustryPulse.tsx`
- `components/research/CertifiedStocksParity.tsx`
- `components/research/methodology/DifferentialModelNote.tsx`
- `lib/cot/priceSegments.ts`

The open-direction model documents reading `contract_prices_archive.json`
directly, so it is not affected through this file.

## How the study side-stepped it

`research/enso_arbitrage/src/repo_data.front_series()` rebuilds the nearby from
the archive by **calendar rule** — the earliest-expiring listed contract whose
First Notice Day (from `backend/contract_dates.py`) is still more than 5 (KC)
/ 3 (RC) trading days away — choosing among *all* listed contracts, priced or
not, so a partial day becomes a gap rather than a jump. It is deterministic and
cannot be moved by an OI print. A max-OI variant with the two-nearest bound is
kept as a robustness series.
