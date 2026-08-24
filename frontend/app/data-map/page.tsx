"use client";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import Mermaid from "@/components/Mermaid";
import DataDownloads from "@/components/data-map/DataDownloads";
import { useFetchJson } from "@/lib/useFetchJson";

// Shared class definitions appended to every per-tab diagram. `vis` (the tab's
// own colour) is supplied per diagram.
const DEFS = `
  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;`;

const ARCHITECTURE = `flowchart LR
  BC[Barchart core-api]
  CFTC[CFTC COT report]
  ARC[("contract_prices_archive.json<br/>SINGLE coffee OI+price source<br/>RC canonical · 5y")]
  DB[(Postgres · 13 tables)]
  EXP{{"1.4 Export & Publish · 02:30"}}
  F13["1.3 Daily OI · 02:00 M-F"]
  F23["2.3 COT · Fri 20:00"]
  J[/~30 static JSON/]
  VIS{{dashboard visuals}}
  BC --> F13 --> ARC --> DB
  CFTC --> F23 --> DB
  ARC -->|max-OI rebuild in 2.3| DB
  DB --> EXP --> J --> VIS
  ARC --> J
  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  class BC,CFTC,F13,F23 scr;
  class ARC,DB store;
  class EXP proc;
  class J json;`;

const FUTURES = `flowchart LR
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
${DEFS}
  classDef vis fill:#2e1065,stroke:#8b5cf6,color:#ddd6fe;
  class WPOLL,W13 scr;
  class ARC store;
  class EXP proc;
  class J_aca,J_chain,J_oi,J_fnd json;
  class quote,chain,oi,oifnd vis;`;

const COT = `flowchart LR
  W13["1.3 Daily OI · 02:00 M-F<br/>Barchart core-api"]
  W23["2.3 COT + max-OI rebuild · Fri 20:00<br/>CFTC disagg report"]
  ARC[("contract_prices_archive.json<br/>5y per-contract OI+price · untouched")]
  DB[(Postgres)]
  EXP{{"1.4 Export · 02:30"}}
  J_cot[/cot.json · 312wk/]
  J_mac[/macro_cot.json/]
  J_fnd[/oi_fnd_chart.json/]
  J_oi[/"oi_history.json<br/>14-day rolling slice of ARC (was 30)"/]
  J_sig[/signals.json<br/>· quant + AGRO rows merged/]
  ip{{Industry Pulse}}
  sig{{"Signals · computed in-browser from cot.json<br/>+ /cot Telegram appends per-rule listing from signals.json"}}
  gau{{Gauges}}
  hm{{Heatmap}}
  flow{{Global Flow}}
  dp{{Dry Powder}}
  cyc{{Cycle Location}}
  rep{{"Report · backtest"}}
  oi{{"OI 14-day table · nearby-OI delta re-derived<br/>from per-contract oi_history.json (was buggy exch_oi_*)"}}
  oifnd{{OI Evolution to FND}}
  W13 --> ARC --> DB
  W23 --> DB --> EXP
  EXP --> J_cot
  EXP --> J_mac
  EXP --> J_sig
  ARC --> J_fnd
  ARC --> J_oi
  J_cot --> ip
  J_cot --> sig
  J_sig --> sig
  J_cot --> gau
  J_cot --> hm
  J_cot --> flow
  J_mac --> flow
  J_cot --> dp
  J_cot --> cyc
  J_cot --> rep
  J_oi --> oi
  J_cot --> oi
  J_fnd --> oifnd
${DEFS}
  classDef vis fill:#172554,stroke:#3b82f6,color:#bfdbfe;
  class W13,W23 scr;
  class ARC,DB store;
  class EXP proc;
  class J_cot,J_mac,J_fnd,J_oi,J_sig json;
  class ip,sig,gau,hm,flow,dp,cyc,rep,oi,oifnd vis;`;

const NEWS = `flowchart LR
  W11["1.1 News · 01:00<br/>RSS · B3 · CEPEA · Cooabriel · AJCA · World Bank"]
  WEVT["build_events_calendar.py · manual<br/>WASDE · ICE FND · Cecafé · ICO · VN Customs"]
  WHLTH["1.4 Export · 02:30<br/>per-scraper run timestamps"]
  DB[(Postgres · news_feed)]
  EXP{{"1.4 Export · 02:30"}}
  SEED_EV[("backend/seed/events.json<br/>(mirrored to /public/data)")]
  J_n[/news.json/]
  J_e[/events.json/]
  J_h[/health.json/]
  fresh{{"Freshness Grid — 26 scraper chips,<br/>today-pulse, grouped by category"}}
  cal{{"Upcoming Calendar — next 30d,<br/>ISO-week timeline, category icons"}}
  risk{{"Risk Radar — 15 watched terms<br/>last-7d vs prior-23d velocity ↑↑/↑/→/↓"}}
  hd{{"Headlines Digest — last 7d,<br/>OR-multi-select Focus chips (KC·RC·origins·Macro)"}}
  WHLTH --> J_h --> fresh
  WEVT --> SEED_EV --> J_e --> cal
  W11 --> DB --> EXP --> J_n
  J_n --> hd
  J_n --> risk
${DEFS}
  classDef vis fill:#1a1a2e,stroke:#a78bfa,color:#ddd6fe;
  class W11,WEVT,WHLTH scr;
  class DB,SEED_EV store;
  class EXP proc;
  class J_n,J_e,J_h json;
  class fresh,cal,risk,hd vis;`;

const FREIGHT = `flowchart LR
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
${DEFS}
  classDef vis fill:#082f49,stroke:#0ea5e9,color:#bae6fd;
  class W12,WDRY scr;
  class J_fr,J_fe json;
  class ctx,rate,dry vis;`;

const SUPPLY = `flowchart LR
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
  WWX["weather-fetch · daily<br/>forecast.open-meteo.com<br/>P · Tmax/Tmin · ET₀ · ESSM"]
  WSPI["0.3 SPI baseline · one-shot<br/>archive.open-meteo.com 1995-24"]
  WSPEI["0.4 SPEI baseline · one-shot<br/>archive 1995-24 (P + ET₀)"]
  WVHI["0.5 NOAA STAR VHI · weekly<br/>get_TS_admin.php per province<br/>admin-1 text endpoint (no NetCDF)"]
  WENSO["NOAA ENSO ONI · monthly<br/>cpc.ncep.noaa.gov"]
  WENFC["ENSO forecast fallback chain<br/>IRI HTML → CPC discussion text<br/>9 rolling quarters · enso_forecast.py"]
  WBFL["0.6/0.7 One-shot backfills<br/>backfill_missing_fields.py · backfill_history_gap.py<br/>heals rain/ET₀/2025-gap from archive"]
  AGRO[["agronomic_alerts.py · end of 1.10<br/>IPHM rules: fungal rust · severe defoliation<br/>· brazil frost · blossom drop"]]
  DB[(Postgres)]
  EXP{{"1.4 Export · 02:30"}}
  SEED_SPI[("spi_30yr_baselines.json")]
  SEED_SPEI[("spei_30yr_baselines.json")]
  SEED_VHI[("vhi_province_ids.json<br/>34/34 NOAA GADM admin-1 IDs")]
  J_cecd[/cecafe_daily.json/]
  J_cec[/cecafe.json/]
  J_fe[/farmer_economics.json/]
  J_fsell[/farmer_selling_brazil.json/]
  J_vn[/vietnam_supply.json/]
  J_vnfe[/vn_farmer_economics/]
  J_vnwl[/vn_water_levels.json/]
  J_vnw[/vn_weather.json/]
  J_wx[/×7 origin weather.json<br/>+ spi_1/3 + spei_1/3/]
  J_vhi[/×7 vhi_*.json<br/>weekly NOAA STAR VHI by province/]
  J_agro[/agronomic_alerts.json<br/>+ AGRO rows merged into signals.json/]
  J_co[/colombia_supply.json/]
  J_et[/ethiopia_supply.json/]
  J_hn[/honduras_supply.json/]
  J_id[/indonesia_supply.json/]
  J_ug[/uganda_supply.json/]
  J_ferts[/global_fertilizers.json/]
  J_intel[/manual_intel.json/]
  J_enso[/enso.json/]
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
  wx{{Weather charts · rain · temp · cum · forecast}}
  soil{{Soil Moisture · ESSM}}
  drought{{"Drought + vegetation indices panel · SPI / SPEI / VHI columns"}}
  frost{{14-day Frost Risk grid · moved here from farmer-econ}}
  agroAlert{{"Agronomic alerts canonical · used by /map ticker + /signals merge"}}
  ensoSub{{ENSO subtab · forecast plume · analogs · risk map}}
  coexp{{Colombia}}
  et{{Ethiopia}}
  hn{{Honduras}}
  idn{{Indonesia}}
  ug{{Uganda}}
  fert{{Fertilizers}}
  intel{{Manual Intel}}
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
  EXP --> J_enso
  WSPI -.->|one-shot CI| SEED_SPI --> WWX
  WSPEI -.->|one-shot CI| SEED_SPEI --> WWX
  WBFL -.->|one-shot CI| WWX
  WWX --> J_wx --> wx
  J_wx --> soil
  J_wx --> drought
  WVHI --> SEED_VHI --> J_vhi
  J_vhi --> drought
  J_wx --> AGRO
  J_vhi --> AGRO
  AGRO --> J_agro --> agroAlert
  J_fe --> frost
  WENSO --> J_enso --> ensoSub
  WENFC --> J_enso
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
${DEFS}
  classDef vis fill:#1a2e05,stroke:#84cc16,color:#d9f99d;
  class W17,W32,W331,W332,W333,W334,W335,WCNTRY,WFERT,WINTEL,WWX,WSPI,WSPEI,WVHI,WENSO,WENFC,WBFL scr;
  class DB,SEED_SPI,SEED_SPEI,SEED_VHI store;
  class EXP,AGRO proc;
  class J_cecd,J_cec,J_fe,J_fsell,J_vn,J_vnfe,J_vnwl,J_vnw,J_wx,J_vhi,J_agro,J_co,J_et,J_hn,J_id,J_ug,J_ferts,J_intel,J_enso json;
  class br,mv,brexp,bfe,sell,cec,vnexp,vnbal,vnfe,vnwl,vnw,wx,soil,drought,frost,agroAlert,ensoSub,coexp,et,hn,idn,ug,fert,intel vis;`;

const DEMAND = `flowchart LR
  W3B["1.3b Slow-data · 1st/mo<br/>ECF stocks · USDA PSD · AJCA · UCDA"]
  WPOP["Population/age · UN WPP · World Bank"]
  W41["4.1 Earnings · quarterly · filings"]
  W31["3.1 Kaffeesteuer · 1st/mo · DESTATIS"]
  WMIX["manual / various"]
  WICE_KCD["1.13 ICE Cert Stocks · daily 17:00<br/>Arabica xls (sheet 7)<br/>publicdocs/coffee_cert_stock_*.xls"]
  WICE_KCA["1.14 ICE Arabica Ageing · day-1/mo<br/>coffee_aging_YYYYMMDD.xls"]
  WICE_RC["ICE Robusta · daily 17:00<br/>stock_report_RC_*.csv (10:30-11:15 sweep)<br/>+ age_allowance + gradings + iss_recv"]
  WICE_SPA["ICE SPA API (fallback)<br/>POST marketdata/api/reports/142/data<br/>{KC | RC} → warehouse + total"]
  COH[["cohort_outflow.py<br/>per-cohort DNA from gradings<br/>+ DNA-coverage guard"]]
  EXP{{"1.4 Export · 02:30"}}
  J_stk[/demand_stocks.json/]
  J_earn[/earnings.json/]
  J_tax[/kaffeesteuer.json/]
  J_mix[/factory_mix.json/]
  J_csa[/"certified_stocks_arabica.json<br/>+ ageing_report (year-bands)"/]
  J_csr[/certified_stocks_robusta.json<br/>+ monthly.implied_outflow<br/>+ monthly.current_by_origin/]
  J_h[/health.json/]
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
  tiles{{4-tile header per contract}}
  period{{Period view drills · age-banded}}
  sysflow{{"System Flow · warehouses · in/out/transit · cohort outflow"}}
  fresh{{"Freshness chip strip (per-feed)"}}
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
  WICE_KCD --> J_csa
  WICE_KCA --> J_csa
  WICE_RC --> J_csr
  WICE_RC --> COH --> J_csr
  WICE_SPA -.fallback / freshness probe.-> J_csa
  WICE_SPA -.fallback / freshness probe.-> J_csr
  J_csa --> tiles
  J_csr --> tiles
  J_csa --> period
  J_csr --> period
  J_csa --> sysflow
  J_csr --> sysflow
  J_h --> fresh
  J_csa --> fresh
  J_csr --> fresh
${DEFS}
  classDef vis fill:#451a03,stroke:#f59e0b,color:#fde68a;
  class W3B,WPOP,W41,W31,WMIX,WICE_KCD,WICE_KCA,WICE_RC,WICE_SPA scr;
  class COH proc;
  class EXP proc;
  class J_stk,J_earn,J_tax,J_mix,J_csa,J_csr,J_h json;
  class stk,ecf,psd,jp,age,grow,world,earn,tax,mix,tiles,period,sysflow,fresh vis;`;

const MACRO = `flowchart LR
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
${DEFS}
  classDef vis fill:#042f2e,stroke:#14b8a6,color:#99f6e4;
  class W19,W12,W23,WORIG,WCPI,W33 scr;
  class EXP proc;
  class J_mac,J_q,J_fx,J_fr,J_cpi,J_uscpi,J_fe,J_orig json;
  class xc,cci,fx,fr,cpi,uscpi,fert,orig vis;`;

const NEWSMAP = `flowchart LR
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
  J_agro[/"agronomic_alerts.json<br/>(produced end of 1.10 weather run)"/]
  base{{Coffee Map base}}
  price{{Price labels}}
  country{{Country pins + intel}}
  factory{{Factory pins}}
  exports{{Exports overlay}}
  freight{{Freight overlay}}
  vnport{{VN port-flow arrows}}
  news{{"News Feed / Sidebar"}}
  ticker{{"Agronomic Threats Ticker — top overlay<br/>country chips, severity sort, click→region detail"}}
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
  J_agro --> ticker
${DEFS}
  classDef vis fill:#500724,stroke:#ec4899,color:#fbcfe8;
  class W22,WPOLL,W11,W32,W12,WCNTRY,SEED,SUP scr;
  class DB store;
  class EXP proc;
  class J_lp,J_aca,J_news,J_ctry,J_fact,J_cec,J_fr,J_vnx,J_agro json;
  class base,price,country,factory,exports,freight,vnport,news,ticker vis;`;

const GLOBAL = `flowchart LR
  J_aca[/acaphe_live.json/]
  J_lp[/latest_prices.json/]
  J_orig[/origin_prices_history.json/]
  J_cot[/cot.json/]
  J_sig[/signals.json · quant + AGRO rows/]
  J_ev[/events.json · seed/]
  J_met[/origin weather JSON ×7 · drought gated by rain_hist_min/]
  J_sup[/×N _supply.json · per-region rain_mtd/hist/]
  J_fr[/freight.json/]
  J_q[/quant_report.json/]
  J_mac[/macro_cot.json/]
  J_news[(news_feed)]
  TICKER{{"Market Ticker — global band, every tab<br/>KC + RC live · FX"}}
  TG{{"Telegram morning brief · 03:00<br/>9 sections + 'Coming up · next 24h'<br/>weather alerts gated by seasonal baseline<br/>/cot appends per-rule signals listing"}}
  J_aca --> TICKER
  J_lp --> TICKER
  J_aca --> TG
  J_lp --> TG
  J_orig --> TG
  J_cot --> TG
  J_sig --> TG
  J_ev -->|next 24h| TG
  J_sup --> TG
  J_met --> TG
  J_fr --> TG
  J_q --> TG
  J_mac --> TG
  J_news --> TG
${DEFS}
  classDef vis fill:#083344,stroke:#22d3ee,color:#a5f3fc;
  class J_aca,J_lp,J_orig,J_cot,J_sig,J_ev,J_met,J_sup,J_fr,J_q,J_mac,J_news json;
  class TICKER,TG vis;`;

const TAB_DIAGRAMS: Array<{ title: string; chart: string }> = [
  { title: "News (Daily Brief)", chart: NEWS },
  { title: "Futures Exchange", chart: FUTURES },
  { title: "COT", chart: COT },
  { title: "Freight", chart: FREIGHT },
  { title: "Supply (incl. Weather + ENSO subtab)", chart: SUPPLY },
  { title: "Demand (incl. Certified Stocks)", chart: DEMAND },
  { title: "Macro", chart: MACRO },
  { title: "Map", chart: NEWSMAP },
  { title: "Global — Ticker & Telegram brief", chart: GLOBAL },
];

// Per-workflow operational metadata. The first four fields (wf, output,
// component, visual) describe what trader-facing value the flow produces;
// the optional five-group blocks below describe the OPS reality — when,
// where, how, what-if-it-breaks, and what-it-costs. Designed for the
// "if Cecafé's Akamai posture changes overnight, what do I check first"
// question.
//
// All ops blocks are optional; "TBD" surfaces unfilled slots in the UI
// rather than hiding them, so the audit gap is visible.
type TriggerType = "cron" | "manual" | "edge" | "composite" | "tbd";

interface FlowMetadata {
  // ── Trader-facing summary (always populated) ───────────────────────────
  wf: string;          // Workflow name / id, e.g. "1.13 ICE Certified Stocks"
  output: string;      // What it writes (JSON path or "—" for compute-only)
  component: string;   // Frontend / handler consumer
  visual: string;      // User-facing surface description

  // ── 1. Timing & Cadence — the "when" ───────────────────────────────────
  cadence?: {
    recurrence?: string;     // e.g. "Daily 17:00 UTC Mon-Fri"
    window?: string;         // Active execution window if any, e.g. "Market hrs 09:00-20:00 UTC"
    trigger?: TriggerType;   // cron | manual | edge | composite
  };

  // ── 2. Sourcing & Transport — the "where & how" ───────────────────────
  transport?: {
    provider?: string;       // e.g. "ICE Portal", "Open-Meteo", "CECAFÉ"
    method?: string;         // e.g. "Direct API GET", "BeautifulSoup HTML parse", "PDF extract"
    bypass?: string;         // Armor: e.g. "browser headers", "Akamai-friendly UA", "none"
  };

  // ── 3. Output & State — the "destination" ─────────────────────────────
  storage?: {
    target?: string;         // Same as `output` but normalized for filtering
    footprint?: string;      // e.g. "~2KB capped at 14d", "~150KB monthly"
    units?: string;          // Critical for ambiguous data: e.g. "60kg bags (KC) / 10MT lots (RC)"
  };

  // ── 4. Resiliency & Fallbacks — the "safety net" ──────────────────────
  resiliency?: {
    onMissing?: string;      // e.g. "keep last good JSON", "fail-closed", "use SPI baseline"
    debounce?: string;       // Alert flap rule: e.g. "2 consecutive days before Telegram ping"
    parserFallback?: string; // e.g. "regex extraction if structured JSON fails"
  };

  // ── 5. Compute & Cost — the "budget" ──────────────────────────────────
  runtime?: {
    duration?: string;       // Average run time, e.g. "~5s API", "~45s Playwright"
    cost?: string;           // CI minutes / month, e.g. "~10 min/mo"
  };
}

const ROWS: FlowMetadata[] = [
  {
    wf: "1.3 Daily OI", output: "oi_history.json", component: "OIHistoryTable", visual: "Futures · OI 14-day table (+ COT §2)",
    cadence: { recurrence: "02:00 UTC Mon-Fri", trigger: "cron" },
    transport: { provider: "Barchart core-api", method: "Direct API GET", bypass: "browser-shaped headers" },
    storage: { target: "oi_history.json (14d slice) + contract_prices_archive.json (5y)", footprint: "~50KB rolling + ~5MB archive", units: "lots (RC) / contracts (KC)" },
    resiliency: { onMissing: "keep 5y archive untouched; rolling view rebuilds next run" },
    runtime: { duration: "~30s" },
  },
  {
    wf: "1.3 Daily OI", output: "oi_fnd_chart.json", component: "OIFndChart", visual: "Futures + COT · OI Evolution to FND",
    cadence: { recurrence: "02:00 UTC Mon-Fri", trigger: "cron" },
    transport: { provider: "Barchart core-api", method: "derived from contract_prices_archive.json" },
    storage: { target: "oi_history.json (14d slice) + contract_prices_archive.json (5y)" },
    resiliency: { onMissing: "render last good archive snapshot" },
  },
  {
    wf: "1.3 → 2.3 rebuild", output: "cot.json price", component: "Step4IndustryPulse", visual: "COT · Industry Pulse — price + switch dots",
    cadence: { recurrence: "weekly: 1.3 daily M-F → 2.3 max-OI rebuild Fri 20:00 UTC", trigger: "composite" },
    transport: { provider: "Barchart + CFTC", method: "max-OI synthesis across the rolling archive" },
    storage: { target: "cot.json (312-week window)", units: "lots / Mgmd-Money net + Producer net" },
  },
  {
    wf: "1.1 Daily News", output: "news_feed / country_intel", component: "/api/news · CoffeeMap", visual: "Map · news labels / country intel",
    cadence: { recurrence: "01:00 UTC daily", trigger: "cron" },
    transport: { provider: "RSS + B3 + CEPEA + Cooabriel + AJCA + World Bank", method: "RSS + BeautifulSoup HTML parse" },
    storage: { target: "Postgres news_feed → news.json export", footprint: "~80KB" },
    resiliency: { onMissing: "per-source failures logged; rest of run proceeds" },
  },
  {
    wf: "1.2 Freight", output: "freight.json", component: "FreightContextPanel", visual: "Macro · Freight Context",
    cadence: { recurrence: "02:00 UTC daily (09:00 Vietnam)", trigger: "cron" },
    transport: { provider: "Freightos containers + Yahoo dry-bulk", method: "Direct API GET" },
    storage: { target: "freight.json", units: "$/FEU containers + BDRY proxy" },
    runtime: { duration: "~5s" },
  },
  {
    wf: "1.4 Export & Publish", output: "all static JSON", component: "—", visual: "plumbing — feeds every JSON visual",
    cadence: { recurrence: "02:30 UTC daily", trigger: "cron" },
    transport: { provider: "Postgres + caches", method: "composite re-export from DB" },
    storage: { target: "frontend/public/data/*.json + health.json" },
    runtime: { duration: "~3 min" },
  },
  {
    wf: "1.5 Fresh check", output: "—", component: "—", visual: "Telegram alert only",
    cadence: { recurrence: "07:00 UTC daily (3h after 1.4)", trigger: "cron" },
    transport: { method: "scan health.json freshness diff" },
    resiliency: { onMissing: "Telegram ping per stale feed", debounce: "fires daily as long as stale (no cool-down yet)" },
  },
  {
    wf: "Per-source Telegram alerts", output: "reads published JSON", component: "scraper/topic_notify_daily.py", visual: "Telegram — one text per source (1.6 brief retired 2026-08-14; /brief still on demand)",
    cadence: { recurrence: "03:00 UTC daily", trigger: "cron" },
    transport: { provider: "composite of all static JSONs", method: "compose-from-disk" },
    storage: { target: "Telegram channel post (not persisted)" },
    resiliency: { onMissing: "section omitted silently if its JSON is absent" },
  },
  {
    wf: "1.7 Cecafe Daily", output: "cecafe_daily.json", component: "DailyRegistration", visual: "Supply · Brazil · Daily Registration",
    cadence: { recurrence: "09:00 + 13:00 + 17:00 UTC (3 spread attempts/day)", trigger: "cron" },
    transport: { provider: "cecafe.com.br", method: "BeautifulSoup HTML + regex on TOTAIS row (requests after PR #149)", bypass: "Chrome-shaped UA + Accept-Language pt-BR" },
    storage: { target: "cecafe_daily.json", units: "60kg bags (arabica + conillon + soluvel)" },
    resiliency: { onMissing: "keep last good JSON; CecafeUnreachable surfaces TCP failures as distinct from parser bugs", parserFallback: "8-col TOTAIS row when 12-col layout drops" },
    runtime: { duration: "~10s per attempt; ~10min full retry window" },
  },
  {
    wf: "1.9 Quant CCI", output: "quant_report.json", component: "CurrencyIndexSection", visual: "Macro · Coffee Currency Index",
    cadence: { recurrence: "21:30 UTC Mon-Fri (post US close)", trigger: "cron" },
    transport: { provider: "jsDelivr FX CDN", method: "Direct API GET" },
    storage: { target: "quant_report.json", units: "weighted currency-basket index" },
    resiliency: { onMissing: "Robusta sentiment/factors decoupled; can fail independently" },
  },
  {
    wf: "1.16 Open-Direction Log", output: "quant_report.json (open_direction) + open_direction_history.json + open_direction_wf_analysis.json",
    component: "PriceDirectionSection / OpenDirectionCalendar / OpenDirectionRecord", visual: "Macro · Open Price Direction + Track Record; Research · walk-forward record",
    cadence: { recurrence: "03:00 UTC Mon-Fri (pre-open; brief chains on completion)", trigger: "cron" },
    transport: { provider: "intraday_kc_rc_15min + fx snapshots", method: "logistic model, exact SHAP" },
    storage: { target: "open_direction_history.json", footprint: "append-only prediction log", units: "overnight-gap direction + prob" },
    resiliency: { onMissing: "panel shows UNAVAILABLE; history rows stay pending until resolvable" },
  },
  {
    wf: "1.19 Sucafina Reports", output: "sucafina_reports.json", component: "OriginReportsPanel", visual: "News · Weekly notes from origin",
    cadence: { recurrence: "Thu 06:23 UTC weekly (Sat backstop)", trigger: "cron" },
    transport: { provider: "sucafina.com (Playwright) + Kontent CDN", method: "date links → PDF → pdfplumber → per-origin sections" },
    storage: { target: "sucafina_reports.json", footprint: "last 30 weeks", units: "per-origin market notes" },
    resiliency: { onMissing: "panel hidden until first run; unparsed weeks ship raw text + PDF link" },
  },
  {
    wf: "1.16 Open-Direction Log", output: "fx_intraday_snapshots.json", component: "(model input)", visual: "feeds cci_overnight feature",
    cadence: { recurrence: "03:00 UTC Mon-Fri (non-blocking step)", trigger: "cron" },
    transport: { provider: "Barchart queryminutes (Playwright)", method: "15-min FX bars → 17:30-London + 03:00-UTC anchors" },
    storage: { target: "fx_intraday_snapshots.json", footprint: "~500 days, 12 CCI pairs", units: "FX rate anchors per day" },
    resiliency: { onMissing: "cci_overnight stays dormant; model runs on kc_after + days_since_roll" },
  },
  {
    wf: "1.9 Quant CCI", output: "fx_history.json", component: "FxTimeSeriesPanel", visual: "Macro · FX Pair Time-Series",
    cadence: { recurrence: "21:30 UTC Mon-Fri", trigger: "cron" },
    transport: { provider: "jsDelivr FX CDN", method: "Direct API GET" },
    storage: { target: "fx_history.json", footprint: "365-day per-pair history", units: "USD-quoted FX for 12 pairs (5 exporters + 7 importers)" },
  },
  {
    wf: "Acaphe poll", output: "acaphe_live.json", component: "AcapheLiveQuotes", visual: "Futures · Daily Live Quotes",
    cadence: { recurrence: "every 15 min", window: "08:00–19:45 UTC Mon-Fri (Brazil market hrs)", trigger: "cron" },
    transport: { provider: "acaphe.com", method: "Direct API GET" },
    storage: { target: "acaphe_live.json", footprint: "<5KB", units: "¢/lb KC + $/MT RC live mid" },
    runtime: { duration: "~3s" },
  },
  {
    wf: "1.3b Slow-data", output: "demand_stocks.json", component: "StocksPanel", visual: "Demand · Stocks (ICE cert + PSD)",
    cadence: { recurrence: "03:00 UTC on the 1st of each month", trigger: "cron" },
    transport: { provider: "ECF + USDA PSD + AJCA + UCDA", method: "various per-source scrapers" },
    storage: { target: "demand_stocks.json (composite)" },
    resiliency: { onMissing: "per-source failure isolation; previous month's data retained" },
  },
  {
    wf: "2.2 Commodity Prices", output: "latest_prices.json", component: "CoffeeMap", visual: "Map · price labels + ticker",
    cadence: { recurrence: "22:55 UTC Tuesdays", trigger: "cron" },
    transport: { provider: "Barchart", method: "Direct API GET" },
    storage: { target: "latest_prices.json", units: "spot ¢/lb + $/MT for KC + RC" },
  },
  {
    wf: "2.3 COT + rebuild", output: "cot.json", component: "Step1/4/5/6/7/8", visual: "COT · Signals, Gauges, Heatmap, Global Flow, Industry Pulse, Dry Powder, Cycle, Report",
    cadence: { recurrence: "20:00 UTC Friday (CFTC publish window)", trigger: "cron" },
    transport: { provider: "CFTC disagg report", method: "ZIP+CSV download" },
    storage: { target: "cot.json", footprint: "312 weeks of disagg positions", units: "lots / MM-long, MM-short, PMPU-long, PMPU-short …" },
    resiliency: { onMissing: "previous week's data retained; signals re-compute from cot.json on next run" },
  },
  {
    wf: "2.3 COT + rebuild", output: "macro_cot.json", component: "CrossCommodityPanel", visual: "Macro · Cross-Commodity MM",
    cadence: { recurrence: "20:00 UTC Friday", trigger: "cron" },
    transport: { provider: "CFTC disagg report", method: "ZIP+CSV download (multi-commodity slice)" },
    storage: { target: "macro_cot.json", units: "MM net per commodity (coffee, sugar, cocoa, …)" },
  },
  {
    wf: "2.3 COT + rebuild", output: "signals.json", component: "morning_brief · /cot Telegram", visual: "Telegram · CoT signals",
    cadence: { recurrence: "rebuilt end of 1.4 (02:30 UTC) from latest cot.json", trigger: "composite" },
    transport: { method: "in-process signal-engine evaluation (frontend/scripts/export-signals.mjs)" },
    storage: { target: "signals.json", units: "rules with severity (info|watch|alert|critical) + score + magnitude" },
  },
  {
    wf: "3.1 Kaffeesteuer", output: "kaffeesteuer.json", component: "KaffeesteuerChart", visual: "Demand · Kaffeesteuer (DE tax)",
    cadence: { recurrence: "08:00 UTC on the 1st of each month", trigger: "cron" },
    transport: { provider: "DESTATIS", method: "PDF parse" },
    storage: { target: "kaffeesteuer.json", units: "€ tax revenue" },
  },
  {
    wf: "3.2 Cecafe Export", output: "cecafe.json", component: "CoffeeMap", visual: "Map · Brazil monthly exports",
    cadence: { recurrence: "08:00 UTC on the 15th of each month", trigger: "cron" },
    transport: { provider: "cecafe.com.br", method: "BeautifulSoup HTML + table extract", bypass: "Chrome-shaped UA" },
    storage: { target: "cecafe.json", units: "60kg bags monthly exports + per-destination split" },
  },
  {
    wf: "3.3.1 CONAB", output: "farmer_economics.json", component: "FarmerSellingPanel", visual: "Supply · Brazil Farmer Economics",
    cadence: { recurrence: "02:00 UTC on the 12th of each month", trigger: "cron" },
    transport: { provider: "conab.gov.br", method: "PDF parse + Safras echo" },
    storage: { target: "farmer_economics.json (CONAB block)", units: "% sold + R$ cost components" },
  },
  {
    wf: "3.3.2 BR Fertilizer", output: "farmer_economics.json", component: "FertilizerInputsPanel", visual: "Macro · Fertilizer Inputs (Brazil)",
    cadence: { recurrence: "03:00 UTC on the 12th of each month", trigger: "cron" },
    transport: { provider: "Comex Stat", method: "Direct API GET" },
    storage: { target: "farmer_economics.json (.fertilizer block)", units: "tonnes + USD imports per nutrient" },
  },
  {
    wf: "3.3.3 VN Fertilizer", output: "vn_fertilizer.json", component: "VnFarmerEconomics", visual: "Supply · VN Farmer Economics (fertilizer cost)",
    cadence: { recurrence: "04:00 UTC on the 12th of each month", trigger: "cron" },
    transport: { provider: "Vietnam Customs", method: "HTML scrape" },
    storage: { target: "vn_fertilizer.json", units: "tonnes + VND/USD imports" },
  },
  {
    wf: "3.3.4 VN Coffee Exports", output: "vn_coffee_export.json → vietnam_supply.json", component: "VnExportExplorer · VnBalanceSheet", visual: "Supply · VN Export Explorer + Balance Sheet",
    cadence: { recurrence: "04:30 UTC on the 12th of each month", trigger: "cron" },
    transport: { provider: "Vietnam Customs (GSO)", method: "HTML scrape" },
    storage: { target: "vn_coffee_export.json + vietnam_supply.json", units: "60kg bags + tonnes by destination" },
  },
  {
    wf: "3.3.5 Uganda UCDA", output: "uganda_supply.json", component: "UgandaTab", visual: "Supply · Uganda (exports, split, grades, destinations)",
    cadence: { recurrence: "02:00 UTC on the 14th of each month (mid-month publish)", trigger: "cron" },
    transport: { provider: "ugandacoffee.go.ug", method: "BeautifulSoup HTML + table extract" },
    storage: { target: "uganda_supply.json", units: "60kg bags + by-grade splits" },
  },
  {
    wf: "4.1 Earnings", output: "earnings.json", component: "EarningsTable", visual: "Demand · Roaster Earnings",
    cadence: { recurrence: "08:00 UTC on the 15th of Feb/May/Aug/Nov (post-quarter)", trigger: "cron" },
    transport: { provider: "10-K / 10-Q filings", method: "manual + filings scrape" },
    storage: { target: "earnings.json", units: "USD revenue / volumes per roaster" },
  },
  {
    wf: "various / manual", output: "factory_mix.json", component: "RoastingMixPanel", visual: "Demand · Roasting Mix",
    cadence: { trigger: "manual" },
    transport: { method: "manual / industry estimates" },
    storage: { target: "factory_mix.json" },
  },
  {
    wf: "various / manual", output: "global_fertilizers.json", component: "FertilizersTab", visual: "Supply · Fertilizers",
    cadence: { trigger: "manual" },
    transport: { provider: "UN Comtrade + World Bank", method: "manual aggregation" },
    storage: { target: "global_fertilizers.json" },
  },
  {
    wf: "various / manual", output: "manual_intel.json", component: "ManualIntelPanel", visual: "Supply · Manual Intel",
    cadence: { trigger: "manual" },
    transport: { method: "hand-curated entries" },
    storage: { target: "manual_intel.json" },
  },
  {
    wf: "various / manual", output: "retail_cpi.json", component: "RetailCpiPanel", visual: "Macro · Retail CPI",
    cadence: { recurrence: "monthly post-publish (BLS / Eurostat / BCB)", trigger: "manual" },
    transport: { provider: "BLS + Eurostat + BCB", method: "manual fetch + paste" },
    storage: { target: "retail_cpi.json", units: "YoY % coffee CPI per geography" },
  },
  {
    wf: "1.1 News → 1.4 Export", output: "us_cpi.json", component: "UsCpiPanel", visual: "Macro · Inflation · US CPI",
    cadence: { recurrence: "monthly post-publish (BLS CPI-U release)", trigger: "cron" },
    transport: { provider: "US BLS (CPI-U)", method: "BLS public API fetch" },
    storage: { target: "us_cpi.json", units: "YoY % headline/core/food/energy CPI" },
  },
  {
    wf: "various / manual", output: "origin_prices_history.json", component: "OriginPricesPanel", visual: "Macro · Origin Prices",
    cadence: { trigger: "manual" },
    transport: { method: "manual / aggregated origin sources" },
    storage: { target: "origin_prices_history.json", units: "¢/lb FOB differentials per origin" },
  },
  {
    wf: "various / manual", output: "*_supply.json (CO·ET·HN·ID)", component: "country tabs", visual: "Supply · country pages + Map (UG now via 3.3.5)",
    cadence: { trigger: "manual" },
    transport: { method: "country-specific manual updates" },
    storage: { target: "colombia/ethiopia/honduras/indonesia_supply.json" },
  },
  // ── Added in the last 10 days ────────────────────────────────────────────
  {
    wf: "1.13 ICE Certified Stocks", output: "certified_stocks_arabica.json + …robusta.json", component: "CertifiedStocksPanel · CertifiedStocksSystemFlow",
    visual: "Demand · Tiles + Period view + System flow + Freshness chips",
    cadence: { recurrence: "17:00 UTC Mon-Fri (weekend-skip added 2026-05)", window: "after ICE robusta ~10:30 UTC + arabica ~13:30 UTC publish", trigger: "cron" },
    transport: { provider: "ICE marketdata (10 source feeds)", method: "Direct API GET (XLS + PDF + XML)", bypass: "browser-shaped UA + Referer chain" },
    storage: { target: "certified_stocks_arabica.json + certified_stocks_robusta.json", footprint: "~200KB combined", units: "60kg bags (KC) / 10MT lots (RC) — both surfaced" },
    resiliency: { onMissing: "per-source failures logged but don't block the run; last-good JSON retained", parserFallback: "XLS-first → PDF fallback when ICE varies the daily file format" },
    runtime: { duration: "~5-10 min daily / ~90 min one-off 180d backfill", cost: "weekend-skip saves ~10 CI min/wk" },
  },
  {
    wf: "1.14 ICE Arabica Ageing (monthly)", output: "certified_stocks_arabica.json.ageing_report", component: "ArabicaPeriodTable",
    visual: "Demand · Stocks drill Age (0Y/1Y/2Y/3Y/>4Y) → Group → Origin",
    cadence: { recurrence: "14:00 UTC on the 1st of each month", trigger: "cron" },
    transport: { provider: "ICE marketdata (KC ageing report)", method: "PDF parse (pdfplumber)" },
    storage: { target: "certified_stocks_arabica.json.ageing_report block", units: "60kg bags by age bucket × origin × warehouse group" },
    resiliency: { onMissing: "previous month's ageing block retained" },
    runtime: { duration: "~30s" },
  },
  {
    wf: "cohort_outflow (inline 1.13)", output: "certified_stocks_robusta.json.monthly.{implied_outflow, current_by_origin}", component: "CertifiedStocksSystemFlow",
    visual: "Demand · Robusta per-origin in/out/lost/transit (cohort DNA + coverage guard)",
    cadence: { recurrence: "after each 1.13 run (effectively daily M-F)", trigger: "composite" },
    transport: { method: "in-process derivation from age-allowance + grading + tender feeds" },
    storage: { target: "certified_stocks_robusta.json.monthly.implied_outflow + .current_by_origin", units: "10MT lots / per-origin in-flow vs out-flow vs in-transit" },
    resiliency: { onMissing: "coverage guard refuses to publish when any source feed missing — readers see last good cohort instead of a half-built one" },
  },
  {
    wf: "0.3 SPI baseline (one-shot)", output: "spi_30yr_baselines.json", component: "fetch_origin_weather + WeatherCharts",
    visual: "Supply · Weather · Drought Indices (SPI-1 / SPI-3)",
    cadence: { recurrence: "one-shot (workflow_dispatch)", trigger: "manual" },
    transport: { provider: "Open-Meteo ERA5 archive (1991-2020 baseline)", method: "Direct API GET per province" },
    storage: { target: "backend/seed/spi_30yr_baselines.json", footprint: "~50KB seed", units: "monthly precip μ + σ per province × calendar month" },
    runtime: { duration: "~10 min full backfill across all provinces" },
  },
  {
    wf: "0.4 SPEI baseline (one-shot)", output: "spei_30yr_baselines.json", component: "fetch_origin_weather + WeatherCharts",
    visual: "Supply · Weather · Drought Indices (SPEI = D vs 30y, D = P − ET₀)",
    cadence: { recurrence: "one-shot (workflow_dispatch)", trigger: "manual" },
    transport: { provider: "Open-Meteo ERA5 (precip + et0_fao_evapotranspiration)", method: "Direct API GET" },
    storage: { target: "backend/seed/spei_30yr_baselines.json", footprint: "~80KB seed", units: "monthly (P − ET₀) μ + σ per province" },
    resiliency: { onMissing: "0.6 + 0.7 backfill workflows heal gaps in source weather_history before this rebuilds" },
    runtime: { duration: "~15 min full backfill" },
  },
  {
    wf: "/enso → /supply subtab", output: "enso.json", component: "SupplyEnsoTab",
    visual: "Supply · ENSO subtab (PhaseSummary + ForecastPlume + AnalogChart + RiskMap)",
    cadence: { recurrence: "rebuilt with the monthly ENSO scraper (~5th of each month)", trigger: "cron" },
    transport: { provider: "NOAA CPC + IRI + composite analogs", method: "Direct API GET + computed" },
    storage: { target: "enso.json", footprint: "~30KB", units: "ONI °C + phase + plume bands" },
    resiliency: { onMissing: "PR #127's IRI fallback handles CPC outages (still under investigation per issue #132 comment-11)" },
  },
  {
    wf: "EnsoPanel + WeatherRiskPanel relocation", output: "farmer_economics.json {.enso, .weather}", component: "WeatherCharts (farmerEconomicsUrl)",
    visual: "Supply · Brazil · Weather subtab (was: Farmer Economics)",
    cadence: { recurrence: "follows farmer_economics.json rebuild (12th monthly)", trigger: "cron" },
    transport: { method: "frontend re-route only — data path unchanged" },
    storage: { target: "farmer_economics.json (existing) re-surfaced under Weather subtab" },
  },
  {
    wf: "build_events_calendar.py", output: "events.json (seed + /public mirror)", component: "UpcomingCalendar",
    visual: "News · Coming up next 30 days (ISO-week timeline)",
    cadence: { recurrence: "rebuilt on every backend deploy + nightly export 1.4", trigger: "composite" },
    transport: { method: "compose from CFTC/USDA/ICE/CONAB known publish calendars" },
    storage: { target: "backend/seed/events.json → frontend/public/data/events.json mirror", footprint: "~10KB", units: "calendar events {date, source, label, importance}" },
  },
  {
    wf: "1.1 News (existing)", output: "news.json", component: "HeadlinesDigest + RiskRadar",
    visual: "News · Filtered headlines digest · keyword-velocity radar",
    cadence: { recurrence: "01:00 UTC daily (same as 1.1)", trigger: "cron" },
    transport: { method: "frontend re-use of existing news_feed → news.json export" },
    storage: { target: "news.json (already produced by 1.1)" },
  },
  {
    wf: "1.4 Export (existing)", output: "health.json", component: "FreshnessGrid",
    visual: "News · 'What changed since yesterday' chip grid (26 feeds, today pulse)",
    cadence: { recurrence: "02:30 UTC daily (piggybacks on 1.4)", trigger: "cron" },
    transport: { method: "frontend re-use of health.json with cadence-aware thresholds per feed" },
    storage: { target: "health.json (already produced by 1.4) — consumed client-side", units: "per-feed last-success ISO + threshold-relative tone" },
    resiliency: { onMissing: "grid renders 'Freshness signal unavailable' instead of stale grey-out" },
  },
  // ── Added this sprint (Phase 5 Path A + Sprint 2) ────────────────────────
  {
    wf: "0.5 NOAA STAR VHI (weekly, Sat 23:00)", output: "vhi_{origin}.json ×7", component: "WeatherCharts (VHI column in Drought + vegetation panel)",
    visual: "Supply · Weather · VHI chip per province · stress<40 / fair 40-60 / healthy>60",
    cadence: { recurrence: "23:00 UTC Saturday (after NOAA's Sat publish)", trigger: "cron" },
    transport: { provider: "NOAA STAR VHI service", method: "Direct API GET per province (latin-1 header guards added PR #147)" },
    storage: { target: "weather_history/vhi_{br,co,ho,et,vn,id,ug}.json ×7", footprint: "~20KB/origin", units: "VHI 0-100 by province × week" },
    resiliency: { onMissing: "per-origin .errors[] populated, rest of run continues; future-proofing watch on Sidama (#132-c1-20)" },
    runtime: { duration: "~2 min per Saturday run" },
  },
  {
    wf: "0.6 backfill_missing_fields (one-shot)", output: "weather_history/*.json (rain + et0 + tmean heal)", component: "(internal: unblocks SPEI emit when forecast endpoint truncates et0/rain)",
    visual: "—",
    cadence: { recurrence: "one-shot (workflow_dispatch)", trigger: "manual" },
    transport: { provider: "Open-Meteo ERA5 archive", method: "Direct API GET — re-fetches days where forecast endpoint dropped et0/rain/tmean" },
    storage: { target: "weather_history/*.json fields healed in place" },
  },
  {
    wf: "0.7 backfill_history_gap (one-shot)", output: "weather_history/*.json (2025 gap fill)", component: "(internal: unblocks SPEI-3 by making seed↔history contiguous)",
    visual: "—",
    cadence: { recurrence: "one-shot (workflow_dispatch)", trigger: "manual" },
    transport: { provider: "Open-Meteo ERA5 archive", method: "Direct API GET window: seed_end → today" },
    storage: { target: "weather_history/*.json (filled 2025 gap so SPEI-3 has a continuous 3-month look-back)" },
  },
  {
    wf: "Agronomic Alert Engine (Phase 5 Path A · end of 1.10)", output: "agronomic_alerts.json + AGRO rows in signals.json", component: "AgronomicTicker",
    visual: "Map · Live Agronomic Threats top overlay · country chips · click→region detail",
    cadence: { recurrence: "after each weather refresh (daily) + Saturday VHI run", trigger: "composite" },
    transport: { method: "rule engine over weather_history + VHI + SPI/SPEI baselines" },
    storage: { target: "agronomic_alerts.json + 6 AGRO rows appended to signals.json", units: "rule rows with severity (info|watch|alert|critical) + region + magnitude" },
    resiliency: { onMissing: "rules silently skip provinces with no underlying weather data instead of false-alarming" },
  },
  {
    wf: "Telegram week_ahead", output: "reads events.json", component: "telegram/handlers/brief.py::_upcoming_events_section",
    visual: "Telegram · 'Coming up · next 24h' block under weather",
    cadence: { recurrence: "03:00 UTC daily (piggybacks on 1.6)", trigger: "cron" },
    transport: { method: "compose-from-disk: events.json filtered to next 24h" },
    storage: { target: "Telegram channel post (not persisted)" },
    resiliency: { onMissing: "section omitted silently if events.json absent (same pattern as the rest of brief)" },
  },
  {
    wf: "Telegram weather", output: "—", component: "telegram/handlers/brief.py::_weather_line",
    visual: "Telegram · drought alerts gated by rain_mtd_mm < rain_hist_min (seasonal baseline)",
    cadence: { recurrence: "03:00 UTC daily (piggybacks on 1.6)", trigger: "cron" },
    transport: { method: "compose from weather_history + 30y seasonal baseline" },
    storage: { target: "Telegram channel post (not persisted)" },
    resiliency: { onMissing: "seasonal-baseline gate prevents false alarms during the dry season (was firing 'drought' in normal dry months pre-fix)" },
  },
  {
    wf: "/cot Telegram command (Body-1)", output: "reads signals.json", component: "telegram/handlers/cot.py",
    visual: "Telegram · 'Signals (NY)/(LDN)' per-rule listing under position block · CRIT/ALERT/WARN/INFO",
    cadence: { trigger: "edge", window: "on-demand (user types /cot)" },
    transport: { method: "compose-from-disk: signals.json filtered by market == NY|LDN, AGRO excluded" },
    storage: { target: "Telegram message (not persisted)", units: "rule rows with severity tag + score + magnitude" },
    resiliency: { onMissing: "block omitted silently if signals.json absent" },
  },
  {
    wf: "OI 14-day cap (Body-8)", output: "oi_history.json sliced to 14 days (was 30)", component: "OIHistoryTable",
    visual: "COT · OI 14-day table · contract_prices_archive.json (5y) untouched",
    cadence: { recurrence: "follows 1.3 (02:00 UTC Mon-Fri)", trigger: "cron" },
    transport: { method: "fetch_oi_json MAX_DAYS=14 + defensive frontend slice" },
    storage: { target: "oi_history.json", footprint: "~50% of pre-change size", units: "lots (RC) / contracts (KC)" },
  },
  {
    wf: "COT Robusta nearby-OI fix (Body-7)", output: "—", component: "lib/cot/oiNearby.ts · Overview.tsx",
    visual: "COT · 'X k lots in nearby (N and U)' re-derived from per-contract oi_history.json (was 0.0 bug)",
    cadence: { trigger: "edge", window: "on-demand client-side render" },
    transport: { method: "client-side derivation from per-contract oi_history.json (no fetch)" },
    storage: { target: "—" },
    resiliency: { onMissing: "falls back to last-good per-contract OI rather than the bugged exch_oi_ldn aggregate" },
  },

  // ── 0.x — Low-level pollers + one-shot backfills ─────────────────────────
  {
    wf: "0.1 Acaphe poll", output: "live_quotes (Upstash Redis)", component: "AcapheLiveQuotes", visual: "Futures · live ACAPHE quotes ticker",
    cadence: { recurrence: "every 15 min Mon-Fri 08:00-19:00 UTC", window: "RC London + KC NY trading overlap", trigger: "cron" },
    transport: { provider: "acaphe.com", method: "BeautifulSoup HTML parse → Upstash REST set" },
    storage: { target: "Upstash live_quotes key (no file)", footprint: "~1KB single snapshot" },
    resiliency: { onMissing: "next tick overwrites; freshness check (1.8) flags >6h stale", debounce: "concurrency: cancel-in-progress → fresh tick wins" },
    runtime: { duration: "~30s" },
  },
  {
    wf: "0.2 Refresh inventory", output: "workflows_inventory.json", component: "LiveWorkflowInventory + WorkflowDriftPanel", visual: "Data Platform Map · live inventory + drift panel",
    cadence: { recurrence: "on push to .github/workflows/** or the build script", trigger: "edge" },
    transport: { method: "yaml.safe_load over every workflow file" },
    storage: { target: "workflows_inventory.json", footprint: "~17KB / 56 workflows", units: "structural metadata + drift report" },
    resiliency: { onMissing: "keeps last good JSON (auto-commit only when content changes)" },
    runtime: { duration: "~10s" },
  },
  {
    wf: "0.12 VN River Flow", output: "vn_river_flow.json", component: "VnWaterLevels (VietnamTab)", visual: "Supply · Vietnam · water-level + dam alerts",
    cadence: { recurrence: "10:00 UTC daily (after 08:00 UTC NCHMF publish)", trigger: "cron" },
    transport: { provider: "NCHMF Vietnam Hydromet", method: "daily bulletin scrape" },
    storage: { target: "vn_river_flow.json (rolling)" },
    resiliency: { onMissing: "keep last good JSON" },
  },
  {
    wf: "0.8 UCDA monthly backfill", output: "uganda_monthly.json", component: "Uganda monthly report panels (when wired)", visual: "Supply · Uganda · monthly PDF backfill (one-shot)",
    cadence: { recurrence: "manual workflow_dispatch only", trigger: "manual" },
    transport: { provider: "UCDA monthly PDF index", method: "patchright stealth + pdfplumber extract", bypass: "Cloudflare bypass via patchright (GH IPs blocked)" },
    storage: { target: "uganda_monthly.json (~80 PDFs back to ~2018)", footprint: "~few hundred KB" },
    resiliency: { onMissing: "set +e + rc capture → commits only on rc=0; retry 3× preserves the contract" },
  },
  {
    wf: "0.9 30Y weather backfill", output: "backend/seed/weather_history/{origin}.json", component: "WeatherCharts climatology bands", visual: "Supply · weather · 30-year baseline + bands (one-shot)",
    cadence: { recurrence: "manual workflow_dispatch only", trigger: "manual" },
    transport: { provider: "Open-Meteo archive API", method: "per-origin batch fetch 1995-2024" },
    storage: { target: "backend/seed/weather_history/{origin}.json", footprint: "~MBs per origin seed" },
    resiliency: { onMissing: "daily 1.10 fetch accumulates new actuals on top of the seed" },
  },
  {
    wf: "0.14 BPS Indonesia exim", output: "indonesia_exports.json", component: "IndonesiaTab export panels", visual: "Supply · Indonesia · BPS exports",
    cadence: { recurrence: "workflow_dispatch only (cron commented out pending Xvfb proof)", trigger: "manual" },
    transport: { provider: "Indonesia BPS exim portal", method: "headless browser scrape" },
    storage: { target: "indonesia_exports.json" },
  },
  {
    wf: "0.10 VHI backfill", output: "backend/seed/vhi_history.json", component: "(seeds the weekly 0.5 VHI fetch)", visual: "Supply · weather · VHI long-form history (one-shot)",
    cadence: { recurrence: "manual workflow_dispatch only", trigger: "manual" },
    transport: { provider: "NOAA STAR VHI text endpoint", method: "Direct GET" },
    storage: { target: "backend/seed/vhi_history.json" },
    resiliency: { onMissing: "weekly 0.5 fetch grows the file forward from where this one-shot stops" },
  },
  {
    wf: "0.10 Colombia exports", output: "colombia_exports.json", component: "OriginExportPanel (ColombiaTab)", visual: "Supply · Colombia · monthly exports + NANDINA breakdown",
    cadence: { recurrence: "06:30 UTC daily (DANE + FNC publish irregularly; daily catch-up)", trigger: "cron" },
    transport: { provider: "DANE (NANDINA) + FNC headline", method: "FNC + DANE scrapers in sequence" },
    storage: { target: "colombia_exports.json", units: "60kg bags (FNC) + USD value (DANE NANDINA)" },
    resiliency: { onMissing: "per-source failures logged; rest of run proceeds" },
  },

  // ── 1.x — Daily + ops layer ──────────────────────────────────────────────
  {
    wf: "1.21 Brazil export forecast", output: "brazil_export_projection.json", component: "BrazilTab forecast block", visual: "Supply · Brazil · SSOT export projection",
    cadence: { recurrence: "18:00 UTC daily", trigger: "cron" },
    transport: { method: "compute over the historical Cecafé monthlies (local, no network)" },
    storage: { target: "brazil_export_projection.json" },
    resiliency: { onMissing: "no upstream network — fails only if the compute itself breaks" },
  },
  {
    wf: "1.8 Check live quotes", output: "—", component: "—", visual: "Telegram alert · live-quotes freshness",
    cadence: { recurrence: "hourly :15 Mon-Fri 09:15-20:15 UTC", window: "poll window", trigger: "cron" },
    transport: { method: "Upstash GET live_quotes → parse fetched_at" },
    resiliency: { onMissing: "Telegram alert when live_quotes.fetched_at >6h old (poller dead)" },
  },
  {
    wf: "1.10 Weather fetch", output: "{origin}_weather.json", component: "WeatherCharts (all origin tabs)", visual: "Supply · weather · actuals / forecast / climatology",
    cadence: { recurrence: "01:53 UTC daily (ahead of every other data-commit job)", trigger: "cron" },
    transport: { provider: "Open-Meteo forecast API", method: "Direct GET per origin region" },
    storage: { target: "backend/seed/weather_history/{origin}.json (accumulator) → {origin}_weather.json (export)", footprint: "growing daily" },
    resiliency: { onMissing: "keeps last good seed; daily appends are idempotent" },
    runtime: { duration: "~10min" },
  },
  {
    wf: "1.10 Weather fetch", output: "agronomic_alerts.json + merged into signals.json", component: "AgronomicTicker + signals consumers", visual: "Map · IPHM agronomic alerts ticker",
    cadence: { recurrence: "tail step of 1.10", trigger: "cron" },
    transport: { method: "SPI/SPEI/forecast inputs → IPHM rule eval" },
    storage: { target: "agronomic_alerts.json + flattened into signals.json" },
  },
  {
    wf: "1.10 Weather fetch", output: "weather_analogs_brazil.json", component: "BrazilWeatherAnalogs", visual: "Supply · Brazil · analog years (production forecast)",
    cadence: { recurrence: "tail step of 1.10", trigger: "cron" },
    transport: { method: "Euclidean distance over per-phenology-stage signatures vs historical Brazil seed" },
    storage: { target: "weather_analogs_brazil.json" },
  },
  {
    wf: "1.11 Port activity", output: "frontend/public/data/port_activity/", component: "PortActivity (FreightTab)", visual: "Freight · per-port seasonal + monthly charts",
    cadence: { recurrence: "Wed 06:17 UTC (PortWatch refreshes Tue ~13:00-14:00 UTC)", trigger: "cron" },
    transport: { provider: "IMF PortWatch", method: "Direct GET per port" },
    storage: { target: "port_activity/index.json + {port}.json", footprint: "~8MB total / ~30 ports" },
    resiliency: { onMissing: "keep last good index + per-port files" },
  },
  {
    wf: "1.22 Slow-data scraper", output: "Postgres PSD tables → psd_coffee.json (in 1.4 export)", component: "Demand · PSD-derived widgets", visual: "Demand · USDA PSD monthly (consumption / production)",
    cadence: { recurrence: "12th of each month 03:00 UTC", trigger: "cron" },
    transport: { provider: "USDA PSD", method: "Direct fetch + parse" },
    storage: { target: "psd_coffee.json slice" },
  },
  {
    wf: "1.12 Vercel redeploy", output: "—", component: "—", visual: "Vercel deploy (the act of publishing)",
    cadence: { recurrence: "03:41 + 10:00 UTC + workflow_run chain off 1.4 / 1.13", trigger: "composite" },
    transport: { method: "POST to Vercel deploy hook (VERCEL_DEPLOY_HOOK secret)" },
    resiliency: { onMissing: "dedup guard skips duplicate fires within the same SHA (PR #314)", debounce: "concurrency group serialises overlap; Vercel itself dedups identical builds" },
    runtime: { duration: "~5-10s per fire" },
  },
  {
    wf: "1.15 CPI", output: "us_cpi.json + retail_cpi.json", component: "UsCpiPanel + RetailCpiPanel", visual: "Macro · US CPI + retail-coffee CPI panels",
    cadence: { recurrence: "11th-16th of month 13:40 UTC + 1st 03:00 UTC catch-up", trigger: "cron" },
    transport: { provider: "BLS API (key optional · keyless = 25 queries/day)", method: "Direct API GET" },
    storage: { target: "us_cpi.json + retail_cpi.json" },
    resiliency: { onMissing: "keep last good JSON; freshness threshold 35 days per 1.5" },
  },

  // ── 3.x — Demand / imports (monthly + semi-annual) ───────────────────────
  {
    wf: "3.4 ECF stocks", output: "ecf_stocks.json", component: "Demand · ECF panel", visual: "Demand · ECF stocks (bi-monthly)",
    cadence: { recurrence: "5th of each month 04:00 UTC", trigger: "cron" },
    transport: { provider: "ECF", method: "index page → per-post PDF extract" },
    storage: { target: "ecf_stocks.json", footprint: "bi-monthly; debug dumps retained 14d" },
  },
  {
    wf: "3.11 Balance sheets", output: "frontend/public/data/balance_sheets/", component: "SupplyDemandBalance (per origin)", visual: "Supply · per-origin S/D balance sheets",
    cadence: { recurrence: "06:00 UTC on 20 Jun + 20 Dec (semi-annual)", trigger: "cron" },
    transport: { method: "multi-source synthesis (BR / CO / ID / UG)" },
    storage: { target: "balance_sheets/{origin}.json" },
  },
  {
    wf: "3.5 AJCA Japan", output: "ajca.json", component: "Demand · AJCA panel", visual: "Demand · Japan AJCA stocks (monthly)",
    cadence: { recurrence: "monthly", trigger: "cron" },
    transport: { provider: "AJCA Japan", method: "Direct fetch + PDF parse (country breakdown)" },
    storage: { target: "ajca.json", footprint: "monthly" },
    resiliency: { onMissing: "YoY relies on ajca_history.json accumulator (cache wipe = year-long gap, see #132)" },
  },
  {
    wf: "3.6 Spot Coffee (ATTE)", output: "spot_coffee.json", component: "Macro · ATTE spot panel", visual: "Macro · ATTE Brazilian spot prices (daily)",
    cadence: { recurrence: "daily", trigger: "cron" },
    transport: { provider: "ATTE", method: "BeautifulSoup HTML parse" },
    storage: { target: "spot_coffee.json" },
  },
  {
    wf: "3.7 UN WPP age", output: "un_wpp_age.json (via 1.4 export)", component: "AgeCohortPanel + CohortExplainer", visual: "Demand · age cohort population pyramid (annual)",
    cadence: { recurrence: "15 July 03:00 UTC (annual)", trigger: "cron" },
    transport: { provider: "UN World Population Prospects", method: "Playwright + DB upsert" },
    storage: { target: "un_wpp_age.json (annual snapshot)" },
  },
  {
    wf: "3.8 UN Comtrade imports", output: "coffee_imports_comtrade.json", component: "Demand · imports panel", visual: "Demand · global green-coffee imports (UN Comtrade)",
    cadence: { recurrence: "15th of each month 07:00 UTC", trigger: "cron" },
    transport: { provider: "UN Comtrade", method: "Direct API GET" },
    storage: { target: "coffee_imports_comtrade.json" },
  },
  {
    wf: "3.9 USITC imports", output: "us_coffee_imports.json", component: "Demand · US imports panel", visual: "Demand · US imports by origin (USITC DataWeb)",
    cadence: { recurrence: "16th of each month 07:30 UTC", trigger: "cron" },
    transport: { provider: "USITC DataWeb", method: "Direct fetch" },
    storage: { target: "us_coffee_imports.json" },
  },
  {
    wf: "3.10 Eurostat imports", output: "eu_coffee_imports.json", component: "Demand · EU imports panel", visual: "Demand · EU imports by origin (Eurostat Comext)",
    cadence: { recurrence: "17th of each month 08:00 UTC", trigger: "cron" },
    transport: { provider: "Eurostat Comext", method: "Direct fetch" },
    storage: { target: "eu_coffee_imports.json" },
  },

  // ── 9.x — CI / hygiene ──────────────────────────────────────────────────
  {
    wf: "9.1 CI Tests", output: "—", component: "—", visual: "Required PR status check",
    cadence: { recurrence: "every push + PR + daily 06:00 UTC", trigger: "composite" },
    transport: { method: "pytest backend + vitest / tsc frontend" },
    resiliency: { onMissing: "blocks PR merge until green" },
  },
  {
    wf: "9.2 Backend lint", output: "—", component: "—", visual: "Required PR status check",
    cadence: { recurrence: "every push + PR", trigger: "composite" },
    transport: { method: "ruff (+ mypy where wired)" },
  },
  {
    wf: "9.3 Smart-quote guard", output: "—", component: "—", visual: "Required PR status check",
    cadence: { recurrence: "every push + PR", trigger: "composite" },
    transport: { method: "grep for curly quotes / em-dashes in TS/TSX strings" },
    resiliency: { onMissing: "fails the PR if a smart quote slips into a TypeScript string" },
  },
];

// ── Operational metadata card view ──────────────────────────────────────────
// Replaces the flat 4-column table with an expandable per-flow card.
// Always-visible header line carries wf · output · component · visual.
// Click toggles a detail panel that surfaces the five ops blocks:
// cadence · transport · storage · resiliency · runtime. Empty sub-fields
// render "TBD" rather than disappearing — the audit gap stays visible.

// Three-letter chip per trigger type — uniform width, instantly scannable.
const TRIGGER_BADGE: Record<TriggerType, { tag: string; cls: string }> = {
  cron:      { tag: "CRON", cls: "text-sky-300 border-sky-700/60 bg-sky-950/40" },
  manual:    { tag: "MAN",  cls: "text-amber-300 border-amber-700/60 bg-amber-950/40" },
  edge:      { tag: "EDGE", cls: "text-emerald-300 border-emerald-700/60 bg-emerald-950/40" },
  composite: { tag: "COMP", cls: "text-violet-300 border-violet-700/60 bg-violet-950/40" },
  tbd:       { tag: "TBD",  cls: "text-slate-500 border-slate-700 bg-slate-900" },
};

function _fieldsFilledRatio(meta: FlowMetadata): { filled: number; total: number } {
  // Walks the five ops blocks and counts populated sub-fields. Helper
  // for the header progress dot — "5/14 ops fields filled".
  const groups: Array<Record<string, string | TriggerType | undefined> | undefined> = [
    meta.cadence, meta.transport, meta.storage, meta.resiliency, meta.runtime,
  ];
  // 14 = 3+3+3+3+2 sub-fields across the five blocks.
  let filled = 0;
  for (const g of groups) {
    if (!g) continue;
    for (const v of Object.values(g)) {
      if (typeof v === "string" && v.trim().length > 0) filled++;
      else if (v && v !== "tbd") filled++;   // TriggerType passthrough
    }
  }
  return { filled, total: 14 };
}

function DimensionRow({ label, value }: { label: string; value: string | undefined }) {
  const populated = value && value.trim().length > 0;
  return (
    <div className="flex gap-2 text-[10.5px] leading-snug">
      <span className="text-slate-500 w-28 shrink-0">{label}</span>
      <span className={populated ? "text-slate-300" : "text-slate-700 italic"}>
        {populated ? value : "TBD"}
      </span>
    </div>
  );
}

function DimensionBlock({ title, accent, children }: {
  title: string; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className={`text-[9px] uppercase tracking-widest font-bold ${accent}`}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function FlowCard({ meta }: { meta: FlowMetadata }) {
  const [open, setOpen] = useState(false);
  const trig = meta.cadence?.trigger ?? "tbd";
  const badge = TRIGGER_BADGE[trig];
  const ratio = _fieldsFilledRatio(meta);
  const ratioPct = (ratio.filled / ratio.total) * 100;
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-950/60 hover:border-slate-700 transition-colors">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-start gap-3 px-3 py-2 text-left"
      >
        <span className={`shrink-0 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${badge.cls}`}>
          {badge.tag}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-amber-300 font-semibold truncate">{meta.wf}</div>
          <div className="text-[10.5px] text-slate-300 leading-snug mt-0.5">{meta.visual}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
            <span className="font-mono text-slate-400">→ {meta.output}</span>
            <span className="font-mono text-slate-500">{meta.component}</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span
            title={`Ops detail: ${ratio.filled}/${ratio.total} fields filled`}
            className="text-[9px] font-mono text-slate-500 whitespace-nowrap"
          >
            {ratio.filled}/{ratio.total} ops
          </span>
          <div className="w-10 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full ${ratioPct >= 75 ? "bg-emerald-500" : ratioPct >= 40 ? "bg-amber-500" : "bg-slate-600"}`}
              style={{ width: `${Math.max(4, ratioPct)}%` }}
            />
          </div>
          <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <DimensionBlock title="Cadence · when" accent="text-sky-300">
            <DimensionRow label="recurrence" value={meta.cadence?.recurrence} />
            <DimensionRow label="window"     value={meta.cadence?.window} />
            <DimensionRow label="trigger"    value={meta.cadence?.trigger} />
          </DimensionBlock>
          <DimensionBlock title="Transport · where & how" accent="text-violet-300">
            <DimensionRow label="provider" value={meta.transport?.provider} />
            <DimensionRow label="method"   value={meta.transport?.method} />
            <DimensionRow label="bypass"   value={meta.transport?.bypass} />
          </DimensionBlock>
          <DimensionBlock title="Storage · destination" accent="text-emerald-300">
            <DimensionRow label="target"    value={meta.storage?.target} />
            <DimensionRow label="footprint" value={meta.storage?.footprint} />
            <DimensionRow label="units"     value={meta.storage?.units} />
          </DimensionBlock>
          <DimensionBlock title="Resiliency · safety net" accent="text-amber-300">
            <DimensionRow label="onMissing"     value={meta.resiliency?.onMissing} />
            <DimensionRow label="debounce"      value={meta.resiliency?.debounce} />
            <DimensionRow label="parserFallback" value={meta.resiliency?.parserFallback} />
          </DimensionBlock>
          <DimensionBlock title="Runtime · budget" accent="text-rose-300">
            <DimensionRow label="duration" value={meta.runtime?.duration} />
            <DimensionRow label="cost"     value={meta.runtime?.cost} />
          </DimensionBlock>
        </div>
      )}
    </div>
  );
}

function WorkflowTable() {
  const totalFilled = ROWS.reduce((acc, r) => acc + _fieldsFilledRatio(r).filled, 0);
  const totalSlots  = ROWS.length * 14;
  const auditPct    = Math.round((totalFilled / totalSlots) * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 text-[11px]">
        <div className="text-slate-400">
          <span className="font-semibold text-slate-200">{ROWS.length}</span> flows ·
          click any to expand the operational metadata (cadence · transport · storage · resiliency · runtime).
        </div>
        <div className="font-mono text-slate-500">
          Audit fill: <span className="text-slate-300">{totalFilled}/{totalSlots}</span> · {auditPct}%
        </div>
      </div>
      <div className="space-y-1.5">
        {ROWS.map((meta, i) => (
          <FlowCard key={i} meta={meta} />
        ))}
      </div>
    </div>
  );
}

// ── Live Workflow Inventory ─────────────────────────────────────────────────
// Auto-generated from .github/workflows/*.yml by build_workflow_inventory.py
// (run on every push that touches a workflow file). Renders structural
// metadata only — name, triggers, cron, workflow_run chains, concurrency,
// timeout — so the page reflects the actual YAML without manual editing.

interface InventoryWorkflow {
  file:              string;
  name:              string;
  triggers:          string[];
  crons:             string[];
  workflow_run_deps: string[];
  concurrency_group: string | null;
  timeout_minutes:   number | null;
}
interface DriftReport {
  uncovered_workflows:       { file: string; name: string; version: string }[];
  stale_curation:            string[];
  non_workflow_entries:      string[];
  uncovered_workflows_count: number;
  stale_curation_count:      number;
}
interface InventoryPayload {
  generated_at: string;
  count:        number;
  workflows:    InventoryWorkflow[];
  drift?:       DriftReport;
}

const TRIGGER_COLORS: Record<string, string> = {
  schedule:           "bg-sky-900/60 border-sky-700 text-sky-200",
  workflow_run:       "bg-indigo-900/60 border-indigo-700 text-indigo-200",
  workflow_dispatch:  "bg-slate-800 border-slate-700 text-slate-300",
  push:               "bg-amber-900/60 border-amber-700 text-amber-200",
  pull_request:       "bg-amber-900/40 border-amber-700/60 text-amber-200/80",
};

function TriggerChip({ kind }: { kind: string }) {
  const cls = TRIGGER_COLORS[kind] ?? "bg-slate-800 border-slate-700 text-slate-400";
  return (
    <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded border font-mono ${cls}`}>
      {kind}
    </span>
  );
}

// Drift warning — surfaces workflows that exist in the YAML but have no
// curated row in the "Per-workflow → exact dashboard visual" table above.
// The auto inventory now self-detects this gap (see backend/scripts/
// build_workflow_inventory.py::compute_drift) so the page nags us instead
// of silently aging out of sync.
function WorkflowDriftPanel({ drift }: { drift: DriftReport | undefined }) {
  if (!drift) return null;
  const { uncovered_workflows, stale_curation } = drift;
  if (uncovered_workflows.length === 0 && stale_curation.length === 0) {
    return (
      <div className="text-[11px] text-emerald-400/80 bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-3 py-2">
        ✓ Curated table is in sync with the workflow YAML — no drift.
      </div>
    );
  }
  return (
    <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-amber-200">
          Curated table drift — needs attention
        </h2>
        <p className="text-[11px] text-amber-300/80 mt-0.5">
          Comparison between <code>.github/workflows/*.yml</code> and the curated{" "}
          <code>ROWS</code> table in <code>app/data-map/page.tsx</code>. Refreshed on every push
          that changes a workflow file (see <code>0.2 Refresh Workflow Inventory</code>).
        </p>
      </div>

      {uncovered_workflows.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-amber-300/70 mb-1.5">
            {uncovered_workflows.length} workflow{uncovered_workflows.length === 1 ? "" : "s"} without a curated row
          </div>
          <ul className="text-[11px] font-mono space-y-0.5">
            {uncovered_workflows.map((w) => (
              <li key={w.file} className="text-amber-100">
                <span className="text-amber-400 inline-block w-12">{w.version}</span>
                <span className="text-amber-300/80 inline-block w-44">{w.file}</span>
                <span className="text-amber-100/70">{w.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stale_curation.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-rose-300/80 mb-1.5">
            {stale_curation.length} curated row{stale_curation.length === 1 ? "" : "s"} pointing to a workflow that no longer exists
          </div>
          <ul className="text-[11px] font-mono text-rose-200 space-y-0.5">
            {stale_curation.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// Wrapper that fetches the inventory JSON once for both the drift panel
// (above the curated table) and the live inventory table itself.
function WorkflowDriftCheck() {
  const { data, loading, error } =
    useFetchJson<InventoryPayload>("/data/workflows_inventory.json");
  if (loading) return <div className="text-[11px] text-slate-500">Checking for drift…</div>;
  if (error)   return <div className="text-[11px] text-red-400">Drift check failed: {error.message}</div>;
  if (!data)   return null;
  return <WorkflowDriftPanel drift={data.drift} />;
}

function LiveWorkflowInventory() {
  const { data, loading, error } =
    useFetchJson<InventoryPayload>("/data/workflows_inventory.json");

  if (loading) return <div className="text-[11px] text-slate-500">Loading inventory…</div>;
  if (error)   return <div className="text-[11px] text-red-400">Failed to load: {error.message}</div>;
  if (!data)   return null;

  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-3 leading-relaxed">
        <span className="text-slate-300">{data.count} workflows</span> auto-detected from{" "}
        <code className="text-slate-300">.github/workflows/*.yml</code> · regenerated on push by{" "}
        <code className="text-slate-300">build-workflow-inventory.yml</code> · last refresh{" "}
        <span className="text-slate-300 font-mono">{data.generated_at}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-slate-500 bg-slate-800/40">
              <th className="text-left px-2 py-1.5">File</th>
              <th className="text-left px-2 py-1.5">Name</th>
              <th className="text-left px-2 py-1.5">Triggers</th>
              <th className="text-left px-2 py-1.5">Cron</th>
              <th className="text-left px-2 py-1.5">Chains off</th>
              <th className="text-left px-2 py-1.5">Concurrency</th>
              <th className="text-right px-2 py-1.5">Timeout</th>
            </tr>
          </thead>
          <tbody>
            {data.workflows.map((w) => (
              <tr key={w.file} className="border-t border-slate-800/60 align-top">
                <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{w.file}</td>
                <td className="px-2 py-1.5 text-slate-200">{w.name}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {w.triggers.map((t) => <TriggerChip key={t} kind={t} />)}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {w.crons.length === 0 ? <span className="text-slate-600">—</span>
                    : w.crons.map((c, i) => <div key={i}>{c}</div>)}
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {w.workflow_run_deps.length === 0 ? <span className="text-slate-600">—</span>
                    : w.workflow_run_deps.map((d, i) => <div key={i} className="text-indigo-300">{d}</div>)}
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  {w.concurrency_group ?? <span className="text-slate-600">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right text-slate-300">
                  {w.timeout_minutes != null ? `${w.timeout_minutes}m` : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function DataMapPage() {
  return (
    <div>
      <PageHeader
        title="Data Map"
        subtitle="How every fetch flows through storage to each dashboard visual. Source of truth: docs/DATA_PLATFORM_MAP.md"
      />
      <div className="p-4 space-y-4">
        <Card title="Architecture overview — the single-source view">
          <Mermaid chart={ARCHITECTURE} />
          <div className="text-[11px] text-slate-500 leading-relaxed mt-3 px-1">
            <p className="mb-1">
              <span className="text-amber-400">★ contract_prices_archive.json</span> is the single coffee
              OI+price source: one daily fetch (1.3) feeds it, and it fans out to the OI table, both
              OI→FND charts, and the Industry Pulse price (via the max-OI rebuild in 2.3).
            </p>
            <p>Symbol convention — FETCH=RM (Barchart) · STORE=RC (canonical) · DISPLAY=RM (OI table + FND chart).</p>
          </div>
        </Card>

        <p className="text-[11px] text-slate-500 px-1">
          One diagram per dashboard tab — source · frequency → store → JSON → visual.
        </p>
        {TAB_DIAGRAMS.map(({ title, chart }) => (
          <Card key={title} title={title}>
            <Mermaid chart={chart} />
          </Card>
        ))}

        <WorkflowDriftCheck />

        <Card title="Data downloads — export any dataset to CSV">
          <DataDownloads />
        </Card>

        <Card title="Per-workflow → exact dashboard visual">
          <WorkflowTable />
        </Card>

        <Card title="Live workflow inventory — auto-generated from YAML">
          <LiveWorkflowInventory />
        </Card>
      </div>
    </div>
  );
}
