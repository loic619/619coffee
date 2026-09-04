// Mermaid source for the Data Map's pipeline diagrams.
//
// Pure data — no React — so the page file stays about layout. One diagram per
// dashboard tab, each tracing source · frequency → store → JSON → visual, plus
// the ARCHITECTURE overview that shows how the single price+OI archive fans
// out.

// Shared class definitions appended to every per-tab diagram. `vis` (the tab's
// own colour) is supplied per diagram.
const DEFS = `
  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;`;

export const ARCHITECTURE = `flowchart LR
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
  W120["1.20 Traded tape · 18:50 M-F<br/>acaphe tape + board"]
  W198["1.98 Intraday KC/RC · 20:13 M-F<br/>Barchart 15-min bars"]
  ARC[("contract_prices_archive.json")]
  TARC[("tradespread_archive.json")]
  EXP{{"1.4 Export · 02:30"}}
  J_aca[/acaphe_live.json/]
  J_chain[/futures_chain.json/]
  J_oi[/oi_history.json/]
  J_fnd[/oi_fnd_chart.json/]
  J_tape[/tradespread.json/]
  J_intra[/intraday_kc_rc_15min.json/]
  quote{{Daily Live Quotes}}
  chain{{Futures Chain}}
  oi{{OI 7-day Table}}
  oifnd{{OI Evolution to FND}}
  tape{{Traded Tape Panel}}
  model{{Open-direction model}}
  WPOLL --> J_aca --> quote
  W13 --> ARC
  W13 --> EXP --> J_chain --> chain
  ARC --> J_oi --> oi
  ARC --> J_fnd --> oifnd
  W120 -->|"full tick tape"| TARC
  W120 -->|"open · +15min · RC-close<br/>close vs settle · VWAP · pressure"| J_tape --> tape
  W198 -->|"open · 17:30 · 18:30 anchors"| J_intra --> model
${DEFS}
  classDef vis fill:#2e1065,stroke:#8b5cf6,color:#ddd6fe;
  class WPOLL,W13,W120,W198 scr;
  class ARC,TARC store;
  class EXP proc;
  class J_aca,J_chain,J_oi,J_fnd,J_tape,J_intra json;
  class quote,chain,oi,oifnd,tape,model vis;`;

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
  WICE_KCD["1.13 ICE Cert Stocks · 00:35 M-F + chain<br/>once-a-day guard<br/>Arabica xls (sheet 7)"]
  WICE_KCA["1.14 ICE Arabica Ageing · day-1/mo<br/>coffee_aging_YYYYMMDD.xls"]
  WICE_RC["ICE Robusta (in 1.13)<br/>stock_report_RC_YYYYMMDD_HHMMSS.csv<br/>+ age_allowance + gradings + iss_recv"]
  HITS[("stock_report_hits.json<br/>observed publish seconds")]
  T0{{"tier 0 · recorded second<br/>1 GET"}}
  T1{{"tier 1 · top-10 ±2s"}}
  T2{{"tier 2 · sweep 10:29-11:00<br/>3s/req · 96 min full walk<br/>resumable cursor"}}
  MISS{{"sweep exhausted<br/>Telegram: missed, late release"}}
  BF["0.19 operator backfill<br/>enter HHMMSS on Research"]
  REC{{"hole recovery<br/>known time, no snapshot"}}
  J_ipt[/ice_publish_times.json/]
  icepub{{"Research · Admin<br/>publish-time calendar"}}
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
  WICE_RC --> T0 -->|miss| T1 -->|miss| T2
  T2 --> J_csr
  HITS --> T0
  T2 -->|"records the second"| HITS
  T2 -->|"no hit in window"| MISS --> icepub
  icepub --> BF --> HITS
  HITS --> REC --> J_csr
  HITS --> J_ipt --> icepub
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
  class T0,T1,T2,REC proc;
  class HITS store;
  class EXP proc;
  class J_stk,J_earn,J_tax,J_mix,J_csa,J_csr,J_h,J_ipt json;
  class stk,ecf,psd,jp,age,grow,world,earn,tax,mix,tiles,period,sysflow,fresh,icepub vis;`;

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

export interface FlowDiagram {
  /** URL slug — `?tab=pipelines&flow=futures` deep-links straight to one chart. */
  id: string;
  title: string;
  /** The question this pipeline answers, shown under the picker. */
  blurb: string;
  chart: string;
}

export const TAB_DIAGRAMS: FlowDiagram[] = [
  { id: "news",    title: "News (Daily Brief)",
    blurb: "Where each headline on the News tab came from, and when it was fetched.",
    chart: NEWS },
  { id: "futures", title: "Futures Exchange",
    blurb: "The board, the tape and the open-interest archive — four workflows into one price surface.",
    chart: FUTURES },
  { id: "cot",     title: "COT",
    blurb: "CFTC Friday release through the max-OI rebuild into the positioning charts.",
    chart: COT },
  { id: "freight", title: "Freight",
    blurb: "Container and dry-bulk rates, and the static-file fallback behind them.",
    chart: FREIGHT },
  { id: "supply",  title: "Supply (incl. Weather + ENSO)",
    blurb: "Origin exports, farm-gate prices, weather and ENSO — the widest tab on the dashboard.",
    chart: SUPPLY },
  { id: "demand",  title: "Demand (incl. Certified Stocks)",
    blurb: "Certified and destination stocks, customs imports, consumption and roaster earnings.",
    chart: DEMAND },
  { id: "macro",   title: "Macro",
    blurb: "FX, rates and the cross-commodity index the coffee complex is read against.",
    chart: MACRO },
  { id: "map",     title: "Map",
    blurb: "Origins, ports and facilities — what feeds the geographic view.",
    chart: NEWSMAP },
  { id: "global",  title: "Global — ticker & Telegram brief",
    blurb: "The two surfaces that read across every other tab: the header ticker and the morning brief.",
    chart: GLOBAL },
];

