// The curated per-workflow table behind the Data Map's Workflows sub-tab.
//
// Hand-maintained, and deliberately so: the live inventory beside it is
// generated from the YAML and knows nothing about what a flow is FOR. The
// drift check compares the two, which is why a row here that no longer has a
// workflow shows up as an error rather than quietly rotting.

// Per-workflow operational metadata. The first four fields (wf, output,
// component, visual) describe what trader-facing value the flow produces;
// the optional five-group blocks below describe the OPS reality — when,
// where, how, what-if-it-breaks, and what-it-costs. Designed for the
// "if Cecafé's Akamai posture changes overnight, what do I check first"
// question.
//
// All ops blocks are optional; "TBD" surfaces unfilled slots in the UI
// rather than hiding them, so the audit gap is visible.
export type TriggerType = "cron" | "manual" | "edge" | "composite" | "tbd";

export interface FlowMetadata {
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

export const ROWS: FlowMetadata[] = [
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
    wf: "1.20 Traded tape", output: "tradespread.json", component: "TradedTapePanel", visual: "Futures · Traded Tape",
    cadence: {
      recurrence: "18:50 UTC Mon-Fri (one run per session)",
      window: "after both settles — 14:50 ET in EDT, 13:50 ET in EST",
      trigger: "cron",
    },
    transport: { provider: "acaphe.com", method: "Playwright login → 6 tick panels + 2 spread panels + iquote board" },
    storage: {
      target: "tradespread.json (summary) + tradespread_archive.json (full tape, 400 sessions)",
      units: "per contract: first tick, +15 min, price at the 17:30 London bell, "
           + "last trade, settlement, close − settle, lifted/hit lots, VWAP up/down, pressure",
    },
    resiliency: {
      onMissing: "the board (iquote) fails independently of the tape — settle fields go null "
               + "and the tick stats still store. Absorbed workflow 0.2 (KC at RC close), which "
               + "polled a live snapshot 8×/weekday for one instant the tape already timestamps.",
    },
  },
  {
    wf: "1.98 Intraday KC/RC", output: "intraday_kc_rc_15min.json", component: "open-direction model", visual: "Futures · model inputs (not a panel)",
    cadence: { recurrence: "20:13 UTC Mon-Fri", trigger: "cron" },
    transport: { provider: "Barchart", method: "Playwright → 15-min bars, volume-stitched front contract" },
    storage: {
      target: "intraday_kc_rc_15min.json",
      footprint: "~1,500 sessions",
      units: "RC open/09:15/16:30/17:30, KC 17:30/18:30, both settles — the anchors behind kc_after_rc_diff",
    },
  },
  {
    wf: "1.22 Slow-data", output: "demand_stocks.json", component: "StocksPanel", visual: "Demand · Stocks (ICE cert + PSD)",
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
    cadence: {
      recurrence: "00:35 UTC Tue-Sat cron + chained off 1.1, once-a-day guard",
      window: "anchors the previous business day; ICE robusta publishes 10:25-12:50 UTC, "
        + "97% of it inside the swept 10:29-11:00",
      trigger: "composite",   // 00:35 cron + workflow_run chain off 1.1
    },
    transport: {
      provider: "ICE marketdata (10 source feeds)",
      method: "Direct API GET (XLS + PDF + CSV), 5s/req — /marketdata/ 429s ANY concurrency",
      bypass: "browser-shaped UA + Referer chain",
    },
    storage: {
      target: "certified_stocks_arabica.json + certified_stocks_robusta.json",
      footprint: "~200KB combined",
      units: "60kg bags (KC) / 10MT lots (RC) — both surfaced",
    },
    resiliency: {
      onMissing:
        "The robusta CSV is stamped with the exact SECOND it was generated and there is no "
        + "index, so it has to be guessed: tier 0 tries the second already recorded for that "
        + "date (1 GET), tier 1 the ten most frequent ±2s, tier 2 sweeps 10:29-11:00 at 3s/req "
        + "and saves a cursor so a run killed by the 120-min timeout resumes rather than "
        + "restarting. That window is narrow ON PURPOSE — 1,920 candidates is a 96-min full "
        + "walk that fits the timeout, so 'found nothing' is a real answer rather than 'ran out "
        + "of time'; it covers 97% of sessions and the rest are announced, not hidden. A sweep "
        + "that exhausts the window posts 'missed, late release' to Telegram and the day is "
        + "listed as pending on Research · Admin, where entering the second dispatches 0.19. "
        + "ICE retains historical reports (probe 0.18), so a missed day stays recoverable: any "
        + "date with a known time but no snapshot is re-fetched, ≤20/run.",
      parserFallback: "XLS-first → PDF fallback when ICE varies the daily file format",
    },
    runtime: {
      duration: "~8 min when the day's second is known; up to the 120-min cap on a cold sweep",
      cost: "was ~49% of all Actions minutes before the once-a-day guard and tier 0",
    },
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
    wf: "retired · SPI baseline (one-shot)", output: "spi_30yr_baselines.json", component: "fetch_origin_weather + WeatherCharts",
    visual: "Supply · Weather · Drought Indices (SPI-1 / SPI-3)",
    cadence: { recurrence: "one-shot (workflow_dispatch)", trigger: "manual" },
    transport: { provider: "Open-Meteo ERA5 archive (1991-2020 baseline)", method: "Direct API GET per province" },
    storage: { target: "backend/seed/spi_30yr_baselines.json", footprint: "~50KB seed", units: "monthly precip μ + σ per province × calendar month" },
    runtime: { duration: "~10 min full backfill across all provinces" },
  },
  {
    wf: "retired · SPEI baseline (one-shot)", output: "spei_30yr_baselines.json", component: "fetch_origin_weather + WeatherCharts",
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
    wf: "0.4 backfill_missing_fields (one-shot)", output: "weather_history/*.json (rain + et0 + tmean heal)", component: "(internal: unblocks SPEI emit when forecast endpoint truncates et0/rain)",
    visual: "—",
    cadence: { recurrence: "one-shot (workflow_dispatch)", trigger: "manual" },
    transport: { provider: "Open-Meteo ERA5 archive", method: "Direct API GET — re-fetches days where forecast endpoint dropped et0/rain/tmean" },
    storage: { target: "weather_history/*.json fields healed in place" },
  },
  {
    wf: "retired · backfill_history_gap (one-shot)", output: "weather_history/*.json (2025 gap fill)", component: "(internal: unblocks SPEI-3 by making seed↔history contiguous)",
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
    wf: "3.3.6 UCDA monthly reports", output: "uganda_monthly.json", component: "Uganda monthly report panels (when wired)", visual: "Supply · Uganda · monthly PDF backfill (one-shot)",
    cadence: { recurrence: "manual workflow_dispatch only", trigger: "manual" },
    transport: { provider: "UCDA monthly PDF index", method: "patchright stealth + pdfplumber extract", bypass: "Cloudflare bypass via patchright (GH IPs blocked)" },
    storage: { target: "uganda_monthly.json (~80 PDFs back to ~2018)", footprint: "~few hundred KB" },
    resiliency: { onMissing: "set +e + rc capture → commits only on rc=0; retry 3× preserves the contract" },
  },
  {
    wf: "retired · 30Y weather backfill (one-shot)", output: "backend/seed/weather_history/{origin}.json", component: "WeatherCharts climatology bands", visual: "Supply · weather · 30-year baseline + bands (one-shot)",
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
    wf: "retired · VHI backfill (one-shot)", output: "backend/seed/vhi_history.json", component: "(seeds the weekly 0.5 VHI fetch)", visual: "Supply · weather · VHI long-form history (one-shot)",
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
    wf: "1.23 Brazil conilon demand", output: "brazil_conilon_demand.json",
    component: "BrazilArbitragePanel", visual: "Futures · Brazil Internal Arbitrage · conilon blend share",
    cadence: { recurrence: "05:23 UTC Tuesdays", window: "weekly — the legs refresh on their own schedules", trigger: "cron" },
    transport: { provider: "USDA FAS PSD + CONAB", method: "PSD coffee CSV zip + CONAB SerieHistoricaCafe.txt; Cecafé read from the repo" },
    storage: { target: "brazil_conilon_demand.json", footprint: "<20KB", units: "60-kg bags + % of the roast-and-ground blend" },
    resiliency: {
      onMissing: "estimate — refuses years where soluble exceeds half the conilon crop, and a CONAB outage degrades to a missing cross-check rather than no series",
    },
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
    wf: "1.10 Weather fetch", output: "weather_analogs_brazil.json", component: "WeatherAnalogs / AnalogSection", visual: "Supply · Brazil · analog years (production forecast)",
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
