"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LDN_PARAMS, NY_PARAMS } from "@/lib/cot/intraweekModel";
import { FOBBING_MODEL, fobbingUsdMt } from "@/lib/originCosts";
import { cachedFetchStatic } from "@/lib/api";
import CotBacktestReport from "@/components/futures/CotBacktestReport";
// The container shells still render the full set where that is the right
// read; the per-article children are imported too so a single article can be
// opened on its own from the index.
import Article1 from "./agronomy/Article1";
import Article2 from "./agronomy/Article2";
import Article3 from "./agronomy/Article3";
import Article4 from "./agronomy/Article4";
import Article5 from "./agronomy/Article5";
import LogisticModel from "./demand/LogisticModel";
import SaturationLimits from "./demand/SaturationLimits";
import MarketCeilings from "./demand/MarketCeilings";
import EnsoExplainer from "./EnsoExplainer";
import CertifiedStocksParity from "./CertifiedStocksParity";
import ConilonBasis from "./ConilonBasis";
import OptionsExpiryStudy from "./OptionsExpiryStudy";
import OptionsGammaMap from "./OptionsGammaMap";
import OptionsVrp from "./OptionsVrp";
import OptionsSkew from "./OptionsSkew";
import OptionsFlowCot from "./OptionsFlowCot";
import OptionsOiWalls from "./OptionsOiWalls";
import OptionsOptionization from "./OptionsOptionization";
import SeptemberXray from "./SeptemberXray";
import CropyearXray from "./CropyearXray";
import CotSwapIdentity from "./CotSwapIdentity";
import DroughtRiskMethodology from "./methodology/DroughtRiskMethodology";
import YieldRainfall from "./YieldRainfall";
import CpiMethodology from "./methodology/CpiMethodology";
import DifferentialModelNote from "./methodology/DifferentialModelNote";
import SignalsMethodology from "./methodology/SignalsMethodology";
import OpenDirectionRecord from "./methodology/OpenDirectionRecord";
import IntradayDrift from "./IntradayDrift";
import NewsSentimentMethodology from "./methodology/NewsSentimentMethodology";
import FuturesMethodology from "./methodology/FuturesMethodology";
import MacroMethodology from "./methodology/MacroMethodology";
import SupplyMethodology from "./methodology/SupplyMethodology";
import FarmerMethodology from "./methodology/FarmerMethodology";
import FreightMethodology from "./methodology/FreightMethodology";
import EnsoModelMethodology from "./methodology/EnsoModelMethodology";
import DemandDataMethodology from "./methodology/DemandDataMethodology";
import DeliveryProcessMethodology from "./methodology/DeliveryProcessMethodology";
import { AlwaysOpen, ResearchCard, type Tone } from "./methodology/prose";
import IcePublishTimes from "./admin/IcePublishTimes";
import ThresholdAlerts from "./admin/ThresholdAlerts";
import { ARTICLES, CAT_LABEL, type Article } from "@/lib/research/catalog";
import { DEFAULT_SORT, SORT_OPTIONS, datedCount, optionById, sortArticles } from "@/lib/research/sort";
import { applyOverrides, type Override, type OverrideMap } from "@/lib/research/overrides";
import EditPanel from "./EditPanel";
import FactorMap, { FactorMapLegend } from "./factor-map/FactorMap";
import { BY_ID } from "./factor-map/nodes";
import { nodesForArticle } from "./factor-map/articleNodes";
import HondurasProfile from "./origins/HondurasProfile";
import CertStocksSpread from "./CertStocksSpread";
import SectionNav from "./SectionNav";
import EnsoArbitrage from "./EnsoArbitrage";
import RetailPassthrough from "./RetailPassthrough";
import VnMidMonth from "./VnMidMonth";
import WorkflowFailures from "./WorkflowFailures";

// Top-level research categories. Each groups several articles/tools, which render
// stacked as collapsible cards on the category page.
type Cat = "quant" | "supply" | "logistics" | "exchange" | "demand" | "admin";
const CATS: { id: Cat; label: string }[] = [
  { id: "quant",     label: "Quant & positioning" },
  { id: "supply",    label: "Supply" },
  { id: "logistics", label: "Logistics" },
  { id: "exchange",  label: "Exchange & certified stocks" },
  { id: "demand",    label: "Demand" },
  { id: "admin",     label: "Admin & platform" },
];

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-slate-300 leading-relaxed mb-2${className ? ` ${className}` : ""}`}>{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
const Code = ({ children }: { children: React.ReactNode }) =>
  <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">{children}</code>;
// Block-level formula / pseudo-code, monospace on a tinted panel.
function Fml({ children }: { children: React.ReactNode }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed bg-slate-800/70 border border-slate-700/60 rounded px-3 py-2 my-2 text-amber-200 whitespace-pre-wrap">
      {children}
    </pre>
  );
}
function H2({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-bold text-slate-100 mt-7 mb-1 pb-1 border-b border-slate-700">{children}</h3>;
}

// Collapsible research card — thin alias over the unified ResearchCard shell
// (methodology/prose.tsx) so every article shares the same collapsed format,
// sub-category tone and last-edited date.
function CollapsibleCard({ kicker, title, subtitle, tone, updated, defaultOpen = false, bare = false, children }: {
  kicker?: string; title: string; subtitle?: string; tone?: Tone; updated?: string;
  defaultOpen?: boolean; bare?: boolean; children: React.ReactNode;
}) {
  return (
    <ResearchCard tone={tone} kicker={kicker ?? ""} title={title} subtitle={subtitle} updated={updated}
      defaultOpen={defaultOpen} bare={bare}>
      {children}
    </ResearchCard>
  );
}

function IntraweekMethodology() {
  return (
      <CollapsibleCard tone="amber" updated="2026-07-14" kicker="COT · positioning" title="Intraweek COT nowcast — methodology" subtitle="Bridging the weekly COT report with a daily positioning estimate">
        <H>What problem it solves</H>
        <P>
          The CFTC/ICE Commitments of Traders (COT) report is <strong>weekly</strong> — it tells you where each
          trader cohort stood on the report Tuesday. Between prints we are blind. The <em>post-COT</em> block in the
          Overview is a <strong>nowcast</strong>: it estimates how positioning has probably shifted from the COT day
          up to the most recent daily data, so the read isn&rsquo;t stale by the time you act on it.
        </P>

        <H>Data sources</H>
        <ul className="space-y-1">
          <LI><strong>Weekly truth</strong> — <Code>cot.json</Code>: each cohort&rsquo;s long/short (managed money, PMPU,
            swaps, other reportables, non-reportables) on every COT Tuesday.</LI>
          <LI><strong>Daily detail</strong> — a per-contract archive of daily open interest <em>and</em> settlement
            price for every Arabica (KC) and Robusta (RM/RC) contract, ~5 years deep. This is what lets us see
            intraweek OI build/liquidation, the front price, and the curve structure day by day.</LI>
        </ul>

        <H>The model, step by step</H>
        <P>For each trading day in the window (COT day → latest), we read that day&rsquo;s change in total open
          interest and the front-contract price move, then:</P>
        <ul className="space-y-1">
          <LI><strong>Regime (which leg moved).</strong> The classic OI×price reading sets the dominant flow:
            price↑ &amp; OI↑ = fresh longs; price↓ &amp; OI↑ = fresh shorts; price↑ &amp; OI↓ = short-covering;
            price↓ &amp; OI↓ = long-liquidation.</LI>
          <LI><strong>Managed money share.</strong> MM is credited its share of that day&rsquo;s open-interest change
            (its share of total OI from the last COT), scaled by the size of the price move versus a 1% reference —
            a bigger move implies higher conviction. Moves under 0.1% are treated as directionless and skipped.</LI>
          <LI><strong>Counterparty.</strong> Every contract has two sides, so the opposite of MM&rsquo;s flow is the
            counterparty. <span className="text-slate-400">Producers</span> (short hedgers) sell into strength;
            <span className="text-slate-400"> roasters</span> (long hedgers) buy into weakness. That counterparty
            flow is split between industry (PMPU) and swaps/other reportables by their COT share of the relevant side.</LI>
          <LI><strong>Accumulate.</strong> The daily attributions are summed across the whole window, so a week with a
            down-day then an up-day is captured correctly rather than collapsed into a single endpoint comparison.</LI>
        </ul>

        <H>Direction is the signal; magnitude is rough</H>
        <P>
          Validated on the 5-year archive (~250 COT weeks per market), the model&rsquo;s <strong>directional</strong>
          accuracy is real — managed-money net, producers and roasters all land <strong>~66–70%</strong> sign-correct,
          versus a ~51–53% base rate (commercials do <em>not</em> simply add coverage every week). The <strong>size</strong>
          of the move is far less predictable: only ~0–5% better than assuming no change. So the lot figures shown are
          deliberately framed as approximate — read the arrow, not the decimal.
        </P>

        <H>Confidence tiers</H>
        <P>
          The one lever that genuinely improves reliability is signal strength. Binning industry calls by the size of
          the estimated flow, accuracy climbs sharply — so each producer/roaster line carries a confidence chip
          calibrated on the backtest:
        </P>
        <ul className="space-y-1">
          <LI><span className="text-emerald-400 font-semibold">high</span> — ~82–86% directional hit-rate.</LI>
          <LI><span className="text-amber-400 font-semibold">med</span> — ~67–69%.</LI>
          <LI><span className="text-slate-400 font-semibold">low</span> — ~60%, near the base rate; treat as tentative.</LI>
        </ul>
        <P>
          The tier cut-offs (33rd/67th percentiles of historical signal magnitude, in lots) are market-specific:
          Arabica <Code>{`low<${NY_PARAMS.confLow} · high>${NY_PARAMS.confHigh}`}</Code>,
          Robusta <Code>{`low<${LDN_PARAMS.confLow} · high>${LDN_PARAMS.confHigh}`}</Code>.
          Because the live window is often a <em>partial</em> week, early-week reads are small and will usually show
          &ldquo;low&rdquo; — by design: there isn&rsquo;t much information yet.
        </P>

        <H>Per-market calibration</H>
        <P>
          The two markets behave differently. On the backtest the magnitude-error curve is monotonic in opposite
          directions, so Arabica is given a higher MM-share multiplier ({NY_PARAMS.mmShareMult}×) and Robusta a lower
          one ({LDN_PARAMS.mmShareMult}×). Direction is unaffected by this lever; it only sizes the lot estimates.
        </P>

        <H>What was tried and rejected</H>
        <ul className="space-y-1">
          <LI><strong>Price-level z-score</strong> (the idea that commercials are contrarian on absolute price):
            scored ~46–51% for industry direction — worse than a coin flip — so it was not added.</LI>
          <LI><strong>Raw weekly price direction</strong> as the predictor: the day-by-day, OI-gated regime model
            beats it (e.g. roasters ~70% vs ~57–63%).</LI>
        </ul>

        <H>Caveats</H>
        <ul className="space-y-1">
          <LI>It is a <strong>nowcast, not a forecast</strong> — it explains the move that has already happened in OI and
            price, it does not predict next week.</LI>
          <LI>Magnitudes are approximate; lean on the direction and the confidence tier.</LI>
          <LI>The daily archive carries a ~1-day internal lag (price settles a day before OI is reported); immaterial
            at weekly cadence but worth knowing.</LI>
          <LI>The post-COT block only appears once daily data exists <em>after</em> the COT date; if the feed lags the
            release it hides rather than showing stale numbers.</LI>
        </ul>

        <H>Reproducing the numbers</H>
        <P>
          Everything here is regenerated by <Code>scripts/backtest-intraweek.mjs</Code> (run with
          <Code>node --import tsx scripts/backtest-intraweek.mjs</Code>), which replays every COT→COT interval covered
          by the archive, scores predicted vs. realized cohort deltas against zero- and proportional-OI baselines, and
          prints the per-market multiplier and confidence-tier calibration. The model itself lives in
          <Code>lib/cot/intraweekModel.ts</Code>.
        </P>
      </CollapsibleCard>
  );
}

function FrostRiskMethodology() {
  return (
      <CollapsibleCard tone="cyan" updated="2026-07-14" kicker="Weather · tail risk" title="Frost risk — why radiative frost is the trade that matters" subtitle="The physics of Brazilian winter frost and how the monitor flags it">
        <H>Why frost is the trade that matters</H>
        <P>
          Frost is the single largest <strong>tail risk</strong> in coffee. Unlike drought, which trims a crop at the
          margin, a hard radiative frost in the southern Brazilian Arabica belt can kill leaf, scorch cherries and, in
          the worst case, set back trees for two seasons. The historical record is brutal and fast: the &ldquo;Black
          Frost&rdquo; of <strong>July 1975</strong> wiped out the bulk of Paraná&rsquo;s crop and is the reference event
          for the entire industry; <strong>June/July 1994</strong> saw two frosts that roughly doubled the price; and the
          <strong> July 2021</strong> freeze pushed Arabica from ~$1.20 to over $2.40/lb inside a few months. Each was a
          step-change, not a drift. The point of a frost monitor is therefore not precision — it is to flag, ahead of the
          news, that the <em>conditions for a step-change exist tonight</em>.
        </P>

        <H>The physics: air temperature is not the answer</H>
        <P>
          The naïve approach — &ldquo;frost when the 2 m air temperature hits 0 °C&rdquo; — systematically misses real
          frost events. Damaging frosts in the Brazilian winter are overwhelmingly <strong>radiative</strong>: on a
          clear, calm, dry night the ground and leaf surface radiate heat to space and cool <em>well below</em> the air
          temperature measured at the standard 2 m height. Plants are routinely damaged at recorded air temperatures of
          3–5 °C. So the model estimates the quantity that actually matters — the <strong>canopy / grass-minimum
          surface temperature</strong> — hour by hour, from the variables that govern radiative cooling.
        </P>

        <H>The model — canopy surface temperature</H>
        <P>
          For each representative point we pull hourly forecast + recent history from Open-Meteo
          (<Code>temperature_2m, dew_point_2m, cloud_cover, wind_speed_10m</Code>) and estimate the canopy-surface
          temperature for <em>every</em> hour of the night — not just the minimum-temperature hour, so we can measure
          how long the freeze lasts:
        </P>
        <Fml>{`T_surface = T_air
            − (1 − cloud/100) · max(0, 5 − 0.25 · wind_kmh)     ← radiative decoupling
            − min(1.5, max(0, (2 − dew_pt) · 0.25))             ← dry-air amplification`}</Fml>
        <ul className="space-y-1">
          <LI><strong>Radiation term.</strong> <Code>(1 − cloud/100)</Code> switches the cooling off under overcast
            skies (clouds re-radiate heat back down) and on fully to a ~5 °C deficit under clear skies. The
            {" "}<Code>max(0, 5 − 0.25 · wind)</Code> factor erodes that deficit as wind mixes the boundary layer, fully
            gone by <strong>20 km/h</strong>. This is why a cold-but-windy or cold-but-cloudy night is <em>safe</em> while
            a milder, clear, dead-calm night is dangerous. <span className="text-slate-400">The 0.25 coefficient is the
            one number moved by the backtest below.</span></LI>
          <LI><strong>Dry-air amplification.</strong> Dry air holds little latent heat, so no dew/frost deposition
            buffers the fall and the surface keeps dropping. Graduated at −0.25 °C per °C of dew point below 2 °C, capped
            at −1.5 °C (replacing the old flat −0.5 °C step).</LI>
        </ul>

        <H>Three mechanisms, not one</H>
        <P>
          The surface number is then read through the mechanism actually operating — because equal-temperature frosts
          do unequal damage:
        </P>
        <ul className="space-y-1">
          <LI><strong className="text-blue-300">Radiative</strong> — the default: clear, calm night, canopy decouples
            and freezes below the 2 m air.</LI>
          <LI><strong className="text-blue-300">Advective</strong> — a wind-driven sub-zero <em>air mass</em>
            {" "}(<Code>air_min ≤ 1.5 °C</Code> with <Code>wind ≥ 10 km/h</Code>). Here wind does <em>not</em> protect the
            plant — the whole air column is cold — so breeze is a red flag, not a reprieve. The old one-line model had
            wind only ever <em>reduce</em> cooling and so under-called these outright.</LI>
          <LI><strong className="text-blue-300">Black frost</strong> — a hard freeze in very dry air
            {" "}(<Code>dew ≤ −3 °C</Code>): too dry to deposit protective white hoar, so tissue desiccates. The literal
            &ldquo;Geada Negra&rdquo; of 1975.</LI>
        </ul>
        <P className="text-[11px] text-slate-500">
          Duration is tracked too — hours below 0 °C and below the −2 °C hard-freeze line — because a five-hour freeze
          scars far worse than a one-hour touch, and the old model scored them identically.
        </P>

        <H>From surface temperature to risk &amp; alert severity</H>
        <P>Surface temperature maps to the four-level grid code the 14-day panel renders:</P>
        <ul className="space-y-1">
          <LI><span className="text-blue-300 font-semibold">H</span> — <Code>T_surface &lt; 0 °C</Code> (or any
            advective / black frost, or a sustained ≥ 3 h sub-zero spell): damaging frost likely.</LI>
          <LI><span className="text-blue-400 font-semibold">M</span> — <Code>0–3 °C</Code>: frost possible in low-lying pockets.</LI>
          <LI><span className="text-slate-300 font-semibold">L</span> — <Code>3–6 °C</Code>: cold, watch the trend.</LI>
          <LI><span className="text-slate-500 font-semibold">—</span> — <Code>≥ 6 °C</Code>: no frost concern.</LI>
        </ul>
        <P>
          The alert engine grades the same night into a three-tier <strong>severity ladder</strong> — what the Frost
          Watch panel and the Telegram alert fire on:
        </P>
        <ul className="space-y-1">
          <LI><span className="text-red-400 font-semibold">critical</span> — the kind that scars next season: an
            advective or black frost, a deep radiative freeze (<Code>surface &lt; −2 °C</Code>), or a prolonged one
            {" "}(<Code>≥ 4 h</Code> of canopy ice).</LI>
          <LI><span className="text-orange-400 font-semibold">alert</span> — a real but shallow / brief radiative
            freeze (risk H) warranting protective action.</LI>
          <LI><span className="text-amber-300 font-semibold">watch</span> — marginal, the 0–3 °C band (risk M).</LI>
        </ul>

        <H>Validation — the 1975 / 1994 / 2021 blind ERA5 backtest</H>
        <P>
          The thresholds are checked against the three benchmark disasters by re-deriving the model from the
          {" "}<strong>raw ERA5 hourly archive</strong> (<Code>archive-api.open-meteo.com</Code>, reachable from GitHub
          Actions) — a genuine blind backtest, run by
          {" "}<Code>backend/scraper/backfill_frost_backtest.py --mode events</Code>. Two results anchor the calibration:
        </P>
        <ul className="space-y-1">
          <LI><strong>It fires on real cold and doesn&rsquo;t cry wolf.</strong> Every genuinely-cold ERA5 input is
            graded <em>critical</em> (Paraná 1975 black frost; São Paulo + Paraná 1994; Paraná 2021), and a parallel run
            over <strong>90 days of recent real forecast data returns zero false positives</strong> across the belt.</LI>
          <LI><strong>The one tuning.</strong> The backtest showed the 10 m wind term eroding the radiative drop too
            hard (near-misses all at 6–9 km/h), so the <Code>wind_kmh</Code> erosion was softened <Code>0.4 → 0.25</Code>.
            That flipped 2021 Paraná to <em>critical</em> and deepened every confirmed event, while the recent run stayed
            clean.</LI>
        </ul>
        <P className="text-[11px] text-slate-500">
          The remaining backtest misses are <strong>not</strong> threshold errors: ERA5&rsquo;s ~31 km grid reads
          several °C warmer than the station observation on these events (1975 Sul de Minas: ERA5 <Code>+10 °C</Code> air
          vs an observed <Code>−4 °C</Code>) — it smooths away the valley cold-pooling that drives real frost minima, so
          there is no freeze in the reanalysis at those points. Chasing them by loosening thresholds would over-fire on
          mild nights, so the ladder is left where the zero-false-positive line sits.
        </P>

        <H>Where we look</H>
        <P>
          Frost risk is point-sampled at the growing regions that actually freeze, not country-wide averages. In
          Brazil: <Code>Sul de Minas</Code>, <Code>Cerrado</Code>, <Code>Paraná</Code> (the southernmost and
          highest-risk belt) and <Code>Espírito Santo</Code> (Conilon/Robusta — included for completeness, rarely at
          frost risk). A secondary check runs only at Honduras&rsquo; high-altitude plots
          (<Code>Copán</Code>, <Code>Montecillos</Code>, &gt;1800 m), where frost is rare but possible. Each region shows
          a <strong>7-day worst-case badge</strong> (the most severe code in the coming week) plus a
          <strong> 14-day daily grid</strong> so an approaching cold front is visible days out.
        </P>

        <H>What was considered and deliberately left out</H>
        <ul className="space-y-1">
          <LI><strong>ENSO phase.</strong> El Niño/La Niña shift the frost window (the export carries context text like
            &ldquo;Paraná frost window +12 days&rdquo;), but the phase does <em>not</em> algorithmically move the
            temperature thresholds — it is decision context, not a model input, to keep the rule transparent.</LI>
          <LI><strong>Cold-air pooling / topography.</strong> Frost collects in valley bottoms that a single
            representative point cannot resolve. The &ldquo;M&rdquo; band (0–3 °C) is the practical hedge for this — it
            flags nights where sheltered low spots will freeze even if the point estimate does not.</LI>
          <LI><strong>Historical-recurrence probability.</strong> The 1975/1994/2021 events are background context and
            backtest anchors (see Validation), not terms in the formula. This is a <em>physical nowcast</em> of
            tonight&rsquo;s conditions, not a climatological frequency model.</LI>
        </ul>

        <H>Caveats</H>
        <ul className="space-y-1">
          <LI>It is a <strong>forecast-driven estimate</strong> and inherits the Open-Meteo forecast error; treat the
            outer days of the 14-day grid as indicative, not firm.</LI>
          <LI>Point sampling means the badge is a regional proxy — localized frost in unsampled micro-climates can occur
            without the badge lighting up.</LI>
          <LI>The rule runs year-round but is only materially informative in the austral winter (≈ May–August); in summer
            it will correctly read &ldquo;—&rdquo; every night.</LI>
        </ul>

        <H>Where it lives</H>
        <P>
          The physics is one shared, unit-tested module — <Code>backend/scraper/rules/frost_model.py</Code>
          {" "}(<Code>surface_temp</Code>, <Code>assess_night</Code>, <Code>severity</Code>). The weather scrapers
          {" "}(<Code>sources/farmer_economics.py</Code>, <Code>honduras_weather.py</Code>) feed it each night&rsquo;s
          hourly slice and publish the structured result into <Code>farmer_economics.json</Code>; the same module drives
          the per-region alert in <Code>scraper/agronomic_alerts.py</Code> and is validated by
          {" "}<Code>scraper/backfill_frost_backtest.py</Code>. On the front end it renders as the badges + 14-day grid in
          {" "}<Code>WeatherRiskPanel</Code> and the physics detail + historical anchor in <Code>FrostWatchPanel</Code>,
          on each origin&rsquo;s Farmer Economics tab.
        </P>
      </CollapsibleCard>
  );
}

// Newspaper-style article card — bold headline over a double rule, justified
// body. Used for the side-by-side contract-rule columns.
function Article({ kicker, title, dateline, tone, updated, defaultOpen = false, children }: {
  kicker?: string; title: string; dateline?: string; tone?: Tone; updated?: string;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <ResearchCard tone={tone} kicker={kicker ?? ""} title={title} subtitle={dateline} updated={updated}
      defaultOpen={defaultOpen}>
      <div className="text-xs text-slate-300 leading-relaxed text-justify space-y-2">
        {children}
      </div>
    </ResearchCard>
  );
}

function Spec({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p className="mb-1.5">
      <span className="font-semibold text-slate-200">{k}: </span>
      <span className="text-slate-300">{children}</span>
    </p>
  );
}


function PdfLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded bg-amber-900/40 border border-amber-700/50 text-amber-300 text-[11px] font-sans font-semibold hover:bg-amber-900/60 transition-colors">
      <span aria-hidden>📄</span> {children}
    </a>
  );
}

function ContractRules() {
  return (
    <div className="space-y-4">

      <Article tone="violet" updated="2026-07-22" kicker="Contract rules · ICE Futures U.S." title={'Coffee "C" Futures (Arabica · KC)'} dateline={'Chapter 8 · Coffee "C" Rules'}>
        <p className="mb-3">
          The Coffee &ldquo;C&rdquo; contract is the world benchmark for <strong>washed Arabica</strong>. The rulebook
          opens with a notice that ICE is <em>phasing it out</em>: a new Arabica contract was slated to list in fall 2025,
          no Coffee &ldquo;C&rdquo; futures are listed beyond the <strong>March 2028</strong> month, and only options on
          March-2028-and-earlier futures will continue.
        </p>
        <Spec k="Lot size">37,500 lb of washed Arabica (one growth).</Spec>
        <Spec k="Deliverable growths">Brazil, Colombia, Costa Rica, Guatemala, Honduras, Mexico, Peru, Uganda and ~12
          others; <strong>Vietnam added from the May 2027 month</strong>.</Spec>
        <Spec k="Grade standard">Sound, free of unwashed/aged cup flavours, good roasting quality; no more than
          <strong> 15 full imperfections</strong> below the growth basis (Colombian: max 10).</Spec>
        <Spec k="Delivery months">March, May, July, September, December; listed up to 60 months out.</Spec>
        <Spec k="Price / tick">Quoted in cents per pound; minimum fluctuation <strong>0.05¢/lb</strong> (= 5 points) — i.e.
          <strong> $18.75 per contract</strong>.</Spec>
        <Spec k="Price basis">A basket of basis growths (Mexico, Nicaragua, Panama, PNG, El Salvador, Tanzania, Peru,
          Honduras, Uganda from the Mar 2026 month) with Board-set differentials for all other growths.</Spec>
        <Spec k="Origin differentials">Board-set premia and discounts vs. the basis (<strong>1 point = 0.01¢/lb</strong>,
          i.e. 5 points = one 0.05¢ tick):
          <br />· <strong>At par</strong>: Mexico, El Salvador, Nicaragua, PNG, Panama, Tanzania, Uganda, Honduras, Peru
          <br />· <strong>Colombia, Costa Rica, Kenya</strong> <code>+1000 pts (+10.00¢/lb)</code>
          <br />· <strong>Guatemala</strong> <code>+500 pts (+5.00¢/lb)</code>
          <br />· <strong>Burundi, Rwanda, Venezuela, India</strong> <code>−100 pts (−1.00¢/lb)</code>
          <br />· <strong>Dominican Republic, Ecuador</strong> <code>−400 pts (−4.00¢/lb)</code>
          <br />· <strong>Brazil</strong> <code>−600 pts (−6.00¢/lb)</code> (natural-process cup profile)
          <br />· <strong>Vietnam</strong> <code>−600 pts (−6.00¢/lb)</code> — deliverable from the May 2027 expiry</Spec>
        <Spec k="Delivery point allowances">New York District and Virginia: <strong>at par</strong>.
          New Orleans, Miami, Houston: <strong>−0.50¢/lb</strong>.
          Antwerp, Hamburg/Bremen, Barcelona: <strong>−1.25¢/lb</strong>. Deducted from invoice at delivery.</Spec>
        <Spec k="Weight allowance (outturn)">Tolerance <strong>±2% of 37,500 lb</strong>. Deficiency ≤2%: delivery
          permitted; buyer pays only for actual weight. Deficiency &gt;2%: not permitted without mutual consent.
          Excess &gt;2%: buyer not obligated to accept or pay for the excess weight.</Spec>
        <Spec k="Age allowance">A <strong>120-day &ldquo;safe-harbour&rdquo;</strong> window from certification: for the
          first ~4 months a certified lot delivers <strong>at par</strong> with zero age penalty.
          <br />· From <strong>day 121</strong> a cumulative age discount activates: a rolling deduction stepping up by
          <strong> −0.25¢/lb per month</strong> is docked from the invoice for every month the lot keeps sitting.
          <br />· Contract math: on a 37,500 lb lot, 0.25¢/lb = <strong>$93.75 per contract per month</strong>; a
          lot bled down to a 1.00¢/lb penalty is <strong>−$375/contract</strong>.
          <br />ICE publishes a <strong>monthly Aging Report</strong> (certified stocks by port × age bucket) so traders
          can estimate aggregate deduction exposure across exchange stocks.</Spec>
        <Spec k="Delivery mechanism">Electronic warehouse receipts (EWRs) via <Code>eCOPS</Code>; Date of Delivery is
          7 business days after the Delivery Notice.</Spec>
        <Spec k="Key dates">Last Notice Day = 7th business day before the last business day of the delivery month;
          Last Trading Day = the business day before Last Notice Day.</Spec>
        <Spec k="Delivery points">Licensed warehouses in Port of New York District, New Orleans, Miami, Houston,
          Virginia, Antwerp, Hamburg/Bremen and Barcelona.</Spec>
        <Spec k="Packaging">Max 5 chops per lot; sisal/jute/burlap bags ≥700 g; ≤15 slack bags. Customs-status and EU
          deforestation (EUDR) appendices apply.</Spec>
        <Spec k="Storage / Rent">Accrues from certification date; deducted on invoice. Per 69 kg bag / month:
          <strong> New York ≈ $1.23–1.33</strong>, <strong>Antwerp ≈ $0.85–1.25</strong> (Molenbergnatie / Pacorini).
          <br /><strong>RCA (Rent Cost Adjustment)</strong> — ICE enforces a mandatory rent adjustment on settlement:
          <strong> 2 months</strong> for March / May / July deliveries, <strong>3 months</strong> for September /
          December deliveries.</Spec>
        <Spec k="Loading Out Charge (OCA)">One-time charge paid by the buyer to decertify and physically take the
          coffee out of the warehouse — <strong>New York ≈ $2.42–2.60 per 69 kg bag</strong>. If the original jute
          bags are damaged, <strong>rebagging</strong> adds a steep <strong>≈ $20–22 per bag</strong>.</Spec>
        <Spec k="Grading / Sampling fee">ICE charges <strong>$1.50 per bag</strong> (minimum $40 per EWR) for
          sampling and grading at certification — raised from $1.25/bag in Nov 2024. Appeal of a grade costs the same
          fee. Redelivery grading incurs a similar fee borne by the certifying party.</Spec>
        <Spec k="Weighing">Required at certification and redelivery. Fees set per licensed warehouse —
          <em> verify exact amounts in current ICE warehouse rate schedule.</em></Spec>
        <PdfLink href="https://www.ice.com/publicdocs/rulebooks/futures_us/8_Coffee.pdf">Full rulebook on ICE (PDF)</PdfLink>
      </Article>

      <Article tone="violet" updated="2026-07-22" kicker="Contract rules · ICE Futures Europe" title={"Robusta Coffee Futures (RC · Section GGGG)"} dateline="Section GGGG · Contract Rules">
        <p className="mb-2">
          The London Robusta contract — rulebook <strong>Section GGGG</strong> — is the global benchmark for
          <strong> Robusta</strong> (<em>Coffea canephora</em>). It is sized and priced per <strong>tonne</strong> and
          settles into European/UK/US warehouse delivery, with a tiered quality-class allowance schedule rather than a
          single deliverable grade.
        </p>
        <p className="mb-3 text-[10px] text-slate-400 bg-slate-800/60 rounded p-2 border border-slate-700/50">
          <strong className="text-slate-300">Tenderable parity</strong> — the break-even differential at which a trader
          is indifferent between selling FOB physical and tendering into the exchange — is:
          {" "}<code className="text-amber-300">FOB + Freight + Port transport (~$18/t) + Rent ($0) + Loading Out ($40/t) + Contract allowances</code>.
          If the physical FOB differential is <em>above</em> tenderable parity, traders sell commercial; below it, it pays
          to tender into the exchange. Certified stocks accumulate when FOB differentials compress toward or below parity.
          {" "}Our operating adders beyond FOB + freight total <strong>≈ $58/t</strong>: <strong>port transport ~$18/t</strong>
          {" "}(EU-average DTHC + DO from the Destination In-store cost research), <strong>rent $0</strong> (taken as
          financed by the chosen ICE-nominated warehouse), <strong>loading-out $40/t</strong>, and <strong>import duty $0</strong>
          {" "}(the EU MFN tariff on green robusta is nil). These are the values wired into the live tender-parity model.
        </p>
        <Spec k="Lot size">Nominal <strong>10 tonnes</strong> net, one Origin and shipment period, from no more than two
          parcels.</Spec>
        <Spec k="Origin">Any country freely available for export.</Spec>
        <Spec k="Quality class allowances (per 300 g sample)">
          <br />· <strong>Premium (Class 0)</strong> <code>+$30/t</code>: ≤0.2% FM, ≤0.5% defects, ≥90% over Screen 15, ≥96% over Screen 13
          <br />· <strong>Class 1</strong> <code>par</code>: ≤0.5% FM, ≤3.0% defects, ≥90% over Screen 14, ≥96% over Screen 12
          <br />· <strong>Class 2</strong> <code>−$30/t</code>: ≤1.0% FM, ≤5.0% defects, ≥90% over Screen 13, ≥96% over Screen 12
          <br />· <strong>Class 3</strong> <code>−$60/t</code>: ≤1.0% FM, ≤7.5% defects, ≥90% over Screen 13, ≥96% over Screen 12
          <br />· <strong>Class 4</strong> <code>−$90/t</code>: ≤1.0% FM, ≤8.0% defects, ≥90% over Screen 12
          <br /><em>Note: the $30/t step was chosen for simplification; Class 4 is arguably over-discounted vs. its
          net-sound-bean ratio (~91%) relative to Class 1 (~96.5%).</em></Spec>
        <Spec k="Not tenderable">&gt;8% defects, &lt;90% over Screen 12 round, &gt;1% foreign matter, foreign odour, or
          not sound Robusta.</Spec>
        <Spec k="Price / tick">Quoted in US$ per tonne; minimum fluctuation <strong>$1/tonne = $10 per lot</strong>.</Spec>
        <Spec k="Age allowance">Deducted monthly from invoice: <strong>−$5/tonne per calendar month</strong> for grading
          age 13–48 months; <strong>−$10/tonne per calendar month</strong> from 49 months onward. Coffee &gt;12 months
          old at grading date accumulates allowances immediately on warrant issue.</Spec>
        <Spec k="Weight allowance">Two components:
          <br /><strong>1. Outturn tolerance</strong> — ±3% of 10 tonnes. Deviation within band settles at EDSP on
          the invoice; deficiency &gt;3% is non-conforming.
          <br /><strong>2. Age-related moisture / weight loss</strong> — because robusta loses moisture as it sits,
          ICE compensates the buyer through the per-tonne <em>Age allowance</em> above (−$5/tonne/month at 13–48
          months&rsquo; grading age, −$10/tonne/month from 49 months), docked from the invoice by grading age rather
          than as a separate physical weight cut. Parallel <strong>Transition-Stock allowances</strong> step up toward
          −$10/tonne/month as the EU/UK (EUDR) deforestation-compliance rules phase in.</Spec>
        <Spec k="Packaging">Bags ≤80 kg gross; bulk in FIBCs of 900–1,100 kg.</Spec>
        <Spec k="Delivery areas">Amsterdam, Antwerp, Barcelona, Bremen, Felixstowe, Genoa-Savona, Hamburg, Le Havre,
          London (Tilbury), New Orleans, New York, Rotterdam, Trieste.</Spec>
        <Spec k="Customs status">EU delivery: Customs Warehouse retaining <strong>non-Union status</strong> (import duty
          deducted from invoice — see Import-Duty allowance). UK, New Orleans and New York lots must be cleared into free
          circulation at buyer&rsquo;s expense; no duty deduction applies.</Spec>
        <Spec k="Key dates">Last Trading Day = 4th business day before the last business day of the delivery month;
          First Notice Day = 4th business day before its first business day.</Spec>
        <Spec k="Storage / Rent allowance">Rent accrues from warrant issue date. The invoice includes a <strong>rent
          allowance adjustment</strong>: if the delivery warehouse charges above the global average ICE-nominated rate, a
          deduction is applied; if below, an addition is made. Net effect: all lots settle at the same effective rent
          regardless of warehouse location. Published warehouse rates run <strong>≈ €0.30–0.60/bag/month</strong>
          (≈ €5–10/tonne/month for ≤80 kg bags), but in our parity model <strong>rent is taken as $0</strong>: if we
          choose the delivery warehouse, it can finance the rent for us, so it does not add to the tender-in cost.</Spec>
        <Spec k="Loading Out Charge">One-time charge paid when collecting from the licensed terminal.
          Wired into the parity model at <strong>$40/tonne</strong> (our confirmed operating figure).</Spec>
        <Spec k="Import-Duty allowance">The EU MFN tariff on <strong>green</strong> robusta coffee (unroasted,
          non-decaffeinated — HS <Code>0901.11</Code>) is <strong>0%</strong>, so for EU Customs Warehouse lots the
          import-duty allowance is <strong>nil</strong> and it adds nothing to tender-in cost. (Duty applies only to
          roasted/decaffeinated coffee, which is not deliverable.)</Spec>
        <Spec k="Transition Stock allowance (EUDR)">For lots delivered without Validated DDI documentation — EU/UK
          delivery areas only: <strong>−$5/t/month</strong> for 2026 delivery months; <strong>−$10/t/month</strong> from
          January 2027 onwards. US delivery areas: no allowance — transition stock without DDI not accepted.</Spec>
        <Spec k="Grading / Sampling">Required at certification, and heavily optimised for scale via <strong>grouped
          lots</strong> (up to 50 tonnes of the same origin, vessel and bill of lading):
          <br />· <strong>Single lot (10 t)</strong>: ≈ <strong>£72.50/lot</strong> (£7.25/tonne)
          <br />· <strong>Grouped lot (50 t)</strong>: ≈ <strong>£87.50 total</strong> (£1.75/tonne)
          <br />So grouping cuts the per-tonne grading cost roughly <strong>4×</strong>. (Contrast Arabica: $1.50/bag,
          min $40 per EWR.)</Spec>
        <Spec k="Invoicing">EDSP × Net Outturn Weight, adjusted by: Quality Class allowance ± Age allowance ± Weight
          deviation ± Rent allowance − Import-Duty allowance (EU/UK) − Transition-Stock allowance (if applicable).</Spec>
        <PdfLink href="https://www.ice.com/publicdocs/contractregs/105_SECTION_GGGG.pdf">Full rulebook on ICE (PDF)</PdfLink>
      </Article>

    </div>
  );
}

function FertilizerMethodology() {
  return (
    <CollapsibleCard tone="teal" updated="2026-07-14" kicker="Fertilizer · input cost" title="Fertilizer — why it's a coffee signal" subtitle="The largest cash input: short-term cost-push, medium-term yield lever">
      <H>Why fertilizer is a coffee signal</H>
      <P>
        Fertilizer is the largest cash input on a coffee farm and the one that swings most violently with the global
        energy and macro cycle. It matters on two clocks. <strong>Short term</strong> it is a cost-push lever: when urea
        or potash spike, the farm-gate break-even rises and marginal growers come under margin pressure.{" "}
        <strong>Medium term</strong> it is a yield lever &mdash; when fertilizer turns expensive relative to the coffee
        price, growers cut application rates, and coffee, a perennial, pays that back as weaker bean fill and lighter
        crops one to two seasons <em>later</em>. The fertilizer page is therefore a leading read on future supply, not
        just a current cost line.
      </P>

      <H>The three nutrients we track</H>
      <ul className="space-y-1">
        <LI><strong>Nitrogen &mdash; Urea (N).</strong> Drives vegetative growth and is the single biggest nutrient
          demand for coffee; its price is tied to natural gas, so it moves with the energy complex.</LI>
        <LI><strong>Phosphate &mdash; MAP/DAP (P).</strong> Root and cherry development; priced off ammonia, sulphur and
          phosphate rock.</LI>
        <LI><strong>Potassium &mdash; KCl / potash (K).</strong> Coffee is a notably heavy potassium feeder &mdash; K
          governs bean filling in the cherry-development window. Potash supply is concentrated in a handful of producers
          (Canada, Russia, Belarus), so it carries supply-shock and sanction risk.</LI>
      </ul>

      <H>Data sources</H>
      <ul className="space-y-1">
        <LI><strong>Benchmark prices</strong> &mdash; the World Bank <em>Commodity Markets &ldquo;Pink Sheet&rdquo;</em>{" "}
          monthly series for Urea, DAP and KCl (<Code>urea_monthly</Code>, <Code>dap_monthly</Code>,{" "}
          <Code>kcl_monthly</Code> plus full history). The source Excel&rsquo;s document ID rotates on every update, so
          the scraper discovers the current URL dynamically rather than hard-coding it.</LI>
        <LI><strong>Import volumes &amp; origins</strong> &mdash; Comex-Stat (Brazil) and Vietnam customs data for monthly
          fertilizer imports and the country-of-origin mix, surfacing import dependence and origin concentration.</LI>
        <LI><strong>Application calendar</strong> &mdash; the agronomic window that flags when the next major fertilizer
          pass falls in the crop cycle, so a price spike can be read against whether buying is imminent or months off.</LI>
      </ul>

      <H>How it transmits to the crop</H>
      <P>
        Brazil and Vietnam &mdash; the two largest origins &mdash; import the large majority of their fertilizer, so the
        delivered cost is the World Bank benchmark <em>plus</em> ocean freight <em>plus</em> the local-currency move
        (BRL, VND). The farm-gate input cost is thus a three-way function of nutrient price, freight and FX &mdash; which
        is why a flat dollar urea price can still squeeze a Brazilian grower if the real weakens.
      </P>
      <P>
        The reference shock is <strong>2021&ndash;22</strong>: natural-gas prices drove urea up while the Russia/Belarus
        disruption tightened potash, lifting all three nutrients to multi-year highs. Growers responded by trimming
        application &mdash; the kind of move that surfaces in yields with a lag, which is why the panel pairs current
        prices with the longer history.
      </P>

      <H>Where it shows up in the app</H>
      <ul className="space-y-1">
        <LI><strong>Macro tab</strong> &mdash; the fertilizer-inputs panel plots the World Bank price history for the
          three nutrients.</LI>
        <LI><strong>Supply &rarr; Farmer Economics</strong> &mdash; current nutrient prices, the Brazil/Vietnam import
          mix and the application calendar, feeding the production-cost / break-even view.</LI>
      </ul>

      <H>Caveats</H>
      <ul className="space-y-1">
        <LI>The Pink Sheet is a <strong>global benchmark</strong>, not a farm-gate price: real delivered cost adds
          freight, FX, blending and retail margin, and varies by region.</LI>
        <LI>The price&rarr;yield link is <strong>real but lagged and noisy</strong> &mdash; weather usually dominates any
          single season, so read fertilizer as slow background pressure, not a timing signal.</LI>
        <LI>Benchmark prices are <strong>monthly</strong> and import data lags by weeks; treat the read as a trend, not a
          daily mark.</LI>
      </ul>
    </CollapsibleCard>
  );
}

function CostRow({ label, cost, note }: { label: string; cost: string; note?: string }) {
  return (
    <tr className="border-b border-slate-800">
      <td className="py-1.5 pr-4 text-slate-300">{label}</td>
      <td className="py-1.5 pr-4 text-right font-mono text-amber-300 whitespace-nowrap">{cost}</td>
      <td className="py-1.5 text-slate-500 text-[11px]">{note}</td>
    </tr>
  );
}

function CostTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full text-xs mt-3 mb-4">
      <thead>
        <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
          <th className="pb-1.5 pr-4">Component</th>
          <th className="pb-1.5 pr-4 text-right">USD/MT</th>
          <th className="pb-1.5">Notes</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

// Latest USD/MT per physical ticker, parsed out of the same latest_prices.json
// the market ticker reads. The FOBbing stacks below are fixed + ad-valorem, so
// feeding them today's price is what makes the published figure move day to day
// instead of standing at a frozen reference.
function useOriginSpotUsd(): Record<string, number> {
  const [spot, setSpot] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    cachedFetchStatic<{ tickers?: { label: string; value: string }[] }>("/data/latest_prices.json")
      .then(d => {
        if (!alive) return;
        const out: Record<string, number> = {};
        for (const t of d?.tickers ?? []) {
          const m = t.value?.match(/\$([0-9,]+)/);
          if (m) out[t.label] = parseInt(m[1].replace(/,/g, ""), 10);
        }
        setSpot(out);
      })
      .catch(() => { /* falls back to each model's reference price */ });
    return () => { alive = false; };
  }, []);
  return spot;
}

// "$62.50/t + 5.5% of cargo value — on today's $3,401/t" — the line that makes
// clear the headline above it is a live number, not a stored constant.
function FobFormula({ label, spot }: { label: string; spot?: number }) {
  const m = FOBBING_MODEL[label];
  if (!m) return null;
  return (
    <p className="text-[11px] text-slate-500 mb-2 -mt-1">
      <span className="font-mono text-slate-400">${m.fixedUsdMt}/t + {m.advaloremPct}%</span> of cargo value
      {spot
        ? <> — priced on today&apos;s <span className="font-mono text-slate-400">${spot.toLocaleString()}/t</span></>
        : <> — at the ${m.referenceUsdMt.toLocaleString()}/t reference</>}
    </p>
  );
}

function OriginLogistics() {
  const spot = useOriginSpotUsd();
  const fobNow = (label: string) => Math.round(fobbingUsdMt(label, spot[label]));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <H>What is a FOBbing cost?</H>
        <P>
          The physical prices on the ticker — VN FAQ, CON T7, UGA S15 — are quoted at the <strong>origin
          warehouse</strong> or farmgate level, not at a ship&#39;s rail. The ICE Robusta contract (RC) settles at
          European port warehouses. To make origin prices comparable with RC futures, you add the <strong>FOBbing
          cost</strong>: the full chain of expenses that moves coffee from farm to vessel, ready for loading.
        </P>
        <P>
          The ticker differential already incorporates this:
        </P>
        <div className="font-mono text-xs bg-slate-800 rounded px-3 py-2 text-amber-300 mb-2">
          N±diff = physical_USD + FOBbing_cost − RC_nearby
        </div>
        <P>
          A negative N-diff means origin-adjusted coffee is <em>cheaper</em> than futures parity — origin is offering
          a discount. A positive N-diff means origin is commanding a premium.
        </P>
      </div>

      {/* Vietnam */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Vietnam · Dak Lak / Central Highlands</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          VN FAQ Robusta — FOBbing cost ~${fobNow("VN FAQ")}/t
        </h3>
        <FobFormula label="VN FAQ" spot={spot["VN FAQ"]} />
        <P>
          Vietnam runs the tightest logistics chain of the three origins. The port of Cat Lai (Ho Chi Minh City) is
          efficient, and the domestic trucking corridor from Dak Lak is well-established. The single largest line is
          the L1 inland collection, which aggregates smallholder coffee from cooperative warehouses spread across the
          plateau.
        </P>
        <CostTable>
          <CostRow label="L1 — Inland collection" cost="25.00" note="Farm → Dak Lak co-op warehouse; covers aggregation + local haulage" />
          <CostRow label="L2 — Trucking to port" cost="6.54" note="Dak Lak → Ho Chi Minh City / Cat Lai (~290 km)" />
          <CostRow label="Cargo insurance" cost="0.61" note="In-transit policy" />
          <CostRow label="LoLo (port handling)" cost="2.43" note="Load on / Load off at berth" />
          <CostRow label="Dunnage & securing" cost="0.71" note="Container stuffing materials" />
          <CostRow label="Fumigation" cost="1.25" note="MAE-mandated phytosanitary fumigation" />
          <CostRow label="Quality inspection" cost="1.23" note="Weight + quality certificate" />
          <CostRow label="Forwarder service fee" cost="0.50" note="Freight-forwarding agent" />
          <CostRow label="Customs declaration" cost="0.38" note="Customs brokerage" />
          <CostRow label="Bill of Lading" cost="0.18" note="Shipping document issuance" />
          <CostRow label="Phytosanitary certificate" cost="0.07" note="MAE phytosanitary cert" />
          <CostRow label="THC (terminal handling)" cost="5.87" note="Cat Lai terminal handling charge" />
          <CostRow label="Port infrastructure fee" cost="0.48" note="Vietnam port authority" />
          <CostRow label="Container seal" cost="0.38" note="Security seal" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Fixed subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["VN FAQ"].fixedUsdMt}</td>
            <td className="pt-2 text-slate-500 text-[11px]">the lines above, incl. ~$9 unallocated</td>
          </tr>
          <CostRow label="Financing" cost="0.37%" note="Cargo value × ~3-week float" />
          <CostRow label="Exporter margin" cost="0.92%" note="~1% of FOB; the competitive floor for origin traders" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Ad-valorem subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["VN FAQ"].advaloremPct}%</td>
            <td className="pt-2 text-slate-500 text-[11px]">scales with the cargo&rsquo;s value</td>
          </tr>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~{fobNow("VN FAQ")}</td>
            <td className="pt-2 text-slate-500 text-[11px]">
              at today&rsquo;s price · ${Math.round(fobbingUsdMt("VN FAQ", 2500))} at $2,500 ·
              {" "}${Math.round(fobbingUsdMt("VN FAQ", 5000))} at $5,000
            </td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> Vietnam&#39;s FOBbing cost is the most stable of the three — no quality
          transformation required, and the trucking corridor is well-supplied. The exporter margin (~1% of FOB) is the
          largest variable line: it compresses when origin is long and exporters compete, and firms when supply is tight.
        </P>
      </div>

      {/* Brazil */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Brazil · Espírito Santo / Rondônia</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          CON T7 Conilon — FOBbing cost ~${fobNow("CON T7")}/t
        </h3>
        <FobFormula label="CON T7" spot={spot["CON T7"]} />
        <P>
          Brazil&#39;s larger figure reflects a structural cost that Vietnam doesn&#39;t face: <strong>quality
          preparation</strong>. Raw Conilon from the farm often arrives at the dry mill at Screen 13–14 with a
          natural cup. To tender into the ICE RC contract at Class 1 or better — or to sell into European roaster
          specifications — the coffee needs mechanical sorting, hulling, and polishing, <em>and it loses weight</em>:
          screening defects and small beans out is an outturn loss, which is the larger half of what the upgrade
          really costs.
        </P>
        <P>
          That makes this stack the one origin where the two kinds of cost line have to be separated. Haulage,
          inspection and terminal handling are a <strong>fixed</strong> number of dollars per tonne. Quality
          preparation, financing and exporter margin are <strong>percentages of the cargo&rsquo;s value</strong> —
          and the conilon-basis research measures the quality component directly: lifting tipo 7/8 (what the
          <Code> CON T7</Code> quote represents) to a tipo 6 · screen-13+ export spec is worth
          <strong> ~4.3% of the price</strong> — $135/t on average since 2022 and ~$176/t today, against the
          $55–65 flat this stack used to book.
        </P>
        <CostTable>
          <CostRow label="L1 — Farm to dry mill" cost="10–15" note="Smallholder aggregation; distance varies across ES/RO" />
          <CostRow label="L2 — Mill to port (Santos/Vitória)" cost="20–25" note="Road haulage; measured interior-vs-port basis ≈ $32/t" />
          <CostRow label="MAPA inspection & fumigation" cost="8–12" note="Brazilian agriculture ministry mandatory checks" />
          <CostRow label="THC + port docs + B/L" cost="17–18" note="Terminal handling, export documentation, bill of lading" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Fixed subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["CON T7"].fixedUsdMt}</td>
            <td className="pt-2 text-slate-500 text-[11px]">does not scale with the coffee price</td>
          </tr>
          <CostRow label="Quality preparation + outturn loss" cost="4.33%" note="Grade uplift to Class 1+ / screen 13+ — the measured ladder itself" />
          <CostRow label="Financing" cost="0.5%" note="Cargo value × ~3-week float" />
          <CostRow label="Exporter margin" cost="1.0%" note="The competitive floor for origin traders" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Ad-valorem subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["CON T7"].advaloremPct}%</td>
            <td className="pt-2 text-slate-500 text-[11px]">scales with the cargo&rsquo;s value</td>
          </tr>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">
              ~{Math.round(fobbingUsdMt("CON T7", 3400))}
            </td>
            <td className="pt-2 text-slate-500 text-[11px]">
              at today&rsquo;s price · ${Math.round(fobbingUsdMt("CON T7", 2000))} at $2,000 ·
              {" "}${Math.round(fobbingUsdMt("CON T7", 4500))} at $4,500
            </td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> The quality component is the decisive variable, and it is the one that moves
          with the market. When Brazilian Conilon is already clean (cooperative members with processing equipment),
          the real cost sits below the 4.33% booked here; when it arrives as naturals from smallholders, the outturn
          loss pushes it above. The previous version of this stack booked a flat $200 — which was worth 12.3% of the
          coffee in 2022 and 3.5% at the 2025 highs. The split above holds the ratio steady instead, and every
          consumer of the number (ticker N-diff, tender parity, origin cost bands) now re-rates with the price.
        </P>
      </div>

      {/* Uganda */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Uganda · Western / Central Region</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          UGA S15 Robusta — FOBbing cost ~${fobNow("UGA S15")}/t
        </h3>
        <FobFormula label="UGA S15" spot={spot["UGA S15"]} />
        <P>
          Uganda&#39;s logistics cost is dominated by one line: the <strong>Northern Corridor</strong>. As a
          landlocked country, all export coffee must travel 1,150 km by road to the port of Mombasa, Kenya. That
          transit adds a cost and a time premium that no policy change can eliminate short of a rail upgrade. On top
          of the transit, UCDA imposes a 1% export cess (the Uganda Coffee Development Authority levy), and
          sun-drying shrinkage is a material physical cost that doesn&#39;t appear in freight quotes.
        </P>
        <CostTable>
          <CostRow label="L1 — Farm to Kampala mill" cost="15–20" note="Collection from Western / Mt. Elgon growing areas" />
          <CostRow label="L2 — Northern Corridor (Kampala → Mombasa)" cost="75–80" note="1,150 km road transit; rate set by EA road-freight market" />
          <CostRow label="Mombasa port (THC + handling + B/L)" cost="35" note="Kenya Ports Authority terminal + shipping docs" />
          <CostRow label="Inspection + fumigation" cost="10–12" note="UCDA quality grading + container fumigation" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Fixed subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["UGA S15"].fixedUsdMt}</td>
            <td className="pt-2 text-slate-500 text-[11px]">does not scale with the coffee price</td>
          </tr>
          <CostRow label="Shrinkage (drying weight loss)" cost="1.01%" note="Sun-drying 12.5% → ~10% moisture; lost weight costs a share of value" />
          <CostRow label="UCDA export cess" cost="0.81%" note="1% of FOB, levied on the export declaration" />
          <CostRow label="Financing (longer transit)" cost="0.49%" note="Cargo value × ~4-week float (longer than VN/Brazil)" />
          <CostRow label="Exporter margin" cost="1.00%" note="~1% of FOB value" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Ad-valorem subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["UGA S15"].advaloremPct}%</td>
            <td className="pt-2 text-slate-500 text-[11px]">scales with the cargo&rsquo;s value</td>
          </tr>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~{fobNow("UGA S15")}</td>
            <td className="pt-2 text-slate-500 text-[11px]">
              at today&rsquo;s price · ${Math.round(fobbingUsdMt("UGA S15", 3000))} at $3,000 ·
              {" "}${Math.round(fobbingUsdMt("UGA S15", 5000))} at $5,000
            </td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> The Northern Corridor rate is the most volatile element across the three
          origins. East African road-freight tightens during harvest season (Oct–Jan), when trucks are competing with
          tea, grain and maize exports from Kenya and Tanzania. A $10–15/t swing in the corridor rate shows up
          directly in Uganda&#39;s effective FOB cost within weeks. UCDA cess is the other watch item: it scales
          with price, so every $300/t rally in RC adds ~$3/t to the cess line.
        </P>
      </div>

      {/* Guatemala */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Guatemala · Huehuetenango / Antigua / Atitlán</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          GT SHB Washed Arabica — FOBbing cost ~${fobNow("GT SHB")}/t
        </h3>
        <FobFormula label="GT SHB" spot={spot["GT SHB"]} />
        <P>
          Guatemala is the first <strong>Arabica</strong> origin in this table, so its cost stack is benched against
          ICE New York (KC), not London. Guatemalan SHB (Strictly Hard Bean, grown above ~1,350 m) is fully washed,
          which front-loads the cost into <strong>milling</strong>: parchment is dry-milled, hulled, density- and
          screen-graded, and hand/electronically sorted to export grade. ANACAFE publishes the daily
          <Code>Precio de referencia</Code> for café oro per quality (Prima lavado / Duro / Estrictamente duro) that
          feeds the GT SHB ticker. Export runs through the Pacific (Puerto Quetzal) or, for Atlantic-routed lots,
          Santo Tomás de Castilla.
        </P>
        <CostTable>
          <CostRow label="Dry milling & export prep" cost="85–95" note="Hulling, density + screen grading, colour/defect sorting to SHB spec" />
          <CostRow label="L1 — Farm → wet mill (beneficio)" cost="20–25" note="Smallholder/cooperative aggregation in the highlands" />
          <CostRow label="L2 — Mill → port" cost="28–32" note="Highlands → Puerto Quetzal / Santo Tomás de Castilla" />
          <CostRow label="THC + port docs + B/L" cost="28–30" note="Terminal handling, export documentation, bill of lading" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Fixed subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["GT SHB"].fixedUsdMt}</td>
            <td className="pt-2 text-slate-500 text-[11px]">the lines above, incl. ~$5 unallocated</td>
          </tr>
          <CostRow label="ANACAFE cess + Decreto 19-69" cost="0.42%" note="Export contribution levies on green coffee" />
          <CostRow label="Financing" cost="0.31%" note="Cargo value × ~3-week float" />
          <CostRow label="Exporter margin" cost="1.02%" note="~1% of FOB value" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Ad-valorem subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["GT SHB"].advaloremPct}%</td>
            <td className="pt-2 text-slate-500 text-[11px]">scales with the cargo&rsquo;s value</td>
          </tr>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~{fobNow("GT SHB")}</td>
            <td className="pt-2 text-slate-500 text-[11px]">
              at today&rsquo;s price · ${Math.round(fobbingUsdMt("GT SHB", 4000))} at $4,000 ·
              {" "}${Math.round(fobbingUsdMt("GT SHB", 8000))} at $8,000
            </td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> Milling and exporter margin are the swing lines — washed-Arabica prep cost is
          quality-elastic (cleaner parchment mills cheaper). Because the ANACAFE reference is itself derived from the
          NY &apos;C&apos; close, the GT SHB ticker N-diff hovers near the negative of ANACAFE&#39;s built-in deduction; a move
          toward zero signals the physical bidding up toward C parity (tight prompt highland supply or a quality bid).
        </P>
      </div>

      {/* Honduras */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Honduras · Marcala / Copán / Montecillos</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          HN HG Washed Arabica — FOBbing cost ~${fobNow("HN HG")}/t
        </h3>
        <FobFormula label="HN HG" spot={spot["HN HG"]} />
        <P>
          Honduras is the largest Central American producer and, like Guatemala, an <strong>Arabica</strong> origin
          benched against NY (KC). HG (High Grown, ~1,000–1,200 m) washed coffee carries a slightly lower milling and
          margin load than Guatemalan SHB, and the country&#39;s Atlantic port (Puerto Cortés) is close to the main
          growing belts (Marcala, Copán, Comayagua), keeping inland freight moderate. IHCAFE publishes the reference
          <Code>precio</Code>, though its site is less machine-readable than ANACAFE&#39;s.
        </P>
        <CostTable>
          <CostRow label="Dry milling & export prep" cost="70–80" note="Hulling, grading and sorting to HG export spec" />
          <CostRow label="L1 — Farm → wet mill" cost="18–22" note="Smallholder collection (Marcala / Copán / Montecillos)" />
          <CostRow label="L2 — Mill → Puerto Cortés" cost="28–32" note="Shorter haul than GT — port sits near the growing belt" />
          <CostRow label="THC + port docs + B/L" cost="26–28" note="Terminal handling, export documentation, bill of lading" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Fixed subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["HN HG"].fixedUsdMt}</td>
            <td className="pt-2 text-slate-500 text-[11px]">does not scale with the coffee price</td>
          </tr>
          <CostRow label="IHCAFE levies" cost="0.43%" note="IHCAFE export contribution + cess" />
          <CostRow label="Financing" cost="0.31%" note="Cargo value × ~3-week float" />
          <CostRow label="Exporter margin" cost="0.95%" note="~1% of FOB value" />
          <tr className="border-t border-slate-700/70 font-semibold">
            <td className="pt-2 text-slate-300">Ad-valorem subtotal</td>
            <td className="pt-2 text-right font-mono text-slate-200">{FOBBING_MODEL["HN HG"].advaloremPct}%</td>
            <td className="pt-2 text-slate-500 text-[11px]">scales with the cargo&rsquo;s value</td>
          </tr>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~{fobNow("HN HG")}</td>
            <td className="pt-2 text-slate-500 text-[11px]">
              at today&rsquo;s price · ${Math.round(fobbingUsdMt("HN HG", 4000))} at $4,000 ·
              {" "}${Math.round(fobbingUsdMt("HN HG", 8000))} at $8,000
            </td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> Honduras competes on price-for-cup and shorter logistics, so its effective FOB
          floor sits a touch below Guatemala&#39;s. The variable to watch is the milling/prep line during a wet harvest
          (drying delays raise defect rates and re-sorting cost), and the IHCAFE levy, which scales with the reference
          price.
        </P>
      </div>

      {/* Summary comparison */}
      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <H>Cross-origin comparison</H>
        <table className="w-full text-xs mt-2">
          <thead>
            <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-1.5 pr-4">Origin</th>
              <th className="pb-1.5 pr-4 text-right">Fixed</th>
              <th className="pb-1.5 pr-4 text-right">+ ad valorem</th>
              <th className="pb-1.5 pr-4 text-right">Today</th>
              <th className="pb-1.5 pr-4 text-right">% of price</th>
              <th className="pb-1.5">Key swing factor</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-800">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">VN FAQ</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">${FOBBING_MODEL["VN FAQ"].fixedUsdMt}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">{FOBBING_MODEL["VN FAQ"].advaloremPct}%</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">${fobNow("VN FAQ")}/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">
                {spot["VN FAQ"] ? `${(fobNow("VN FAQ") / spot["VN FAQ"] * 100).toFixed(1)}%` : "—"}
              </td>
              <td className="py-1.5 text-slate-400">Exporter margin compression vs. trucking (stable)</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">CON T7</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">${FOBBING_MODEL["CON T7"].fixedUsdMt}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">{FOBBING_MODEL["CON T7"].advaloremPct}%</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">${fobNow("CON T7")}/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">
                {spot["CON T7"] ? `${(fobNow("CON T7") / spot["CON T7"] * 100).toFixed(1)}%` : "—"}
              </td>
              <td className="py-1.5 text-slate-400">Quality prep + outturn loss (varies by lot cleanliness)</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">UGA S15</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">${FOBBING_MODEL["UGA S15"].fixedUsdMt}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">{FOBBING_MODEL["UGA S15"].advaloremPct}%</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">${fobNow("UGA S15")}/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">
                {spot["UGA S15"] ? `${(fobNow("UGA S15") / spot["UGA S15"] * 100).toFixed(1)}%` : "—"}
              </td>
              <td className="py-1.5 text-slate-400">Northern Corridor freight rate (most volatile)</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">GT SHB <span className="text-[9px] text-amber-500/70">vs NY</span></td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">${FOBBING_MODEL["GT SHB"].fixedUsdMt}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">{FOBBING_MODEL["GT SHB"].advaloremPct}%</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">${fobNow("GT SHB")}/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">
                {spot["GT SHB"] ? `${(fobNow("GT SHB") / spot["GT SHB"] * 100).toFixed(1)}%` : "—"}
              </td>
              <td className="py-1.5 text-slate-400">Washed-Arabica milling/prep + exporter margin</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">HN HG <span className="text-[9px] text-amber-500/70">vs NY</span></td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">${FOBBING_MODEL["HN HG"].fixedUsdMt}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-slate-300">{FOBBING_MODEL["HN HG"].advaloremPct}%</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">${fobNow("HN HG")}/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">
                {spot["HN HG"] ? `${(fobNow("HN HG") / spot["HN HG"] * 100).toFixed(1)}%` : "—"}
              </td>
              <td className="py-1.5 text-slate-400">Milling during wet harvest + IHCAFE levy</td>
            </tr>
          </tbody>
        </table>
        <P>
          Each stack is <strong>a fixed dollar block plus a percentage of the cargo&rsquo;s value</strong>, so the
          &ldquo;Today&rdquo; column is recomputed from the latest physical print on every page load rather than
          sitting at a stored constant. Haulage, inspection and terminal handling do not care what coffee is worth;
          quality preparation, weight loss, cess, financing and exporter margin all do — and pinning those to one
          historical reference price was making every stack drift as the market moved.
        </P>
        <P>
          These figures are structural: they set the <em>floor</em> of what origin must offer relative to RC futures
          for an export trade to work. When the ticker N-diff is <strong>close to zero</strong>, origin is priced at
          futures parity and export is marginally viable. When it is <strong>deeply negative</strong> (e.g. N-200),
          origin is offering a substantial discount — either oversupply at origin, logistics disruption, or currency
          effects. When it is <strong>positive</strong>, origin is at a premium to futures, which typically signals
          tight prompt supply or a quality bid.
        </P>
      </div>

    </div>
  );
}

// Destination-side cost table. Like CostTable but the cost column carries its
// own unit (€/t, $/t, % of value) so heterogeneous lines read faithfully.
function DestCostTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full text-xs mt-3 mb-4">
      <thead>
        <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
          <th className="pb-1.5 pr-4">Component</th>
          <th className="pb-1.5 pr-4 text-right">Cost</th>
          <th className="pb-1.5">Basis / notes</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function DestTotal({ label, cost, note }: { label: string; cost: string; note?: string }) {
  return (
    <tr className="border-t border-slate-600 font-semibold">
      <td className="pt-2 text-slate-200">{label}</td>
      <td className="pt-2 text-right font-mono text-amber-300 whitespace-nowrap">{cost}</td>
      <td className="pt-2 text-slate-500 text-[11px]">{note}</td>
    </tr>
  );
}

// Warehouse sub-heading inside a multi-warehouse port card.
function WhHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90 mt-3 mb-0.5">{children}</div>
  );
}

function PortCard({ region, title, children, span }: {
  region: string; title: string; children: React.ReactNode; span?: boolean;
}) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-xl p-5 ${span ? "lg:col-span-2" : ""}`}>
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">{region}</div>
      <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Destination in-store cost model ────────────────────────────────────────
// Handling costs are stored in their quoted (native) currency — EUR/t for the
// European ports, USD/t for Melbourne — and converted to USD at the live
// EUR/USD rate. The value-based lines (weight-loss, in-store insurance) and the
// cost of money (financing) are computed off today's Vietnam FAQ price in USD,
// so the whole tab re-prices every day as the FAQ print and EUR/USD move.
const CONTAINER_MT = 21.6;
const DELIVERY_MONTH_DAYS = 30;   // financing must cover the full delivery month
const PRE_DELIVERY_DAYS = 15;     // goods in store 2 weeks before the delivery month
const IN_STORE_DAYS = DELIVERY_MONTH_DAYS + PRE_DELIVERY_DAYS;   // 45d held in store

const UNIT_DAYS  = { week: 7, fortnight: 15, month: 30 } as const;
const UNIT_ABBR  = { week: "wk", fortnight: "15d", month: "mo" } as const;
type StorageUnit = keyof typeof UNIT_DAYS;

interface DestLine { label: string; v: number; note?: string }   // native currency / t
interface DestWarehouse {
  name?: string;
  lines: DestLine[];                                   // warehouse-specific handling (native /t)
  storage?: { rate: number; unit: StorageUnit };       // carry, native /t per unit
}
interface DestPort {
  key: string;
  region: string;
  port: string;
  warehouseLabel?: string;          // suffix for single-warehouse ports
  currency: "EUR" | "USD";
  blurb: string;
  portLines: DestLine[];            // shared handling, e.g. port-level DTHC/DO (native /t)
  warehouses: DestWarehouse[];
  weightLossPct: number;            // one-off, % of goods value
  insurancePctPerWeek?: number;     // % of goods value per week in store
  defaultTransitDays: number;       // Vietnam → port (editable)
  // Ocean freight (VN → port) is derived from the Freight tab's FBX11
  // North-Europe base × this multiplier — same FBX-multiplier method the
  // freight section uses for its estimated corridors. Marked proxy where the
  // lane deviates from the FBX11 basket (Mediterranean, Oceania).
  freightMult: number;
  freightProxy?: boolean;
}

// Indicative warehouse quotes. Per-container lines are pre-divided by 21.6 mt.
const DEST_PORTS: DestPort[] = [
  {
    key: "bremen", region: "North Europe · Germany", port: "Bremen", warehouseLabel: "Vollers",
    currency: "EUR", weightLossPct: 0.50, defaultTransitDays: 42, freightMult: 1.02,
    blurb: "Bremen tips the box to silo in bulk and delivers ex-silo FCA Bremen, so the chain carries two handling legs plus OTA sampling and a reweighing.",
    portLines: [],
    warehouses: [{
      lines: [
        { label: "DTHC + DO", v: 17.22, note: "€372/container ÷ 21.6 mt" },
        { label: "Haulage", v: 10.87, note: "€235/container ÷ 21.6 mt" },
        { label: "Import bulk (docs & free to silo)", v: 18.25, note: "unstuff + tip to silo" },
        { label: "OTA sampling", v: 6.71, note: "€145/container ÷ 21.6 mt" },
        { label: "Delivery ex silo (bulk FCA Bremen)", v: 14.05, note: "call-off / load-out" },
        { label: "Reweighing", v: 6.05, note: "weight certificate" },
      ],
      storage: { rate: 6, unit: "month" },
    }],
  },
  {
    key: "lehavre", region: "North Europe · France", port: "Le Havre", warehouseLabel: "Sealogis",
    currency: "EUR", weightLossPct: 0.10, insurancePctPerWeek: 0.03, defaultTransitDays: 38, freightMult: 1.00,
    blurb: "Le Havre bundles the inland move, weighing and bulk handling into one CIF-to-in-store line on top of DTHC/DO; storage and an in-store insurance accrue weekly.",
    portLines: [],
    warehouses: [{
      lines: [
        { label: "DTHC + DO", v: 16.43, note: "€355/container ÷ 21.6 mt" },
        { label: "CIF to in-store (haulage, weighing, bulk)", v: 32.97, note: "bundled in-store handling" },
      ],
      storage: { rate: 2.8, unit: "week" },
    }],
  },
  {
    key: "barcelona", region: "South Europe · Spain", port: "Barcelona", warehouseLabel: "Molenberg",
    currency: "EUR", weightLossPct: 0.50, defaultTransitDays: 45, freightMult: 1.08, freightProxy: true,
    blurb: "Barcelona is the leanest European stack — DTHC/DO plus a single combined haulage-and-weight line. No storage quoted.",
    portLines: [],
    warehouses: [{
      lines: [
        { label: "DTHC + DO", v: 18.56, note: "€401/container ÷ 21.6 mt" },
        { label: "Haulage + weight", v: 10.19, note: "€220/container ÷ 21.6 mt" },
      ],
    }],
  },
  {
    key: "genoa", region: "South Europe · Italy", port: "Genoa",
    currency: "EUR", weightLossPct: 0.10, defaultTransitDays: 53, freightMult: 1.10, freightProxy: true,
    blurb: "Genoa shares a port-level DTHC/DO and a 0.10% re-bagging weight-loss, then splits across the Romani and Pacorini warehouses — each bundling haulage, weighing and bulk into one line, with re-bagging into 1.2 mt big-bags and storage per 15 days.",
    portLines: [{ label: "DTHC + DO (port)", v: 12.27, note: "€265/container ÷ 21.6 mt" }],
    warehouses: [
      { name: "Romani Genoa", lines: [
        { label: "CIF to in-store (haulage, weighing, bulk)", v: 30.00 },
        { label: "Re-bagging into 1.2 mt big-bags", v: 15.00 },
      ], storage: { rate: 3, unit: "fortnight" } },
      { name: "Pacorini Genoa", lines: [
        { label: "CIF to in-store (haulage, weighing, bulk)", v: 35.00 },
        { label: "Re-bagging into 1.2 mt big-bags", v: 18.00 },
      ], storage: { rate: 3.2, unit: "fortnight" } },
    ],
  },
  {
    key: "trieste", region: "South Europe · Italy", port: "Trieste",
    currency: "EUR", weightLossPct: 0.10, defaultTransitDays: 55, freightMult: 1.12, freightProxy: true,
    blurb: "Trieste mirrors Genoa's structure — a shared DTHC/DO and 0.10% re-bagging weight-loss, then Romani and Pacorini warehouses with storage quoted per week.",
    portLines: [{ label: "DTHC + DO (port)", v: 16.94, note: "€366/container ÷ 21.6 mt" }],
    warehouses: [
      { name: "Romani Trieste", lines: [
        { label: "CIF to in-store (haulage, weighing, bulk)", v: 27.59 },
        { label: "Re-bagging into 1.2 mt big-bags", v: 17.25 },
      ], storage: { rate: 1.45, unit: "week" } },
      { name: "Pacorini Trieste", lines: [
        { label: "CIF to in-store (haulage, weighing, bulk)", v: 26.56 },
        { label: "Re-bagging into 1.2 mt big-bags", v: 18.00 },
      ], storage: { rate: 1.6, unit: "week" } },
    ],
  },
  {
    key: "melbourne", region: "Oceania · Australia", port: "Melbourne", warehouseLabel: "Geodis",
    currency: "USD", weightLossPct: 0, defaultTransitDays: 18, freightMult: 0.30, freightProxy: true,
    blurb: "Melbourne is quoted natively in USD (no EUR conversion) and folds customs and docs into the terminal charge; import drayage is the dominant line.",
    portLines: [],
    warehouses: [{
      lines: [
        { label: "DTHC + DO + customs + docs", v: 30.14, note: "$651/container ÷ 21.6 mt" },
        { label: "Import drayage (haulage) — delivery", v: 64.26, note: "$1,388/container ÷ 21.6 mt" },
      ],
    }],
  },
];

function storageNativePerHold(s?: { rate: number; unit: StorageUnit }): number {
  return s ? (s.rate * IN_STORE_DAYS) / UNIT_DAYS[s.unit] : 0;
}

function NumInput({ value, onChange, step = 1, min = 0, max, width = "w-20" }: {
  value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; width?: string;
}) {
  return (
    <input type="number" value={value} step={step} min={min} max={max}
      onChange={e => { const n = Number(e.target.value); onChange(Number.isFinite(n) ? n : 0); }}
      className={`${width} bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-amber-300 font-mono text-xs focus:outline-none focus:border-amber-500/60`} />
  );
}

function DestinationInstore() {
  // Live defaults; both feeds publish daily and are user-overridable below.
  const [vnPrice, setVnPrice] = useState(3411);   // today's VN FAQ, USD/t
  const [eurUsd, setEurUsd]   = useState(1.16);    // USD per 1 EUR
  const [rate, setRate]       = useState(8);       // financing interest, % p.a.
  const [freightBase, setFreightBase] = useState(4741);  // FBX11 VN→N.Europe, USD/FEU (Freight tab)
  const [transit, setTransit] = useState<Record<string, number>>(
    () => Object.fromEntries(DEST_PORTS.map(p => [p.key, p.defaultTransitDays])),
  );
  const [src, setSrc] = useState<{ vn?: string; fx?: string; fr?: string }>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lp = await cachedFetchStatic<{ generated_at?: string; tickers?: { label: string; value: string }[] }>("/data/latest_prices.json");
        const tk = new Map((lp.tickers ?? []).map(t => [t.label, t.value]));
        const vn = tk.get("VN FAQ");
        const usdVnd = Number(tk.get("USD/VND"));
        let usd: number | null = null;
        if (vn) {
          // Recompute from VND ÷ live FX (mirrors lib/originPrices) to avoid the
          // pre-baked $ being from a different timestamp; fall back to the $ tag.
          const m = vn.match(/([\d.]+)\s*VND/);
          const vndKg = m ? Number(m[1].replace(/\./g, "")) : null;
          if (vndKg && usdVnd > 0) usd = Math.round((vndKg / usdVnd) * 1000);
          if (usd == null) { const d = vn.match(/\$([0-9,]+)/); if (d) usd = Number(d[1].replace(/,/g, "")); }
        }
        if (alive && usd) { setVnPrice(usd); setSrc(s => ({ ...s, vn: lp.generated_at?.slice(0, 10) })); }
      } catch { /* keep default */ }
      try {
        const fx = await cachedFetchStatic<{ pairs: Record<string, { history: { date: string; close: number }[] }> }>("/data/fx_history.json");
        const h = fx.pairs?.["EURUSD=X"]?.history;
        const last = h && h.length ? h[h.length - 1] : null;
        if (alive && last?.close) { setEurUsd(Number(last.close.toFixed(4))); setSrc(s => ({ ...s, fx: last.date })); }
      } catch { /* keep default */ }
      try {
        // FBX11 North-Europe base = the vn-eu (VN→Rotterdam ×1.00) route the
        // Freight tab calculates; every destination scales off it by multiplier.
        const fr = await cachedFetchStatic<{ updated?: string; routes?: { id: string; rate: number }[] }>("/data/freight.json");
        const base = fr.routes?.find(r => r.id === "vn-eu")?.rate;
        if (alive && base) { setFreightBase(base); setSrc(s => ({ ...s, fr: fr.updated })); }
      } catch { /* keep default */ }
    })();
    return () => { alive = false; };
  }, []);

  const inStoreWeeks = IN_STORE_DAYS / 7;
  const wlUsd  = (pct: number)  => (vnPrice * pct) / 100;
  const insUsd = (pct?: number) => (pct ? (vnPrice * pct) / 100 * inStoreWeeks : 0);
  const finDays = (t: number)   => t + PRE_DELIVERY_DAYS + DELIVERY_MONTH_DAYS;
  const finUsd  = (t: number)   => vnPrice * (rate / 100) * (finDays(t) / 365);
  // Ocean freight VN → port, USD/t: FBX11 base × port multiplier ÷ container.
  const freightUsd = (mult: number) => (freightBase * mult) / CONTAINER_MT;
  const fmt2 = (n: number) => `$${n.toFixed(2)}/t`;
  const fmt0 = (n: number) => `$${Math.round(n).toLocaleString()}/t`;

  // Per-warehouse USD economics for a port (move-in handling, 45-day storage,
  // the shared value-based + financing add-on, and the ocean-freight leg). The
  // "delivered" total adds freight to give a full FOB-VN → in-store logistics cost.
  function whTotals(p: DestPort) {
    const k = p.currency === "EUR" ? eurUsd : 1;
    const t = transit[p.key] ?? p.defaultTransitDays;
    const shared = wlUsd(p.weightLossPct) + insUsd(p.insurancePctPerWeek) + finUsd(t);
    const freight = freightUsd(p.freightMult);
    const portHandling = p.portLines.reduce((a, l) => a + l.v, 0);
    return p.warehouses.map(wh => {
      const moveIn  = (portHandling + wh.lines.reduce((a, l) => a + l.v, 0)) * k;
      const storage = storageNativePerHold(wh.storage) * k;
      const total   = moveIn + storage + shared;
      return { wh, moveIn, storage, total, freight, delivered: total + freight };
    });
  }

  function renderPort(p: DestPort) {
    const k = p.currency === "EUR" ? eurUsd : 1;
    const sym = p.currency === "EUR" ? "€" : "$";
    const t = transit[p.key] ?? p.defaultTransitDays;
    const wl = wlUsd(p.weightLossPct), ins = insUsd(p.insurancePctPerWeek), fin = finUsd(t);
    const freight = freightUsd(p.freightMult);
    const calc = whTotals(p);
    const totals = calc.map(c => c.total);
    const head = totals.length > 1
      ? `$${Math.round(Math.min(...totals)).toLocaleString()}–${Math.round(Math.max(...totals)).toLocaleString()}/t`
      : `$${Math.round(totals[0]).toLocaleString()}/t`;

    const lineRow = (l: DestLine, i: number) => (
      <CostRow key={i} label={l.label} cost={fmt2(l.v * k)}
        note={p.currency === "EUR" ? `€${l.v.toFixed(2)}/t${l.note ? ` · ${l.note}` : ""}` : l.note} />
    );

    return (
      <PortCard key={p.key} span={p.warehouses.length > 1}
        region={p.region}
        title={`${p.port}${p.warehouseLabel ? ` · ${p.warehouseLabel}` : ""} — in-store ≈ ${head} · +freight ${fmt0(freight)}`}>
        <P>{p.blurb}</P>

        {/* Value-based + financing (port-level, in USD off the FAQ price) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 mt-2">
          <span>Transit VN → {p.port}</span>
          <NumInput value={t} max={120} onChange={n => setTransit(s => ({ ...s, [p.key]: n }))} width="w-16" />
          <span className="text-slate-500">days → financing&nbsp;
            <span className="text-amber-300 font-mono">{finDays(t)}d</span>&nbsp;({t}+{PRE_DELIVERY_DAYS}+{DELIVERY_MONTH_DAYS})</span>
        </div>
        <DestCostTable>
          {p.weightLossPct > 0 && (
            <CostRow label="Weight-loss" cost={fmt2(wl)} note={`${p.weightLossPct}% of value × $${vnPrice.toLocaleString()} FAQ`} />
          )}
          {p.insurancePctPerWeek != null && (
            <CostRow label="In-store insurance" cost={fmt2(ins)} note={`${p.insurancePctPerWeek}%/wk × ${inStoreWeeks.toFixed(1)} wk in store`} />
          )}
          <CostRow label="Financing (cost of money)" cost={fmt2(fin)} note={`${finDays(t)}d × ${rate}% × $${vnPrice.toLocaleString()} ÷ 365`} />
          <CostRow label={`Ocean freight (VN→${p.port})`} cost={fmt2(freight)}
            note={`${p.freightProxy ? "~est · " : ""}FBX11 $${freightBase.toLocaleString()}/FEU ×${p.freightMult} ÷ ${CONTAINER_MT} mt`} />
        </DestCostTable>

        {/* Per-warehouse handling + all-in total */}
        <div className={p.warehouses.length > 1 ? "grid grid-cols-1 sm:grid-cols-2 gap-x-6" : ""}>
          {calc.map(({ wh, moveIn, storage, total, delivered }, wi) => (
            <div key={wi}>
              {p.warehouses.length > 1 && wh.name && <WhHead>{wh.name}</WhHead>}
              <DestCostTable>
                {[...p.portLines, ...wh.lines].map(lineRow)}
                <DestTotal label="Move-in subtotal" cost={fmt2(moveIn)} note="handling only" />
                {wh.storage && (
                  <CostRow label={`Storage (${IN_STORE_DAYS}d to delivery)`} cost={fmt2(storage)}
                    note={`${sym}${wh.storage.rate}/t·${UNIT_ABBR[wh.storage.unit]} × ${(IN_STORE_DAYS / UNIT_DAYS[wh.storage.unit]).toFixed(1)}`} />
                )}
                <DestTotal label="Total CIF→in-store" cost={fmt0(total)}
                  note={`+ financing ${fmt2(fin)}${wl ? ` + weight-loss ${fmt2(wl)}` : ""}${ins ? ` + ins ${fmt2(ins)}` : ""}`} />
                <DestTotal label="Delivered FOB→in-store" cost={fmt0(delivered)} note={`incl. ocean freight ${fmt2(freight)}`} />
              </DestCostTable>
            </div>
          ))}
        </div>
      </PortCard>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

      {/* Intro + live assumptions */}
      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <H>What is a CIF-to-in-store cost?</H>
        <P>
          A <strong>CIF</strong> price covers the coffee delivered to the destination port — cost, insurance and ocean
          freight to the quay. But a roaster buys coffee <strong>in-store</strong>: green resting in a destination
          warehouse, customs-cleared, reweighed and (where required) re-bagged, ready to call off. The{" "}
          <strong>CIF-to-in-store</strong> cost is the chain of expenses that bridges those two points — the mirror
          image of the <Code>FOBbing cost</Code> on the origin side.
        </P>
        <P>
          Everything below is priced in <strong>USD</strong> and is <strong>dynamic</strong>: handling quotes given in
          EUR are converted at the live <Code>EUR/USD</Code>, while the value-based lines (weight-loss, insurance) and
          the <strong>financing</strong> are computed off today&rsquo;s <strong>Vietnam FAQ</strong> price as the goods
          value. As the daily FAQ print and EUR/USD move, every figure re-prices.
        </P>
        <P>
          Each port also carries the <strong>ocean freight</strong> leg (Vietnam → port), pulled from the{" "}
          <strong>Freight tab</strong>: its <Code>FBX11</Code> North-Europe base (the VN→Rotterdam route) scaled by a
          per-destination multiplier — the same FBX-multiplier method the freight section uses for its estimated
          corridors — then divided over the {CONTAINER_MT} mt container to a per-tonne rate. North-range ports
          (Rotterdam/Hamburg/Le&nbsp;Havre/Bremen) sit on the base; Mediterranean and Oceania lanes are scaled proxies
          (flagged <em>~est</em>). The <strong>delivered</strong> total adds freight to the in-store stack for a full
          FOB-Vietnam → in-store logistics cost.
        </P>
        <div className="font-mono text-xs bg-slate-800 rounded px-3 py-2 text-amber-300 mb-3">
          in-store = (DTHC/DO + haulage + handling + storage)×EUR/USD + weight-loss + financing &nbsp;·&nbsp; delivered = in-store + freight
        </div>

        {/* Editable assumptions */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 bg-slate-800/50 border border-slate-700/60 rounded-lg p-3">
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <span className="font-semibold text-amber-300">VN FAQ</span> $
            <NumInput value={vnPrice} step={10} onChange={setVnPrice} width="w-24" /> /t
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <span className="font-semibold text-amber-300">EUR/USD</span>
            <NumInput value={eurUsd} step={0.001} onChange={setEurUsd} width="w-24" />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <span className="font-semibold text-amber-300">Interest</span>
            <NumInput value={rate} step={0.5} onChange={setRate} width="w-16" /> % p.a.
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <span className="font-semibold text-amber-300">Freight FBX11</span> $
            <NumInput value={freightBase} step={50} onChange={setFreightBase} width="w-24" /> /FEU
          </label>
          <div className="text-[10px] text-slate-500 flex items-center">
            live: {src.vn ? `FAQ ${src.vn}` : "FAQ (default)"} · {src.fx ? `EUR/USD ${src.fx}` : "EUR/USD (default)"} · {src.fr ? `freight ${src.fr}` : "freight (default)"}
          </div>
        </div>

        <P className="text-[11px] text-slate-500 mt-3">
          <strong>Financing window</strong> = transit&nbsp;Vietnam→port + {PRE_DELIVERY_DAYS} days (in store 2 weeks
          before the delivery month) + {DELIVERY_MONTH_DAYS} days (delivery month). Cost of money ={" "}
          <Code>goods value × interest × days ÷ 365</Code>. Storage and insurance are charged over the{" "}
          {IN_STORE_DAYS}-day in-store hold ({PRE_DELIVERY_DAYS}+{DELIVERY_MONTH_DAYS}). Container basis {CONTAINER_MT} mt;
          indicative warehouse quotes, not contractual.
        </P>
      </div>

      {DEST_PORTS.map(renderPort)}

      {/* Cross-port comparison — dynamic, all-in USD */}
      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <H>Cross-port comparison — freight + in-store, delivered (USD/MT)</H>
        <table className="w-full text-xs mt-2">
          <thead>
            <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-1.5 pr-4">Port · warehouse</th>
              <th className="pb-1.5 pr-4 text-right">Ocean freight</th>
              <th className="pb-1.5 pr-4 text-right">In-store (CIF→)</th>
              <th className="pb-1.5 text-right">Delivered FOB→in-store</th>
            </tr>
          </thead>
          <tbody>
            {DEST_PORTS.flatMap(p =>
              whTotals(p).map((c, i) => {
                const whName = c.wh.name ? c.wh.name.replace(` ${p.port}`, "") : p.warehouseLabel ?? "";
                return (
                  <tr key={`${p.key}-${i}`} className="border-b border-slate-800">
                    <td className="py-1.5 pr-4 text-slate-200 font-semibold">
                      {p.port}{whName ? ` · ${whName}` : ""}
                      {p.freightProxy && <span className="ml-1 text-[9px] text-slate-500">~est</span>}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono text-sky-300">{fmt2(c.freight)}</td>
                    <td className="py-1.5 pr-4 text-right font-mono text-slate-400">{fmt0(c.total)}</td>
                    <td className="py-1.5 text-right font-mono text-amber-300">{fmt0(c.delivered)}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
        <P className="mt-3">
          <strong>Ocean freight</strong> (VN→port) is the dominant single line — at ${freightBase.toLocaleString()}/FEU
          FBX11 it runs <strong>~${Math.round(freightUsd(1.0))}/t</strong> to the North range and proportionally more to
          the Mediterranean, dwarfing the in-store stack. <strong>In-store</strong> is everything added on top of CIF
          (handling + storage + weight-loss + financing); <strong>delivered</strong> sums the two for a full FOB-Vietnam
          → in-store logistics cost. At ${vnPrice.toLocaleString()}/t FAQ, {eurUsd.toFixed(4)} EUR/USD and{" "}
          ${freightBase.toLocaleString()}/FEU freight, edit any assumption above to re-price the whole table. Freight is
          the ocean leg already embedded in a CIF quote, shown here to decompose the full landed cost.
        </P>
      </div>

    </div>
  );
}

function CertifiedStocksMethodology() {
  return (
    <CollapsibleCard tone="amber" updated="2026-07-15" kicker="Exchange · certified stocks" title="Certified stocks — cohort flow methodology" subtitle="How daily stock totals and gradings reconcile into in / in-&-out / out flows">
      <H2>What this page documents</H2>
      <P>
        The <strong>Demand → Certified Stocks</strong> tab visualises the ICE-deliverable inventory the coffee
        futures market clears against — Arabica (Coffee &ldquo;C&rdquo; / KC, US warehouses) and Robusta (RC,
        European warehouses) — and decomposes each period&rsquo;s change into three flows: <strong>in</strong>{" "}
        (newly graded coffee that stayed), <strong>in &amp; out</strong> (graded <em>and</em> decertified inside the
        same window), and <strong>out</strong> (older stock that left). This document explains exactly how those
        numbers are computed, the formulas, and the cohort model that makes &ldquo;in &amp; out&rdquo; meaningful.
      </P>

      <H2>The core problem</H2>
      <P>
        The exchange publishes a <strong>daily certified-stock total</strong> and a <strong>daily grading count</strong>,
        but these are two different ledgers. In a quiet week they reconcile; in a busy week they do not. If 850 bags
        pass grading while the total stock <em>falls</em> 14,722, naïvely netting per-origin daily deltas makes the
        fresh gradings cancel against same-week decertifications and <em>vanish</em>. The model below fixes that by
        treating gradings and decertifications as separate flows and only merging them into &ldquo;in &amp; out&rdquo;
        once an <strong>ageing report</strong> lets us match cohorts.
      </P>

      <H2>Cohorts — the unit of accounting</H2>
      <P>Every graded lot is labelled by a <strong>cohort</strong>, the atomic key all flows are tracked against:</P>
      <ul className="space-y-1">
        <LI><strong>Arabica:</strong> <Code>(grading date, origin, port)</Code>.</LI>
        <LI><strong>Robusta:</strong> <Code>(grading date, origin, port, class)</Code> — class is the C-contract
          quality tier (1 = par, 2 = −$30/t, 3 = −$60/t, 4 = −$90/t).</LI>
      </ul>
      <P>
        For cohort arithmetic the <em>grading date</em> is bucketed to its <strong>calendar month</strong>
        (<Code>cohort_id = YYYY-MM</Code>). The monthly ageing report tells us, per cohort, how many lots are still on
        warrant — comparing two consecutive reports gives each cohort&rsquo;s shrinkage.
      </P>

      <H2>Theoretical vs. real stock (the daily trace)</H2>
      <P>
        Each day we maintain a <strong>theoretical stock</strong> per origin and port (Arabica) or per port (Robusta,
        whose daily report carries no origin breakdown):
      </P>
      <Fml>{`theoretical(t) = stock_report(reference_date)
               + Σ passed_gradings(reference_date … t)`}</Fml>
      <P>
        Real (reported) stock can only be <strong>equal to or below</strong> theoretical — coffee can leave, it cannot
        appear without being graded. The gap is what left:
      </P>
      <Fml>{`out(window) = theoretical − real
            = Σ passed_gradings − (stock_end − stock_start)
            = passed − netΔ        (netΔ = stock_end − stock_start)`}</Fml>
      <ul className="space-y-1">
        <LI>If real = theoretical → nothing left; <strong>all passed gradings are &ldquo;in&rdquo;</strong>, out = 0.</LI>
        <LI>If real &lt; theoretical → the difference is <strong>&ldquo;out&rdquo;</strong>.</LI>
      </ul>

      <H2>When does &ldquo;in &amp; out&rdquo; appear?</H2>
      <P>
        Crucially, <strong>before an ageing report we cannot know which lots left</strong> — the freshly graded ones or
        old stock. So the model shows:
      </P>
      <ul className="space-y-1">
        <LI><strong>No ageing report inside the window</strong> → <Code>in = passed</Code>, <Code>out = passed − netΔ</Code>,
          and <Code>in &amp; out = 0</Code>. This is the &ldquo;assume nothing until month-end&rdquo; state.</LI>
        <LI><strong>An ageing report falls inside the window</strong> → we match cohorts (below) and reclassify part of
          the gradings as &ldquo;in &amp; out&rdquo;.</LI>
      </ul>
      <P>
        The Certified Stocks panel surfaces this with a per-market caption: <em>&ldquo;in &amp; out pending next ageing
        report&rdquo;</em> vs <em>&ldquo;in &amp; out matched (ageing report)&rdquo;</em>.
      </P>

      <H2>Worked example (the design case)</H2>
      <P>
        Today is June 6; we look at the last week. <strong>850</strong> bags passed grading and total stock fell
        <strong> 14,722</strong>. Before the month-end ageing report:
      </P>
      <Fml>{`in       = 850                       (all passed)
out      = 850 − (−14,722) = 15,572   (passed − netΔ)
in & out = 0                         (no ageing report yet)
check:   in − out = 850 − 15,572 = −14,722  ✓`}</Fml>
      <P>
        At month-end the ageing report arrives. Suppose the June cohort (this month&rsquo;s gradings) shows a net
        <strong> +278</strong> still on warrant, while old cohorts (e.g. Jan-26) shrank <strong>15,000</strong>. We can
        now split the 850:
      </P>
      <Fml>{`in & out (transit) = 850 − 278 = 572   (graded then left)
in (pure)          = 278               (graded and stayed)
out (legacy)       = 15,000            (old cohorts decertified)
check: in − (in&out + out) = 278 − (572 + 15,000) = −14,722  ✓`}</Fml>

      <H2>Cohort-DNA: inferring Robusta origins</H2>
      <P>
        The Robusta daily stock report has <strong>no per-origin breakdown</strong> — only port totals. We recover
        origins with the <strong>cohort-DNA</strong> algorithm:
      </P>
      <ul className="space-y-1">
        <LI><strong>DNA</strong> — for each <Code>(port, cohort)</Code>, the normalised origin split of the gradings
          recorded that month: <Fml>{`DNA[port][cohort][origin]
  = graded_lots[port][cohort][origin] / Σ_origin graded_lots[port][cohort]`}</Fml></LI>
        <LI><strong>Shrinkage</strong> — between consecutive month-end reports RP<sub>t−1</sub> → RP<sub>t</sub>, each
          cohort&rsquo;s lost lots: <Fml>{`shrink[port][cohort] = max(0, lots_in_RP(t−1) − lots_in_RP(t))`}</Fml>
          A cohort first appearing in RP<sub>t</sub> (just graded) instead uses
          <Code>shrink = max(0, graded_total − lots_in_RP(t))</Code>.</LI>
        <LI><strong>Apportion</strong> — distribute each cohort&rsquo;s shrinkage to origins by its DNA:
          <Fml>{`implied_outflow[port][origin]
  = Σ_cohort shrink[port][cohort] × DNA[port][cohort][origin]`}</Fml>
          When a cohort predates our gradings history (no DNA), we fall back to the port&rsquo;s all-time origin mix;
          a coverage guard (gradings &lt; 50% of the bucket) also triggers the fallback.</LI>
      </ul>

      <H2>Cohort-resolved &ldquo;in &amp; out&rdquo;</H2>
      <P>
        To split the matched window exactly, the backend emits — alongside total <Code>implied_outflow</Code> — a
        <strong> transit subset</strong> <Code>by_port_transit</Code>: the outflow from cohorts graded <em>inside the
        same interval</em> (the &ldquo;new cohort&rdquo; shrinkage only). By construction
        <Code> by_port_transit ⊆ by_port</Code>, so:
      </P>
      <Fml>{`transit  (in & out) = Σ_window by_port_transit[port][origin]
out_total           = Σ_window by_port[port][origin]  (+ recent daily sim)
pure_out            = out_total − transit
in_total            = Σ_window gradings[port][origin]

per origin, clamped so every bucket ≥ 0:
  t        = clamp(transit, 0, min(in_total, out_total))
  in_pure  = in_total  − t
  out_pure = out_total − t`}</Fml>
      <P>
        For the Feb worked example (cohort 2026-02 graded 100 lots, 80 remain, DNA 75% Vietnam / 25% Indonesia):
        transit = 20 lots → <strong>15 Vietnam + 5 Indonesia</strong> in &amp; out, while older cohorts&rsquo;
        shrinkage (10 lots) stays pure out — total outflow 19 Vietnam / 11 Indonesia.
      </P>

      <H2>The four density-grid buckets</H2>
      <P>Each warehouse card draws warrants (1 square = 1 warrant: KC ≈ 37,500 lb ≈ 283 bags; RC = 10 t = 1 lot) in four buckets:</P>
      <ul className="space-y-1">
        <LI><strong>existing</strong> — stock present at window start that&rsquo;s still here:
          <Code> existing = current − net_gained</Code> (inherits the port&rsquo;s age mix).</LI>
        <LI><strong>net gained (in)</strong> — graded and stayed (green dashed, fresh age).</LI>
        <LI><strong>in &amp; out (transit)</strong> — graded then left (amber dashed); only non-zero when cohort-matched.</LI>
        <LI><strong>lost / out</strong> — older stock that left (red ghost squares).</LI>
      </ul>
      <P>Invariants that always hold:</P>
      <Fml>{`current   = existing + net_gained
gross_in  = net_gained + transit
gross_out = lost       + transit`}</Fml>

      <H2>Arabica: per-origin gradings (exact, with a fallback)</H2>
      <P>
        Since ~June 2026 ICE publishes the &ldquo;TODAY&rsquo;S GRADING SUMMARY&rdquo; as an{" "}
        <strong>origin × port matrix</strong> (a <Code>BAGS PASSED GRADING</Code> table, then a
        <Code> BAGS FAILED GRADING</Code> table), not the old <Code>&ldquo;825 Bags Passed Today&rdquo;</Code> one-liner.
        We parse the full matrix, so on action days the &ldquo;in&rdquo; is sourced <strong>exactly</strong> per
        <Code> (origin, port)</Code> — the same fidelity as Robusta gradings:
      </P>
      <Fml>{`in[port,origin] = Σ_window passed_by_origin[origin][port]   (exact)

net_gained = max(in, max(0, netΔ))
lost       = net_gained − netΔ`}</Fml>
      <P>
        Only for days that lack the matrix (legacy/no-action reports, or history captured before the matrix parser
        shipped) do we fall back to distributing the <em>uncovered</em> passed bags <Code>P_remainder</Code> by where
        stock grew:
      </P>
      <Fml>{`in[port,origin] += P_remainder × ( max(0, Δ[port,origin]) / Σ max(0, Δ) )
   P_remainder = passed_total − Σ matrix-covered gradings`}</Fml>
      <P>
        So the per-origin split is now <strong>exact when the matrix is present</strong> and only an inference for the
        residual; the aggregate in/out totals are exact either way.
      </P>
      <H2>Arabica in &amp; out — the daily FIFO ledger</H2>
      <P>
        The ICE monthly ageing report (<Code>coffee_aging_YYYYMMDD.xls</Code>) turned out to be laid out as
        <strong> age-in-days × port</strong> with <em>no origin column</em>, and its day-buckets don&rsquo;t support a
        clean report-to-report cohort match (a 0–120-day lumped young bucket, fixed bins that a cohort drifts across as
        it ages, and non-uniform ~30-day intervals). Prototyped against real April→May files it <strong>overcounted
        outflow ~2.3×</strong> versus the exact mass balance — so it&rsquo;s not the right engine for Arabica.
      </P>
      <P>
        Instead we use what Arabica has and Robusta doesn&rsquo;t: <strong>exact daily per-(origin, port) stock</strong>
        plus exact per-origin gradings. So in/out are computed, not inferred, and in &amp; out comes from a per-(origin,
        port) <strong>FIFO ledger</strong>:
      </P>
      <Fml>{`in[port,origin]  = Σ_window gradings                         (exact)
out[port,origin] = Σ_window daily decertifications           (exact)
seed: start-of-window stock = the oldest ("LEGACY") cohort
each day:  add that day's gradings as a new cohort
           remove the day's decert FIFO — oldest first
in & out (transit) = decerted bags whose cohort was graded in-window`}</Fml>
      <P>
        Oldest-leaves-first is also the realistic tender order, since age allowances penalise old warrants. A key
        consequence (and a good sanity check): when a window&rsquo;s gradings are small relative to a large outflow of
        old stock, <Code>in &amp; out ≈ 0</Code> — the fresh lots stayed, the old stock left — which is exactly the
        model&rsquo;s &ldquo;850 in, big out, 0 in &amp; out&rdquo; case. The ageing report still earns its keep: it
        powers the age fade / age tiles and independently validates the ledger&rsquo;s young-cohort survivors. The
        per-market caption reads <em>&ldquo;in &amp; out · daily per-origin ledger (FIFO)&rdquo;</em> for Arabica.
      </P>

      <H2>The period selector</H2>
      <P>
        The window is <Code>[start, end]</Code>. <strong>End</strong> is a calendar pick defaulting to the latest
        available data date (bounded to the data range). <strong>Start</strong> is chosen relative to end:
        <Code> end − 7 days</Code>, or the 1st of end&rsquo;s month (month-to-date — the default view) and the 1st of
        each earlier month. Every aggregation above is clamped to this window, and current stock is framed off the last
        snapshot at or before <Code>end</Code>.
      </P>

      <H2>Data sources &amp; cadence</H2>
      <ul className="space-y-1">
        <LI><strong>Arabica daily XLS</strong> — certified total, by-port, by-group, and the passed/failed grading
          matrix (origin × port, June 2026+; scalar text on legacy days).</LI>
        <LI><strong>Arabica ageing report</strong> — certified stock by <em>age-in-days × port</em> (monthly; no origin
          column — supplies the per-port age distribution that drives the age fade / age tiles).</LI>
        <LI><strong>Robusta stock CSV</strong> — port totals (daily, time-stamped).</LI>
        <LI><strong>Robusta gradings</strong> — per <Code>(date, origin, port, class, tenderable, lots)</Code> (daily) →
          cohort DNA.</LI>
        <LI><strong>Robusta age-allowance report</strong> — lots by <Code>months_since_graded</Code> × port (monthly) →
          cohort shrinkage &amp; implied outflow.</LI>
      </ul>

      <H2>Caveats</H2>
      <ul className="space-y-1">
        <LI><strong>Arabica per-origin flows are exact on action days</strong> — the June-2026+ grading matrix gives a
          real <Code>(origin, port)</Code> split. Only days without the matrix (legacy text reports, or pre-matrix
          history) fall back to a distribution for the uncovered bags. Aggregate totals are exact either way.</LI>
        <LI><strong>Robusta origins are modelled</strong> via cohort DNA; thin gradings history falls back to a
          port&rsquo;s all-time mix.</LI>
        <LI><strong>in &amp; out lags the ageing report</strong> — intra-month it reads 0 by design; it resolves at the
          next month-end. Same-month decertifications after the last report are surfaced via a daily stock simulation as
          pure out (never as in &amp; out).</LI>
        <LI><strong>transit is clamped to in-window gradings</strong> — if cohort DNA attributes more shrinkage to an
          origin than the window&rsquo;s recorded gradings, the excess stays in pure out, since in &amp; out can never
          exceed what arrived.</LI>
      </ul>

      <H2>Where it lives</H2>
      <P>
        Arabica grading matrix parser: <Code>parse_arabica_xls.py</Code> (<Code>_parse_grading_summary</Code> →
        <Code> passed_by_origin</Code> / <Code>failed_by_origin</Code> on each snapshot). Cohort algorithm:{" "}
        <Code>backend/scraper/sources/ice_certified_stocks/cohort_outflow.py</Code>{" "}
        (<Code>build_cohort_dna</Code>, <Code>build_implied_outflow</Code> with <Code>by_port_transit</Code>,
        <Code> build_current_by_origin</Code>). Visualisation &amp; bucket math:{" "}
        <Code>frontend/components/demand/CertifiedStocksSystemFlow.tsx</Code> (<Code>buildDensityGrid</Code>); KPI tiles
        and the period selector live in <Code>CertifiedStocksPanel.tsx</Code>.
      </P>
    </CollapsibleCard>
  );
}

// catalogue id → the component that renders that article's body.
// Generated alongside lib/research/catalog.ts: every id in the catalogue
// has exactly one entry, and the container shells (AgronomyArticles,
// DemandArticles) are unpacked to their per-article children so an
// article can be opened on its own rather than with its four siblings.
const BODY: Record<string, React.ReactNode> = {
  "when-ice-publishes-the-robusta-stock-report": <IcePublishTimes />,
  "threshold-alerts-tell-me-when": <ThresholdAlerts />,
  "are-swap-dealers-commercials-or-speculators": <CotSwapIdentity />,
  "intraweek-cot-nowcast-methodology": <IntraweekMethodology />,
  "cot-backtest-report": <CotBacktestReport />,
  "september-x-ray-kc-september-positioning-via-the-old": <SeptemberXray />,
  "crop-year-x-ray-the-same-trick-across-seven-cftc-mar": <CropyearXray />,
  "signals-forecasts-the-four-models-behind-the-tab": <SignalsMethodology />,
  "open-price-direction-walk-forward-record": <OpenDirectionRecord />,
  "the-harvest-last-hour-a-pre-hedging-signal-on-its-ow": <IntradayDrift />,
  "news-sentiment-turning-headlines-into-a-coffee-signa": <NewsSentimentMethodology />,
  "futures-analytics-contract-math-roll-dynamics-the-pr": <FuturesMethodology />,
  "macro-fx-the-currency-index-and-cross-commodity-posi": <MacroMethodology />,
  "cpi-decoded-us-cpi-vs-eurozone-hicp": <CpiMethodology />,
  "supply-modelling-production-estimates-balance-sheets": <SupplyMethodology />,
  "farmer-economics-cost-of-production-break-even-crop-": <FarmerMethodology />,
  "fertilizer-why-it-s-a-coffee-signal": <FertilizerMethodology />,
  "when-does-rain-become-a-supply-shock": <Article1 />,
  "which-clones-ship-when-and-how-much": <Article2 />,
  "what-does-a-kilo-of-robusta-actually-cost-to-grow": <Article3 />,
  "how-fragile-is-vietnamese-supply-long-term": <Article4 />,
  "npk-urea-and-map-why-agronomists-and-traders-speak-d": <Article5 />,
  "enso-el-ni-o-interactive-explainer": <EnsoExplainer />,
  "the-enso-risk-model-from-oni-to-per-origin-coffee-ri": <EnsoModelMethodology />,
  "drought-risk-how-the-spi-spei-vhi-stack-works": <DroughtRiskMethodology />,
  "theoretical-yield-vs-rainfall-theory-29-harvests-and": <YieldRainfall />,
  "frost-risk-why-radiative-frost-is-the-trade-that-mat": <FrostRiskMethodology />,
  "honduras-origin-country-profile": <HondurasProfile />,
  "cert-stocks-and-the-front-spread": <CertStocksSpread />,
  "vietnam-mid-month-customs-bulletin": <VnMidMonth />,
  "enso-and-the-coffee-arbitrage": <EnsoArbitrage />,
  "from-the-port-to-the-shelf": <RetailPassthrough />,
  "workflow-failure-taxonomy": <WorkflowFailures />,
  "origin-logistics-the-fobbing-cost-model": <OriginLogistics />,
  "destination-in-store-cost": <DestinationInstore />,
  "freight-port-activity-how-the-numbers-are-built": <FreightMethodology />,
  "the-differential-model-a-research-note": <DifferentialModelNote />,
  "certified-stocks-cohort-flow-methodology": <CertifiedStocksMethodology />,
  "options-expiry-and-the-itm-overhang": <OptionsExpiryStudy />,
  "the-gamma-map-where-hedging-stabilises-and-where-it-": <OptionsGammaMap />,
  "the-variance-risk-premium-what-implied-costs-vs-what": <OptionsVrp />,
  "the-25-delta-risk-reversal-what-the-wings-say-about-": <OptionsSkew />,
  "options-flow-as-a-faster-cot-tested-swept-and-mostly": <OptionsFlowCot />,
  "oi-walls-where-the-strike-matrix-defends-a-level": <OptionsOiWalls />,
  "the-optionization-ratio-coffee-s-risk-is-moving-into": <OptionsOptionization />,
  "the-conilon-reference-stack-cooabriel-cepea-vit-ria-": <ConilonBasis />,
  "tender-parity-tool": <CertifiedStocksParity />,
  "contract-rules": <ContractRules />,
  "robusta-delivery-the-ice-tender-settlement-process": <DeliveryProcessMethodology />,
  "beyond-the-hockey-stick-an-s-curve-model-for-emergin": <LogisticModel />,
  "k-table-for-our-12-markets-proposed-ceilings-the-log": <SaturationLimits />,
  "the-ceiling-k-the-retail-multiplier-and-where-the-an": <MarketCeilings />,
  "demand-data-indices-the-reconciliation-and-concentra": <DemandDataMethodology />,
};

/* ── The two views ────────────────────────────────────────────────────────
   LIST — a searchable index on the left, the article beside it, so you never
   lose your place while reading.
   MAP  — the differential-model factor map, with each node carrying the
   research that bears on it. Same <FactorMap /> the Differential note renders
   as its figure, over the same node table, so adding a factor to the model
   makes it appear here automatically — there is no second copy to update. */

/** The client-readable tier cookie decides whether the edit affordance is
 *  even drawn. It is cosmetic only — the API verifies the SIGNED cookie, so a
 *  forged `tierv` buys a disabled-looking form and a 403. */
function useIsAdmin() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    setAdmin(document.cookie.split("; ").some(c => c === "tierv=admin"));
  }, []);
  return admin;
}

/** The editor's note, above the article. Plain text by design — rendered as
 *  paragraphs, never as HTML, so a note can never inject markup into the page. */
function EditorNote({ text }: { text: string }) {
  return (
    <div className="mb-3 rounded-lg border-l-2 border-amber-600 bg-amber-950/20 px-3 py-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-400">
        Editor&rsquo;s note
      </div>
      {text.split("\n").filter(Boolean).map((para, i) => (
        <p key={i} className="text-xs leading-relaxed text-slate-300">{para}</p>
      ))}
    </div>
  );
}

function ArticleBody({ id }: { id: string }) {
  const body = BODY[id];
  if (!body) {
    return (
      <div className="rounded border border-slate-800 px-3 py-6 text-center text-xs text-slate-600">
        No body registered for <span className="font-mono">{id}</span>.
      </div>
    );
  }
  return <>{body}</>;
}

function ListView({ sel, setSel, cat, setCat, list: all, editing, onEdit }: {
  sel: string; setSel: (id: string) => void;
  cat: Cat | "all"; setCat: (c: Cat | "all") => void;
  list: (Article & { note?: string })[];
  editing: boolean; onEdit?: () => void;
}) {
  const [q, setQ] = useState("");
  const [sortId, setSortId] = useState(DEFAULT_SORT.id);
  // Callback ref: SectionNav needs the mounted node, and a plain useRef would
  // not re-render it when the node arrives.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const sort = optionById(sortId);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(a => {
      if (cat !== "all" && a.cat !== cat) return false;
      if (!needle) return true;
      return `${a.title} ${a.subtitle ?? ""} ${a.kicker ?? ""}`.toLowerCase().includes(needle);
    });
    return sortArticles(filtered, sort.key, sort.dir);
  }, [q, cat, all, sort.key, sort.dir]);
  // Publication dates only reach back to the repository's first commit, so a
  // third of the catalogue has none. Say how many the current sort can actually
  // order rather than letting the rest look like the oldest articles.
  const dated = useMemo(() => datedCount(list, sort.key), [list, sort.key]);
  const current = all.find(a => a.id === sel) ?? all[0];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(250px,320px)_1fr]">
      <div className="lg:sticky lg:top-2 lg:self-start">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search research…"
          className="mb-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
        <div className="mb-2 flex flex-wrap gap-1">
          {/* A category chip only appears when it has articles the viewer can
              see — which is how "Admin & platform" stays out of a member's
              chip row without this component knowing about tiers. */}
          {(["all", ...CATS.filter(c => all.some(a => a.cat === c.id)).map(c => c.id)] as (Cat | "all")[]).map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                cat === c ? "border border-slate-700 bg-slate-800 text-amber-400"
                          : "border border-transparent text-slate-500 hover:text-slate-300"}`}>
              {c === "all" ? `All ${all.length}` : CAT_LABEL[c as Cat]}
            </button>
          ))}
        </div>
        <div className="mb-2">
          <select value={sortId} onChange={e => setSortId(e.target.value)}
            aria-label="Sort research"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 focus:border-slate-500 focus:outline-none">
            {SORT_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          {/* Only when it changes the reading. A silent third of the list with
              no publication date would otherwise look like the oldest work. */}
          {dated < list.length && (
            <div className="mt-1 text-[10px] leading-tight text-slate-500">
              {dated} of {list.length} have a {sort.key === "published" ? "publication" : "revision"} date
              {" — "}the rest are listed last, not oldest.
            </div>
          )}
        </div>
        <div className="max-h-[70vh] divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
          {list.map(a => {
            const d = sort.key === "published" ? a.published : a.updated;
            return (
              <button key={a.id} onClick={() => setSel(a.id)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-slate-900/60 ${
                  sel === a.id ? "bg-slate-800/70" : ""}`}>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{a.title}</span>
                {/* The value being sorted on, shown — ordering a list by a date
                    the reader cannot see just looks arbitrary. */}
                <span className={`shrink-0 font-mono text-[10px] tabular-nums ${
                  d ? "text-slate-500" : "text-slate-700"}`}>
                  {d ?? "—"}
                </span>
              </button>
            );
          })}
          {!list.length && <div className="px-3 py-6 text-center text-xs text-slate-600">No match.</div>}
        </div>
      </div>
      <div className="min-w-0">
        {current && (
          <>
            {onEdit && !editing && (
              <button onClick={onEdit}
                className="mb-2 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:text-amber-400">
                ✎ edit this article
              </button>
            )}
            {current.note && <EditorNote text={current.note} />}
            {/* Contents bar, built from the article's own rendered headings —
                these papers run six to eight sections and the reader arriving
                from the index usually wants one of them. */}
            <SectionNav container={bodyEl} articleId={current.id} />
            {/* the index IS the summary here, so the article opens expanded */}
            <div ref={setBodyEl}>
              <AlwaysOpen.Provider value><ArticleBody id={current.id} /></AlwaysOpen.Provider>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MapView({ sel, setSel, list: all }: {
  sel: string; setSel: (id: string) => void; list: (Article & { note?: string })[];
}) {
  const [onlyBadged, setOnlyBadged] = useState(false);
  const [q, setQ] = useState("");
  const [node, setNode] = useState<string | null>(null);

  const byNode = useMemo(() => {
    const m = new Map<string, (Article & { note?: string })[]>();
    for (const a of all) for (const n of nodesForArticle(a)) {
      if (!m.has(n)) m.set(n, []);
      m.get(n)!.push(a);
    }
    return m;
  }, [all]);
  const badges = useMemo(() => {
    const m = new Map<string, number>();
    byNode.forEach((v, k) => m.set(k, v.length));
    return m;
  }, [byNode]);
  const needle = q.trim().toLowerCase();
  const lit = useMemo(() => {
    if (!needle) return null;
    const s = new Set<string>();
    for (const a of all) {
      if (`${a.title} ${a.subtitle ?? ""} ${a.kicker ?? ""}`.toLowerCase().includes(needle))
        for (const n of nodesForArticle(a)) s.add(n);
    }
    return s;
  }, [needle, all]);

  const nodeArticles = node ? byNode.get(node) ?? [] : [];
  const nodeMeta = node ? BY_ID.get(node) : null;
  const current = all.find(a => a.id === sel);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — matching nodes stay lit…"
          className="w-64 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none" />
        <button onClick={() => setOnlyBadged(v => !v)}
          className={`rounded border px-2 py-1 text-[10px] ${onlyBadged
            ? "border-slate-600 bg-slate-800 text-amber-400" : "border-slate-700 text-slate-400"}`}>
          {onlyBadged ? `Only the ${byNode.size} nodes with research` : "Full map"}
        </button>
        <div className="ml-auto"><FactorMapLegend /></div>
      </div>

      {/* The map is 1380 units wide and does not usefully shrink — the labels
          are already at 8.5px. Below ~1100px it scrolls, so say so rather than
          letting the exchange-economics half look like it does not exist. */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
        <FactorMap badges={badges} onlyBadged={onlyBadged} lit={lit}
          selected={node} onSelect={id => setNode(n => (n === id ? null : id))} />
      </div>
      <p className="text-[10px] text-slate-600 xl:hidden">
        ← scroll sideways for the exchange-economics side of the map
      </p>

      {nodeMeta && (
        <div className="rounded-lg border border-slate-800 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white">{nodeMeta.t}</span>
            <span className="text-[10px] text-slate-500">
              {nodeArticles.length} article{nodeArticles.length === 1 ? "" : "s"} bear on this node
            </span>
          </div>
          <div className="mt-2 divide-y divide-slate-800">
            {nodeArticles.map(a => (
              <button key={a.id} onClick={() => setSel(a.id)}
                className={`flex w-full items-baseline gap-2 py-1 text-left hover:bg-slate-900/60 ${
                  sel === a.id ? "text-amber-400" : ""}`}>
                <span className="truncate text-xs text-slate-200">{a.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600">{a.kicker}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {current && (
        <div className="min-w-0">
          {current.note && <EditorNote text={current.note} />}
          <AlwaysOpen.Provider value><ArticleBody id={current.id} /></AlwaysOpen.Provider>
        </div>
      )}
    </div>
  );
}

export default function ResearchView({ initialTab }: { initialTab?: Cat }) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "map">("list");
  // The five /research/<cat> routes still mean something: they preselect the
  // category filter. Without this the tab bar became decorative — every route
  // rendered the same unfiltered list of 45 and only differed in which article
  // happened to be open.
  const [cat, setCat] = useState<Cat | "all">(initialTab ?? "quant");
  // One selection shared by both views, so flipping between them keeps your
  // place instead of resetting to the top of the catalogue.
  const [sel, setSel] = useState<string>(
    () => ARTICLES.find(a => a.cat === (initialTab ?? "quant"))?.id ?? ARTICLES[0].id);

  const [overrides, setOverrides] = useState<OverrideMap>({});
  const isAdmin = useIsAdmin();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/research/overrides")
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.overrides) setOverrides(j.overrides); })
      .catch(() => { /* the source catalogue is a fine fallback */ });
    return () => { alive = false; };
  }, []);

  // What every surface reads: source values with any override laid on top.
  // Members may open Research now, so the "Admin & platform" category — run
  // telemetry, the ICE backfill control, workflow internals — is withheld
  // unless the cosmetic tier cookie says admin. Cosmetic is enough here: the
  // one write action in that category (/api/admin/ice-publish-time) verifies
  // the SIGNED cookie server-side, so forging `tierv` shows a form that 403s.
  const list = useMemo(
    () => applyOverrides(ARTICLES, overrides).filter(a => isAdmin || a.cat !== "admin"),
    [overrides, isAdmin]);
  const sourceArticle = ARTICLES.find(a => a.id === sel);

  function afterSave(id: string, ov: Override | null) {
    setOverrides(prev => {
      const next = { ...prev };
      if (ov) next[id] = ov; else delete next[id];
      return next;
    });
  }

  useEffect(() => {
    if (initialTab && initialTab !== cat) setCat(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // Picking a category rewrites the path so the view stays deep-linkable and
  // the browser Back button keeps working; "all" has no route of its own, so
  // it simply leaves the URL where it is.
  function pickCat(c: Cat | "all") {
    setCat(c);
    if (c !== "all") router.push(`/research/${c}`, { scroll: false });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-slate-700 p-0.5">
          {([["list", "List"], ["map", "Factor map"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`rounded px-3 py-1 text-xs transition-colors ${
                view === id ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-500">
          {view === "list"
            ? "index left, article beside it"
            : "browse the model — each node carries the research that bears on it"}
        </span>
      </div>

      {isAdmin && editing && sourceArticle && (
        <EditPanel article={sourceArticle} override={overrides[sel]}
          onSaved={afterSave} onClose={() => setEditing(false)} />
      )}

      {view === "list"
        ? <ListView sel={sel} setSel={setSel} cat={cat} setCat={pickCat} list={list}
                    editing={editing} onEdit={isAdmin ? () => setEditing(true) : undefined} />
        : <MapView sel={sel} setSel={setSel} list={list} />}
    </>
  );
}
