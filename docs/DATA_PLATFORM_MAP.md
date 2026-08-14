# Coffee Intel Map — Data Platform Map

_Last updated: 2026-05-23 (1.7 now pings the Vercel deploy hook to publish `[skip ci]` data commits)_

## TODO / open items

- [ ] **Add `VERCEL_DEPLOY_HOOK` repo secret** — without it the daily redeploy
      (step in 1.7) no-ops and production stays stale on `[skip ci]` data commits.
      Vercel → Settings → Git → Deploy Hooks → create one on `main`, copy the URL →
      GitHub repo Settings → Secrets and variables → Actions → new secret
      `VERCEL_DEPLOY_HOOK`. _One-time; everything else is already wired._
- [ ] **8-day OI gap (2026-03-26 → 2026-04-05)** — between the bulk OI CSV's end
      (2026-03-25) and the live archive's start (~2026-04-06). Those COT-Tuesdays
      keep their pre-rebuild price. _User to supply the gap OI data; load with
      `load_contract_csv.py --kind oi`._
- [x] **Origin export data for Colombia / Honduras / Indonesia / Ethiopia**
      — DONE (annual). The dead ICO path is replaced by a USDA PSD fallback:
      `psd_coffee` already parses each producer's annual Bean Exports;
      `psd_country_exports.py` reshapes it and each `export_*.py` uses it when
      ICO is absent; the Supply tabs render it via `AnnualExportsPanel`.
      Populates on the next export-and-publish run.
  - [ ] (follow-up) MONTHLY granularity for these four — needs per-country
        national scrapers: FNC xlsx (Colombia), BPS table (Indonesia),
        IHCAFE/INE PDF (Honduras), ECTA/FAS GAIN PDF (Ethiopia).
- [ ] **Stale `acaphe_live.json`** (snapshot ~27 days old) — `/api/live`
      (Upstash) returns 503 so the ticker, map price labels, origin-price diffs
      and the Telegram brief fall back to a stale snapshot. Needs the acaphe
      poller running with its secrets. _Deferred._
- [ ] **Data gaps to backfill** (panels render but a series is empty):
      `demand_stocks.json` → `age_cohort_18plus` (null) and ECF
      `arabica_washed_mt`/`robusta_mt` (null); `retail_cpi.json` → no
      `kc_futures` series; `origin_prices_history.json` → `brazil_arabica`
      history empty; `farmer_economics.json` → `fertilizer.dry_bulk` /
      `import_origins` null. _Deferred — upstream scraper output, not bugs._
- [ ] (someday) Migrate FND chart + frontend `STATIC_SERIES` to RC so the
      DISPLAY=RM conversion can be dropped entirely (cosmetic; low priority).

---

## 1. The architecture in one picture

```mermaid
flowchart TD
    %% ---------- SOURCES ----------
    subgraph SRC[External sources]
        BC[Barchart core-api]
        CFTC[CFTC COT report]
        JSD[jsDelivr FX]
        ACA[acaphe / giacaphe / Cecafe / ICO ...]
        OM[Open-Meteo forecast API]
    end

    %% ---------- FETCHERS ----------
    F13[["1.3 Daily OI Snapshot<br/>02:00 Mon-Fri"]]
    F23[["2.3 COT Scraper<br/>Fri 20:00"]]
    F19[["1.9 Quant CCI<br/>21:30 Mon-Fri"]]
    FPOLL[["Acaphe poll<br/>every 15m"]]
    FNEWS[["1.1/1.2/1.7/3.x<br/>news·freight·origin"]]
    F110[["1.10 Weather Fetch<br/>05:40 daily · independent"]]

    %% ---------- CANONICAL STORE ----------
    ARC[("contract_prices_archive.json<br/>★ SINGLE coffee OI+price source<br/>date-keyed · RC canonical · 5y")]
    DB[(Postgres · 13 tables)]

    %% ---------- EXPORT ----------
    EXP[["1.4 Export & Publish<br/>01:30 daily + on-2.3"]]
    SIG[[export-signals.mjs]]

    %% ---------- PUBLISHED JSON ----------
    OIH[/oi_history.json · 30d view/]
    FND[/oi_fnd_chart.json/]
    COTJ[/cot.json · cot_recent.json/]
    MAC[/macro_cot.json/]
    SIGJ[/signals.json/]
    QJ[/quant_report.json · fx_history.json/]
    ACJ[/acaphe_live.json/]
    ORIG[/origin · supply · freight JSON/]
    WX[/"{origin}_weather.json ×6<br/>+ weather_history accumulator"/]

    %% ---------- VISUALS ----------
    V_IP{{COT · Industry Pulse<br/>price + PMPU + switch dots}}
    V_OI{{Futures · OI 7-day table}}
    V_FND{{COT · OI Evolution to FND}}
    V_SIG{{COT · Signals + gauges}}
    V_FLOW{{COT · Global Flow / Dry Powder / Cycle}}
    V_MAC{{Macro · cross-commodity MM}}
    V_CCI{{Macro · CCI + FX}}
    V_QUOTE{{Futures · daily quotes}}
    V_MAP{{Map · origin/supply}}
    V_TG{{Telegram morning brief}}
    V_WX{{Supply · per-origin Weather charts}}

    %% ---------- EDGES: fetch ----------
    BC --> F13 --> ARC
    BC --> FPOLL --> ACJ
    CFTC --> F23
    JSD --> F19 --> QJ
    ACA --> FNEWS --> DB

    %% archive-derived
    ARC -->|derive 30d view| OIH
    ARC -->|FND export| FND
    ARC -->|rebuild max-OI<br/>in 2.3| DB

    %% COT scraper writes positions to DB
    F23 -->|positions| DB

    %% export
    DB --> EXP
    EXP --> COTJ
    EXP --> MAC
    EXP --> FND
    EXP --> ORIG
    COTJ --> SIG --> SIGJ

    %% JSON -> visuals
    COTJ --> V_IP
    COTJ --> V_SIG
    COTJ --> V_FLOW
    OIH --> V_OI
    FND --> V_FND
    MAC --> V_MAC
    SIGJ --> V_TG
    QJ --> V_CCI
    ACJ --> V_QUOTE
    ORIG --> V_MAP

    %% weather (independent of 1.4 export)
    OM --> F110 --> WX --> V_WX
```

---

## 2. Fetch layer (scheduled jobs)

| WF | Name | Schedule (UTC) | Fetches | Lands in |
|---|---|---|---|---|
| **1.3** | Daily OI Snapshot | 02:00 Mon-Fri | KC+RM full chain (OI+price) | **`contract_prices_archive.json`** (+ derives `oi_history.json`) |
| 1.1 | Daily News | 01:00 daily | news + origin | DB |
| 1.2 | Freight | 02:00 daily | rates | DB |
| 1.4 | **Export & Publish** | 01:30 daily + on-2.3 | *(reads DB + archive)* | ~17 static JSON + signals |
| 1.5 | Check Scrapers Fresh | 07:00 daily | *(reads health.json)* | Telegram |
| ~~1.6~~ | ~~Morning Brief~~ | **retired 2026-08-14** | replaced by per-source alerts below; `/brief` still works on demand | — |
| — | **Per-source Telegram alerts** (`topic_notify_daily.py`) | chained on each producing workflow | one short text per source, sent only when its numbers change | Telegram |
| | ↳ `prices`, `origin_prices`, `week_ahead` | after 1.4 Export-and-Publish | RC/KC futures · origin basis · upcoming events | |
| | ↳ `certified` | after ICE certified stocks | NY + London stocks/gradings | |
| | ↳ `brazil_daily` | after 1.7 Cecafé daily | Brazil registrations + export pace | |
| | ↳ `cci` | after 1.9 Quant CCI | Coffee Currency Index + z-score | |
| | ↳ `open_call` | after 1.16 Open-Direction | the pre-open RC call | |
| | ↳ `weather` | after 1.10 Weather Fetch | frost/rain/VHI per origin | |
| 1.7 | Cecafe Daily | 09:00 daily | BR registrations | `cecafe_daily.json` (also pings Vercel deploy hook¹ to publish the day's `[skip ci]` data commits) |
| 1.9 | Quant CCI | 21:30 Mon-Fri | FX + Robusta factors | `quant_report.json`+`fx_history.json` |
| 1.16 | Open-Direction Log | 03:07 Mon-Fri (pre-open; own concurrency lane) | overnight-gap model (kc_after + days_since_roll [+ cci_overnight]) | `open_direction_history.json` + `quant_report.json (open_direction)` + `fx_intraday_snapshots.json`; fires the `open_call` Telegram text |
| **1.10** | **Weather Fetch & Accumulate** | 05:40 daily | per-origin rain+temp, Open-Meteo **forecast** API (`api.open-meteo.com`); **independent of 1.4** | `weather_history/{origin}.json` (accumulator) → rebuilds `{origin}_weather.json` ×6 |
| Acaphe | Live Quotes Poll | every 15m | live quotes | `acaphe_live.json` |
| 2.2 | Commodity Prices | Tue 22:55 | all-commodity prices | DB `commodity_prices` |
| **2.3** | COT Scraper **+ archive price rebuild** | Fri 20:00 | CFTC COT (all commodities + coffee) → DB; **then rebuild cot_weekly prices from archive (max-OI)** | DB |
| 3.1/3.2/4.1 | Kaffeesteuer / Cecafe / Earnings | monthly+ | tax/exports/earnings | DB / JSON |
| 3.3.1–3.3.5 | CONAB · BR Fertilizer · VN Fertilizer · VN Coffee Exports · Uganda UCDA | monthly (12th; UG 14th) | supply/costs/exports | DB / JSON |
| 0.1–0.4 | One-shot backfills | manual | *(archive loads, rebuilds)* | DB / archive |

**Retired:** ~~2.1 Tuesday Coffee Settlement Prices~~ — replaced by the archive rebuild step inside 2.3.

> ¹ All data workflows commit JSON with `[skip ci]`, which Vercel ignores, so production never auto-rebuilds on data. The last daily scraper (1.7, ~09:10 UTC) POSTs the Vercel **deploy hook** once to publish the day's accumulated commits. Requires repo secret `VERCEL_DEPLOY_HOOK` (Vercel → Settings → Git → Deploy Hooks); no-ops if unset.

---

## 3. Storage & retention

| Store | Source | Retention |
|---|---|---|
| **`contract_prices_archive.json`** ★ | 1.3 daily + bulk CSV loads | **5y (1320d), auto-trim** |
| `oi_history.json` | **derived** from archive (30d view) | 30 days |
| `cot_weekly` (DB) | 2.3 positions + archive rebuild (prices) | permanent; prices now overwrite-from-archive |
| `commodity_cot` (DB) | 2.3 (all commodities) | permanent |
| `cot.json` | 1.4 from DB | full history |
| `cot_recent.json` | 1.4 | last 12 weeks |
| `signals.json` | export-signals.mjs | current + 8wk |
| `oi_fnd_chart.json` | 1.4 ← archive | cur+prev yr contracts, −45..0d |
| `backend/seed/weather_history/{origin}.json` ×6 | **1.10** daily append (idempotent) | grows indefinitely — the accumulated daily-actuals record |
| `frontend/public/data/{origin}_weather.json` ×6 | **1.10** (seed climatology + live actuals/forecast) | rebuilt daily |
| `vn_weather.json` | static seed (not fetched) | manual |
| 11 other DB tables / ~30 JSON | various | permanent |

---

## 4. Visual → source (the "what feeds what")

### 4a. Per-workflow → exact dashboard visual

| Workflow | DB/JSON output | Component | Tab · Visual |
|---|---|---|---|
| **1.3 Daily OI** | `oi_history.json` | `OIHistoryTable` | **Futures · OI 7-day table** (+ COT §2) |
| | `oi_fnd_chart.json` | `OIFndChart` | **Futures + COT · OI Evolution to FND** |
| | archive→(2.3 rebuild)→`cot.json` price | `Step4IndustryPulse` | **COT · Industry Pulse — price line + switch dots** |
| **1.1 Daily News** | DB `news_feed` | `/api/news`, map labels | **Map · news labels / table**; Telegram news |
| | DB `country_intel` | `CoffeeMap` popups | **Map · country intel** |
| **1.2 Freight** | `freight.json` | `FreightContextPanel` | **Macro · Freight Context**; Telegram freight |
| **1.4 Export & Publish** | *(all static JSON)* | — | *plumbing — feeds every JSON-backed visual* |
| **1.5 Fresh check** | — | — | *Telegram alert only* |
| **1.6 Morning Brief** | reads `signals.json`,`events.json`,JSON | — | **Telegram brief** (the message itself) |
| **1.7 Cecafe Daily** | `cecafe_daily.json` | `DailyRegistration` | **Supply · Brazil · Daily Registration**; Telegram |
| **1.9 Quant CCI** | `quant_report.json` | `CurrencyIndexSection` | **Macro · Coffee Currency Index** |
| | `fx_history.json` | `FxTimeSeriesPanel` | **Macro · FX Pair Time-Series** |
| **1.16 Open-Direction Log** | `quant_report.json (open_direction)` | `PriceDirectionSection` | **Macro · Open Price Direction** (pre-open overnight-gap call) |
| | `open_direction_history.json` | `OpenDirectionCalendar` | **Macro · Track Record** (prediction vs realized open) |
| **1.10 Weather Fetch** | `{origin}_weather.json` ×6 | `WeatherCharts` | **Supply · each origin · Weather charts** — monthly rain, cumulative YTD, mean temp, daily MTD accumulation, 7-day forecast (replaced the legacy drought/frost strip panels) |
| **Acaphe poll** | `acaphe_live.json` | `AcapheLiveQuotes` | **Futures · Daily Live Quotes** |
| **1.3b Slow-Data** (ECF·PSD·AJCA·UCDA) | `demand_stocks.json` | `StocksPanel` | **Demand · Stocks (ICE certified + PSD)** |
| **2.2 Commodity Prices** | DB `commodity_prices` → `latest_prices.json` | `CoffeeMap` | **Map · price labels + header ticker** |
| **2.3 COT Scraper + rebuild** | `cot.json` | `Step1/4/5/6/7/8` | **COT · Signals, Gauges, Heatmap, Global Flow, Industry Pulse (positions), Dry Powder, Cycle, Report** |
| | `macro_cot.json` | `CrossCommodityPanel` | **Macro · Cross-Commodity MM** |
| | `signals.json` | morning_brief | **Telegram · CoT signals** |
| | archive rebuild → `cot.json` price | `Step4IndustryPulse` | **COT · Industry Pulse price (true max-OI)** |
| **3.1 Kaffeesteuer** | `kaffeesteuer.json` | `KaffeesteuerChart` | **Demand · Kaffeesteuer (DE tax)** |
| **3.2 Cecafe Export** | `cecafe.json` | `CoffeeMap` | **Map · Brazil monthly exports** |
| **3.3.1 CONAB** | `farmer_economics.json` | `FarmerSellingPanel` | **Supply · Brazil Farmer Economics** |
| **3.3.2 BR Fertilizer** | `farmer_economics.json` | `FertilizerInputsPanel` | **Macro · Fertilizer Inputs (Brazil)** |
| **3.3.3 VN Fertilizer** | `vn_fertilizer.json` | `VnFarmerEconomics` | **Supply · VN Farmer Economics (fertilizer cost)** |
| **3.3.4 VN Coffee Exports** | `vn_coffee_export.json` → `vietnam_supply.json` | `VnExportExplorer` / `VnBalanceSheet` | **Supply · VN Export Explorer + Balance Sheet** |
| **3.3.5 Uganda UCDA** | `uganda_supply.json` | `UgandaTab` | **Supply · Uganda (exports, robusta/arabica split, grades, destinations)** |
| **4.1 Earnings** | `earnings.json` | `EarningsTable` | **Demand · Roaster Earnings** |
| _various / manual_ | `factory_mix.json` | `RoastingMixPanel` | **Demand · Roasting Mix** |
| | `global_fertilizers.json` | `FertilizersTab` | **Supply · Fertilizers** |
| | `manual_intel.json` | `ManualIntelPanel` | **Supply · Manual Intel** |
| | `retail_cpi.json` | `RetailCpiPanel` | **Macro · Retail CPI** |
| **1.1 → 1.4** | `us_cpi.json` | `UsCpiPanel` | **Macro · Inflation · US CPI** |
| | `origin_prices_history.json` | `OriginPricesPanel` | **Macro · Origin Prices** |
| | `farmer_selling_brazil.json` | `FarmerSellingPanel` | **Supply · Farmer Selling** |
| | `*_supply.json` (colombia/vietnam/…) | per-country tabs | **Supply · country pages**; **Map** |

### 4c. By dashboard tab (one diagram per tab)

Source · frequency → store → JSON → visual, scoped to each tab. Replaces the earlier single mega diagram.

#### Futures Exchange

```mermaid
flowchart LR
  WPOLL["Acaphe poll · /15min (1-19h)<br/>acaphe.com"]
  W13["1.3 Daily OI · 02:00 M-F<br/>Barchart core-api"]
  ARC[("contract_prices_archive.json")]
  EXP{{"1.4 Export · 02:30"}}
  J_aca[/acaphe_live.json/]
  J_chain[/futures_chain.json/]
  J_oi[/oi_history.json/]
  J_fnd[/oi_fnd_chart.json/]
  quote{{Daily Live Quotes}}
  chain{{Futures Chain}}
  oi{{OI 7-day Table}}
  oifnd{{OI Evolution to FND}}
  WPOLL --> J_aca --> quote
  W13 --> ARC
  W13 --> EXP --> J_chain --> chain
  ARC --> J_oi --> oi
  ARC --> J_fnd --> oifnd

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#2e1065,stroke:#8b5cf6,color:#ddd6fe;
  class WPOLL,W13 scr;
  class ARC store;
  class EXP proc;
  class J_aca,J_chain,J_oi,J_fnd json;
  class quote,chain,oi,oifnd vis;
```

#### COT

```mermaid
flowchart LR
  W13["1.3 Daily OI · 02:00 M-F<br/>Barchart core-api"]
  W23["2.3 COT + max-OI rebuild · Fri 20:00<br/>CFTC disagg report"]
  ARC[("contract_prices_archive.json<br/>5y per-contract OI+price")]
  DB[(Postgres)]
  EXP{{"1.4 Export · 02:30"}}
  J_cot[/cot.json · 312wk/]
  J_mac[/macro_cot.json/]
  J_fnd[/oi_fnd_chart.json/]
  ip{{Industry Pulse}}
  sig{{"Signals · computed in-browser from cot.json"}}
  gau{{Gauges}}
  hm{{Heatmap}}
  flow{{Global Flow}}
  dp{{Dry Powder}}
  cyc{{Cycle Location}}
  rep{{"Report · backtest"}}
  oi{{OI 7-day}}
  oifnd{{OI Evolution to FND}}
  W13 --> ARC --> DB
  W23 --> DB --> EXP
  EXP --> J_cot
  EXP --> J_mac
  ARC --> J_fnd
  J_cot --> ip
  J_cot --> sig
  J_cot --> gau
  J_cot --> hm
  J_cot --> flow
  J_mac --> flow
  J_cot --> dp
  J_cot --> cyc
  J_cot --> rep
  J_cot --> oi
  J_fnd --> oifnd

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#172554,stroke:#3b82f6,color:#bfdbfe;
  class W13,W23 scr;
  class ARC,DB store;
  class EXP proc;
  class J_cot,J_mac,J_fnd json;
  class ip,sig,gau,hm,flow,dp,cyc,rep,oi,oifnd vis;
```

#### Freight

```mermaid
flowchart LR
  W12["1.2 Freight · 02:00 daily<br/>Freightos containers"]
  WDRY["Yahoo dry-bulk<br/>(BDRY proxy)"]
  J_fr[/freight.json/]
  J_fe[/farmer_economics.json · fertilizer.dry_bulk/]
  ctx{{Freight Context Panel}}
  rate{{Rate Evolution + Spot table}}
  dry{{Dry Bulk Indicator}}
  W12 --> J_fr
  J_fr --> ctx
  J_fr --> rate
  WDRY --> J_fe --> dry

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#082f49,stroke:#0ea5e9,color:#bae6fd;
  class W12,WDRY scr;
  class J_fr,J_fe json;
  class ctx,rate,dry vis;
```

#### Supply

```mermaid
flowchart LR
  W17["1.7 Cecafe daily · 09:00<br/>B3 · cecafe.com.br"]
  W32["3.2 Cecafe export · 15th<br/>cecafe"]
  W331["3.3.1 CONAB · 12th<br/>conab.gov.br"]
  W332["3.3.2 BR Fertilizer · 12th<br/>Comex Stat"]
  W333["3.3.3 VN Fertilizer · 12th<br/>VN Customs"]
  W334["3.3.4 VN Coffee Exports · 12th<br/>VN Customs"]
  W335["3.3.5 Uganda UCDA · 14th<br/>ugandacoffee.go.ug"]
  WCNTRY["Origin supply<br/>ICO · USDA · customs<br/>(CO·VN·ET·HN·ID)"]
  WFERT["Fertilizers · UN Comtrade · World Bank"]
  WINTEL["manual intel"]
  DB[(Postgres)]
  EXP{{"1.4 Export · 02:30"}}
  J_cecd[/cecafe_daily.json/]
  J_cec[/cecafe.json/]
  J_fe[/farmer_economics.json/]
  J_fsell[/farmer_selling_brazil.json/]
  J_vn[/vietnam_supply.json/]
  J_vnfe[/vn_farmer_economics/]
  J_vnwl[/vn_water_levels.json/]
  J_vnw[/vn_weather.json/]
  J_co[/colombia_supply.json/]
  J_et[/ethiopia_supply.json/]
  J_hn[/honduras_supply.json/]
  J_id[/indonesia_supply.json/]
  J_ug[/uganda_supply.json/]
  J_ferts[/global_fertilizers.json/]
  J_intel[/manual_intel.json/]
  W110["1.10 Weather Fetch · 05:40 daily<br/>api.open-meteo.com forecast · independent of 1.4"]
  J_whist[/"weather_history/{origin}.json<br/>(daily accumulator ×6)"/]
  J_owx[/"{brazil·colombia·honduras·<br/>indonesia·uganda·ethiopia}_weather.json"/]
  br{{BR Daily Registration}}
  mv{{BR Monthly Volume}}
  brexp{{BR Export Charts}}
  bfe{{BR Farmer Economics}}
  sell{{BR Farmer Selling}}
  cec{{BR Monthly Exports}}
  vnexp{{VN Export Explorer}}
  vnbal{{VN Balance Sheet}}
  vnfe{{VN Farmer Economics}}
  vnwl{{VN Water Levels}}
  vnw{{VN Weather}}
  coexp{{Colombia}}
  et{{Ethiopia}}
  hn{{Honduras}}
  idn{{Indonesia}}
  ug{{Uganda}}
  fert{{Fertilizers}}
  intel{{Manual Intel}}
  owx{{Per-origin Weather charts<br/>BR·CO·HN·ID·UG·ET}}
  W17 --> J_cecd
  J_cecd --> br
  J_cecd --> mv
  J_cecd --> brexp
  W32 --> J_cec --> cec
  W331 --> DB
  W332 --> DB
  W335 --> DB
  DB --> EXP
  W333 --> EXP
  W334 --> EXP
  WCNTRY --> EXP
  WFERT --> J_ferts
  WINTEL --> J_intel
  EXP --> J_fe
  EXP --> J_fsell
  EXP --> J_vn
  EXP --> J_vnfe
  EXP --> J_vnwl
  EXP --> J_vnw
  EXP --> J_co
  EXP --> J_et
  EXP --> J_hn
  EXP --> J_id
  EXP --> J_ug
  J_fe --> bfe
  J_fsell --> sell
  J_vn --> vnexp
  J_vn --> vnbal
  J_vnfe --> vnfe
  J_vnwl --> vnwl
  J_vnw --> vnw
  J_co --> coexp
  J_et --> et
  J_hn --> hn
  J_id --> idn
  J_ug --> ug
  J_ferts --> fert
  J_fe --> fert
  J_vn --> fert
  J_intel --> intel

  %% 1.10 weather — independent daily fetch → accumulate → per-origin charts
  W110 --> J_whist --> J_owx --> owx

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#1a2e05,stroke:#84cc16,color:#d9f99d;
  class W17,W32,W331,W332,W333,W334,W335,WCNTRY,WFERT,WINTEL,W110 scr;
  class DB store;
  class EXP proc;
  class J_cecd,J_cec,J_fe,J_fsell,J_vn,J_vnfe,J_vnwl,J_vnw,J_co,J_et,J_hn,J_id,J_ug,J_ferts,J_intel,J_whist,J_owx json;
  class br,mv,brexp,bfe,sell,cec,vnexp,vnbal,vnfe,vnwl,vnw,coexp,et,hn,idn,ug,fert,intel,owx vis;
```

#### Demand

```mermaid
flowchart LR
  W3B["1.3b Slow-data · 1st/mo<br/>ECF stocks · USDA PSD · AJCA · UCDA"]
  WPOP["Population/age · UN WPP · World Bank"]
  W41["4.1 Earnings · quarterly · filings"]
  W31["3.1 Kaffeesteuer · 1st/mo · DESTATIS"]
  WMIX["manual / various"]
  EXP{{"1.4 Export · 02:30"}}
  J_stk[/demand_stocks.json/]
  J_earn[/earnings.json/]
  J_tax[/kaffeesteuer.json/]
  J_mix[/factory_mix.json/]
  stk{{"ICE/ECF Stocks"}}
  ecf{{ECF Panel}}
  psd{{PSD Analytical}}
  jp{{"Japan / AJCA"}}
  age{{Age Cohort}}
  grow{{Growth Markets}}
  world{{World Consumption}}
  earn{{Roaster Earnings}}
  tax{{"Kaffeesteuer (DE tax)"}}
  mix{{Roasting Mix}}
  W3B --> EXP
  WPOP --> EXP
  EXP --> J_stk
  J_stk --> stk
  J_stk --> ecf
  J_stk --> psd
  J_stk --> jp
  J_stk --> age
  J_stk --> grow
  J_stk --> world
  W41 --> J_earn --> earn
  W31 --> J_tax --> tax
  WMIX --> J_mix --> mix

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#451a03,stroke:#f59e0b,color:#fde68a;
  class W3B,WPOP,W41,W31,WMIX scr;
  class EXP proc;
  class J_stk,J_earn,J_tax,J_mix json;
  class stk,ecf,psd,jp,age,grow,world,earn,tax,mix vis;
```

#### Macro

```mermaid
flowchart LR
  W19["1.9 Quant CCI · 21:30 M-F<br/>jsDelivr FX · yfinance"]
  W12["1.2 Freight · 02:00<br/>Freightos · Yahoo"]
  W23["2.3 COT · Fri 20:00 · CFTC"]
  WORIG["Origin prices (1.1) · 01:00<br/>BCB·giacaphe·FNC·IHCAFE·UCDA·ECX·CEPEA"]
  WCPI["US/Retail CPI · BLS · Eurostat · BCB"]
  W33["3.3.1–3.3.3 CONAB + Fertilizer · 12th<br/>conab.gov.br · Comex · VN Customs"]
  EXP{{"1.4 Export · 02:30"}}
  J_mac[/macro_cot.json/]
  J_q[/quant_report.json/]
  J_fx[/fx_history.json/]
  J_fr[/freight.json/]
  J_cpi[/retail_cpi.json/]
  J_uscpi[/us_cpi.json/]
  J_fe[/farmer_economics.json/]
  J_orig[/origin_prices_history.json/]
  xc{{Cross-Commodity MM}}
  cci{{Coffee Currency Index}}
  fx{{FX Pair Time-Series}}
  fr{{Freight Context}}
  cpi{{Retail CPI}}
  uscpi{{US CPI}}
  fert{{Fertilizer Inputs}}
  orig{{Origin Prices}}
  W23 --> EXP
  WCPI --> EXP
  W33 --> EXP
  WORIG --> EXP
  EXP --> J_mac --> xc
  EXP --> J_cpi --> cpi
  EXP --> J_uscpi --> uscpi
  EXP --> J_fe --> fert
  EXP --> J_orig --> orig
  W19 --> J_q --> cci
  W19 --> J_fx --> fx
  W12 --> J_fr --> fr

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#042f2e,stroke:#14b8a6,color:#99f6e4;
  class W19,W12,W23,WORIG,WCPI,W33 scr;
  class EXP proc;
  class J_mac,J_q,J_fx,J_fr,J_cpi,J_uscpi,J_fe,J_orig json;
  class xc,cci,fx,fr,cpi,uscpi,fert,orig vis;
```

#### News & Intel (Map)

```mermaid
flowchart LR
  W22["2.2 Commodity prices · Tue 22:55<br/>Barchart"]
  WPOLL["Acaphe poll · /15min<br/>acaphe.com"]
  W11["1.1 News · 01:00<br/>RSS · B3 · CEPEA · Cooabriel · AJCA"]
  W32["3.2 Cecafe export · 15th"]
  W12["1.2 Freight · 02:00"]
  WCNTRY["Origin supply (VN ports)"]
  DB[(Postgres · news_feed)]
  EXP{{"1.4 Export · 02:30"}}
  SEED["seed/factories.json"]
  SUP[/supply JSONs · CO·VN·UG·BR·…/]
  J_lp[/latest_prices.json/]
  J_aca[/acaphe_live.json/]
  J_news[/news.json · static/]
  J_ctry[/countries.json · static from supply/]
  J_fact[/factories.json · static/]
  J_cec[/cecafe.json/]
  J_fr[/freight.json/]
  J_vnx[/vn_export_destination_port/]
  base{{Coffee Map base}}
  price{{Price labels}}
  country{{Country pins + intel}}
  factory{{Factory pins}}
  exports{{Exports overlay}}
  freight{{Freight overlay}}
  vnport{{VN port-flow arrows}}
  news{{News Feed / Sidebar}}
  W22 --> EXP --> J_lp --> price
  WPOLL --> J_aca --> price
  W11 --> DB --> EXP
  EXP --> J_news
  J_news --> country
  J_news --> news
  SUP --> J_ctry --> country
  SEED --> J_fact --> factory
  W32 --> J_cec --> exports
  W12 --> J_fr --> freight
  WCNTRY --> J_vnx --> vnport

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#500724,stroke:#ec4899,color:#fbcfe8;
  class W22,WPOLL,W11,W32,W12,WCNTRY,SEED,SUP scr;
  class DB store;
  class EXP proc;
  class J_lp,J_aca,J_news,J_ctry,J_fact,J_cec,J_fr,J_vnx json;
  class base,price,country,factory,exports,freight,vnport,news vis;
```

#### Global — Ticker & Telegram brief

```mermaid
flowchart LR
  J_aca[/acaphe_live.json/]
  J_lp[/latest_prices.json/]
  J_orig[/origin_prices_history.json/]
  J_cot[/cot.json/]
  J_sig[/signals.json/]
  J_ev[/events.json · seed/]
  J_met[/origin weather JSON ×7/]
  J_fr[/freight.json/]
  J_q[/quant_report.json/]
  J_mac[/macro_cot.json/]
  J_news[(news_feed)]
  TICKER{{"Market Ticker — global band, every tab<br/>KC + RC live · FX"}}
  TG{{"Telegram morning brief · 03:00<br/>last step · 9 sections"}}
  J_aca --> TICKER
  J_lp --> TICKER
  J_aca --> TG
  J_lp --> TG
  J_orig --> TG
  J_cot --> TG
  J_sig --> TG
  J_ev --> TG
  J_met --> TG
  J_fr --> TG
  J_q --> TG
  J_mac --> TG
  J_news --> TG

  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  classDef vis fill:#083344,stroke:#22d3ee,color:#a5f3fc;
  class J_aca,J_lp,J_orig,J_cot,J_sig,J_ev,J_met,J_fr,J_q,J_mac,J_news json;
  class TICKER,TG vis;
```

### 4b. By dashboard tab (reverse view)

- **COT** (`/cot`): Industry Pulse, Signals (computed in-browser from `cot.json`), Gauges, Heatmap, Global Flow (`macro_cot.json`), Dry Powder, Cycle, Report ← `cot.json`; OI 7-day ← `oi_history.json`, OI→FND ← `oi_fnd_chart.json`. (`signals.json` feeds only the Telegram brief.)
- **Futures** (`/futures`): daily quotes ← `acaphe_live.json`; chain ← `futures_chain.json`; OI table ← `oi_history.json`; OI→FND ← `oi_fnd_chart.json`.
- **Macro** (`/macro`): CCI ← `quant_report.json`; FX ← `fx_history.json`; cross-commodity MM ← `macro_cot.json`; freight ← `freight.json`; inflation (US CPI ← `us_cpi.json`, retail coffee CPI ← `retail_cpi.json`); fertilizer inputs/origin prices ← `farmer_economics.json`/`origin_prices_history.json`.
- **Demand** (`/demand`): stocks ← `demand_stocks.json`; roasting mix ← `factory_mix.json`; earnings ← `earnings.json`; DE tax ← `kaffeesteuer.json`.
- **Supply** (`/supply`): Brazil daily reg ← `cecafe_daily.json`; fertilizers ← `global_fertilizers.json`; farmer economics ← `farmer_*`; manual intel ← `manual_intel.json`; country pages ← `*_supply.json`.
- **Map** (`/map`): price labels ← `latest_prices.json`; exports ← `cecafe.json`; intel/news ← `/api/news`+`country_intel`.



---

## 5. Key design properties (post-redesign)

- **One coffee data source.** All coffee OI + price flows from the single daily
  fetch (1.3) into the archive. The OI table, FND chart, Industry Pulse price,
  and switch markers all derive from it. No parallel Tuesday fetch, no
  Stooq/yfinance continuous-feed exposure.
- **Symbol convention, one layer** (`backend/scraper/symbols.py`):
  FETCH=RM (Barchart) · STORE=RC (canonical) · DISPLAY=RM (OI table + FND chart).
- **Price/label can't disagree.** Both come from the same archive cell, chosen
  by max-OI per COT-Tuesday.
- **Single DB→JSON sync point**: the export job (1.4). No-op commits are skipped.
- **Reversibility**: every price rebuild archives originals to
  `cot_weekly_price_archive`.
