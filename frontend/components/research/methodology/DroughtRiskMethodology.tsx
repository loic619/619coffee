"use client";
import { Paper, H2, P, UL, LI, Code, Fml, Highlight, RefTable, DataFiles } from "./prose";

export default function DroughtRiskMethodology() {
  return (
    <Paper
      tone="cyan"
      updated="2026-07-30"
      kicker="Weather · drought model"
      title="Drought risk — how the SPI / SPEI / VHI stack works"
      subtitle="30-year calibrated SPI/SPEI z-scores, satellite cross-checks, and the backtested v3 alert ladder that decides when dryness becomes a market signal"
    >
      <P>
        Drought is coffee&rsquo;s <em>slow</em> weather trade — unlike frost it rarely reprices the market overnight,
        but it compounds: a flowering season that fails on moisture is next season&rsquo;s missing crop. The problem is
        that &ldquo;dry&rdquo; is meaningless without context — 60&nbsp;mm in a Dak Lak January is normal, 60&nbsp;mm in
        an August is a drought. The app&rsquo;s drought model therefore never reasons on raw rainfall. It converts every
        region&rsquo;s moisture state into <strong>standardized z-scores against its own 30-year climatology</strong>,
        cross-checks them against a satellite vegetation index, and only then lets a declarative rule set decide
        whether the situation is worth an alert.
      </P>

      <H2>1 · Where the data comes from</H2>
      <UL>
        <LI><strong>~35 growing regions, point-sampled</strong> — each origin is covered by coordinates placed in the
          heart of its producing areas (Brazil: Sul de Minas, Cerrado, Espírito Santo, Paraná; Vietnam: Dak Lak,
          Lam Dong, Gia Lai, Dak Nong; five regions each for Colombia, Honduras, Indonesia, Uganda, Ethiopia…).
          Region names are locked to the same admin units the satellite feed uses, so every layer of the stack talks
          about the same place.</LI>
        <LI><strong>Open-Meteo daily observations + 7-day forecast</strong> per region: precipitation, min/mean/max
          temperature, and <strong>FAO Penman-Monteith reference evapotranspiration (ET₀)</strong> — the demand side
          of the water balance.</LI>
        <LI><strong>A 30-year calibration archive (1995–2024)</strong> — monthly precipitation and ET₀ per region,
          built once from Open-Meteo&rsquo;s historical archive by a one-shot CI workflow and committed as static
          seeds (<Code>spi_30yr_baselines.json</Code> / <Code>spei_30yr_baselines.json</Code>). Live runs never touch
          the archive again: they compute indices from the seed plus the current months only, so the daily pipeline
          stays fast and can&rsquo;t silently drift if the archive host changes.</LI>
        <LI><strong>NOAA STAR Vegetation Health Index (VHI)</strong> — weekly, per admin province: a 0–100 blend of
          vegetation condition (VCI) and thermal condition (TCI) observed from satellite. It is the model&rsquo;s
          ground truth — independent of the meteorological chain entirely.</LI>
      </UL>

      <H2>2 · SPI — rainfall as a probability, not a millimetre count</H2>
      <P>
        The <strong>Standardized Precipitation Index</strong> asks: <em>how unusual is the rain this region has had,
        for this time of year, against its own 30-year record?</em> For a target month, precipitation is aggregated
        over the trailing 1 or 3 months, a <strong>gamma distribution is fitted to that same calendar
        month&rsquo;s</strong> calibration values (rain is skewed — gamma is the standard choice since McKee 1993),
        and the current value is mapped through the fitted CDF to a normal z-score. Dry months get explicit
        treatment: with <Code>q</Code> the fraction of zero-rain periods in calibration,
      </P>
      <Fml>{`H(x) = q + (1 − q) · G(x)          G = fitted gamma CDF
SPI  = Φ⁻¹( H(current) )             Φ⁻¹ = inverse normal`}</Fml>
      <P>
        so a rainless month in a region that is <em>sometimes</em> rainless maps to &ldquo;dry but unremarkable,&rdquo;
        while the same zero in a normally-wet month maps deep negative. Safety guards: at least 10 calibration
        observations and 4 non-zero values per calendar month, tail-clamping so the z-score can&rsquo;t blow up to ±∞,
        and rolling windows only form over <em>contiguous</em> months.
      </P>
      <RefTable head={["SPI / SPEI", "Reading"]} rows={[
        ["> +1.5", "unusually wet — the rust/fungal tail"],
        ["+1 … −1", "normal band"],
        ["< −1.0", "moderate drought"],
        ["< −1.5", "severe drought"],
        ["< −2.0", "extreme (≈ 1-in-40-year) drought"],
      ]} />

      <H2>3 · SPEI — adding the heat side of the equation</H2>
      <P>
        Rain is only half of soil moisture; the atmosphere&rsquo;s <em>demand</em> is the other half. The
        <strong> Standardized Precipitation-Evapotranspiration Index</strong> runs the same machinery on the climatic
        water balance <Code>D = P − ET₀</Code> instead of raw precipitation. Because D is real-valued and roughly
        symmetric (it goes negative whenever evaporative demand beats rain), each calendar month is fitted with a
        <strong> normal distribution</strong> rather than a gamma. The canonical Vicente-Serrano (2010) formulation
        prefers a 3-parameter log-logistic for slightly heavier tails; we deliberately trade that for robustness — the
        L-moment estimator is fragile on 30-point samples, the practical signal at the ±1/±1.5 thresholds is nearly
        identical, and the fit is isolated behind one function so the distribution can be swapped later.
      </P>
      <Highlight>
        <strong>Why both indices?</strong> SPI answers &ldquo;did it rain?&rdquo;; SPEI answers &ldquo;did the soil
        keep the water?&rdquo;. In a heat wave SPEI turns negative while SPI stays flat — exactly the mechanism of the
        modern hot-drought years. When the two agree the signal is robust; when they diverge, the divergence itself is
        the information.
      </Highlight>

      <H2>4 · Time scales &amp; phenology — when dryness actually matters</H2>
      <UL>
        <LI><strong>1-month scale</strong> (<Code>spi_1</Code>/<Code>spei_1</Code>) — flash dryness and wet extremes;
          fast to react, noisy, used mostly for the wet tail (rust conditions) and short-lived stress.</LI>
        <LI><strong>3-month scale</strong> (<Code>spi_3</Code>/<Code>spei_3</Code>) — the yield-relevant scale for a
          deep-rooted perennial: it approximates soil-moisture memory and filters single-month noise. Every drought
          alert rule keys off the 3-month index.</LI>
        <LI><strong>Phenology gating</strong> — a moisture deficit is not equally damaging year-round. The rule engine
          supports per-rule <Code>months</Code> and <Code>origins</Code> scopes so a rule can target flowering or
          cherry-fill windows for specific origins — the same phenology logic documented in Agronomy →
          &ldquo;When does rain become a supply shock?&rdquo;.</LI>
      </UL>

      <H2>5 · The IPHM rule layer (v3) — from index to alert</H2>
      <P>
        Indices don&rsquo;t page anyone. The <strong>IPHM (Integrated Plant Health Management) ruleset</strong> is a
        declarative table evaluated every run against each region&rsquo;s current values
        (<Code>spi_1/3</Code>, <Code>spei_1/3</Code>, <Code>vhi</Code>, <Code>tci</Code>, observed mean temp,
        forecast min temp, 7-day forecast rain, forecast hot-day count, the region&rsquo;s arabica production share,
        soil-moisture fraction). The v3 revision (Jul&nbsp;2026 threshold review) turned the single-cliff rules into
        <strong> severity ladders</strong> with <strong>persistence gates</strong> and <strong>hysteresis</strong>:
      </P>
      <RefTable head={["Family / tier", "Conditions", "Severity"]} rows={[
        ["Drought stress — early", "VHI ≤ 45 AND SPEI-3 ≤ −1.0, held ≥ 7 days", "watch"],
        ["Drought stress — established", "VHI ≤ 40 AND SPEI-3 ≤ −1.2, held ≥ 7 days", "alert"],
        ["Severe defoliation / bean shrinkage", "VHI ≤ 35 AND SPEI-3 ≤ −1.5, held ≥ 10 days", "critical"],
        ["Blossom drop (per-origin flowering windows)", "SPEI-3 ≤ −1.0 AND ≥ 50 mm rain forecast in 7d", "watch"],
        ["Fungal / leaf rust (arabica regions only)", "SPI-1 ≥ +1.5 AND temp 21–25 °C AND arabica share ≥ 25%", "alert"],
        ["Cherry-fill heat spell (BRA/VNM fill windows)", "≥ 4 forecast days ≥ 34 °C AND SPEI-1 ≤ −0.3", "alert"],
        ["Heat spell — satellite-confirmed", "…AND TCI ≤ 25", "critical"],
      ]} />
      <UL>
        <LI><strong>Ladders, not cliffs</strong>: only the highest tier that fires is published per region, so a
          building drought escalates watch → alert → critical instead of appearing from nothing. (The backtest below
          shows why this matters: Vietnam&rsquo;s flagship 2015-16 drought peaked at SPEI-3 −1.42 — under the old
          single critical cliff, it would never have alerted.)</LI>
        <LI><strong>Persistence &amp; hysteresis</strong>: conditions must hold continuously (7–10 days) before an
          alert publishes — drought is persistent by nature, flapping data is not — and the critical tier stays
          active until <em>both</em> recovery thresholds clear (VHI ≥ 40 and SPEI-3 ≥ −1.0), so one wet week
          can&rsquo;t silently clear a real event.</LI>
        <LI><strong>Two independent witnesses at every drought tier</strong>: the met-model water balance
          <em> and</em> the satellite canopy read. Neither alone fires — the model&rsquo;s main false-positive
          defence.</LI>
        <LI><strong>Phenology scoping is now enforced</strong>: blossom-drop runs only inside each origin&rsquo;s
          flowering window (Brazil Aug–Nov, Vietnam Jan–Apr, Colombia&rsquo;s two passes, Honduras Mar–May,
          Ethiopia Feb–Apr, Uganda&rsquo;s bimodal rains) — the drought-then-sudden-rain sequence is meaningless
          outside it.</LI>
        <LI><strong>Rust is arabica-only</strong>: <em>Hemileia vastatrix</em> barely touches robusta, so the rule
          now requires the region to actually grow arabica (per-region production splits where published,
          origin-level shares otherwise). Pure-robusta regions can no longer false-fire.</LI>
        <LI><strong>Heat stress is new</strong>: sustained forecast ≥34 °C days during the bean-fill window on a
          dry balance — the mechanism SPEI only catches indirectly — with the satellite thermal index (TCI) as the
          escalating second witness.</LI>
        <LI><strong>Vietnam is irrigation-aware</strong>: drought severities there are conditioned on the NCHMF
          river/reservoir bulletin — flows ≤ −30% vs normal escalate one tier (the irrigation buffer is thin);
          near-normal flows cap severity at alert (the buffer absorbs the met-drought).</LI>
        <LI><strong>Frost is deliberately NOT here</strong> — it moved to a per-region physical model (radiative vs
          advective, duration, black frost); see Weather → Frost risk.</LI>
      </UL>

      <H2>6 · Calibration — the thresholds are backtested, not hand-set</H2>
      <P>
        The ladder numbers are replayed against the full <strong>1995–2024 seeds</strong> (12,172 region-months,
        SPEI-3 met-leg, in-sample) by <Code>backend/scripts/backtest_drought_alerts.py</Code>, which commits its
        evidence to <Code>drought_backtest_report.json</Code>:
      </P>
      <UL>
        <LI><strong>Base rates are calibrated</strong>: the met legs mark 16.3% / 11.5% / 5.4% of region-months at
          the watch/alert/critical thresholds vs 15.9% / 11.5% / 6.7% theoretical — the distribution fits are doing
          their job. Published alerts are far rarer: the VHI conjunction and the persistence gates sit on top.</LI>
        <LI><strong>All six benchmark droughts fire</strong> at the alert leg: Brazil 2014 (min SPEI-3 −2.86,
          Sul de Minas) and 2020-21 (−2.14, Paraná), Vietnam 2015-16 (−1.42, Dak Nong), Central America 2019
          (−1.83, El Paraíso), Ethiopia 2015-16 (−1.71, Harrar), Indonesia 2015 (−1.58, Toraja).</LI>
        <LI><strong>The Vietnam case justifies the ladder</strong>: its worst modern drought never reached the
          critical met-leg (−1.42 vs −1.5) — a critical-only rule would have stayed silent through the country&rsquo;s
          defining supply event. The alert tier catches it; VHI and the reservoir conditioning carry the
          escalation.</LI>
        <LI><strong>Persistence gates are safe</strong>: half of all critical-leg episodes last ≥ 2 months (max 20
          months) — day-scale persistence windows suppress flapping without eating real events.</LI>
      </UL>

      <H2>7 · Design choices &amp; honest limits</H2>
      <UL>
        <LI><strong>Z-scores are the whole point</strong>: SPI −1.8 in Dak Lak and SPI −1.8 in Sul de Minas are the
          same statistical rarity, so regions, seasons and origins compare on one scale — that is what lets one rule
          set serve every origin.</LI>
        <LI><strong>Point sampling, not gridded averages</strong> — one representative coordinate per producing zone.
          Cheap, transparent, and adequate at the 1–3-month scales the model trades on; it will under-represent
          intra-region variance in mountainous origins (Colombia, Ethiopia).</LI>
        <LI><strong>ET₀ is a demand proxy, not a soil model</strong> — there is no explicit soil-moisture bucket or
          runoff model. A satellite surface soil-moisture fraction now rides along in the field catalogue and the
          Vietnamese reservoir bulletin conditions VN severities, but a full water-balance bucket remains future
          work. SPEI-3 is the pragmatic stand-in.</LI>
        <LI><strong>VHI is admin-level</strong> — a province average can hide a stressed micro-region; conversely it
          catches irrigation and soil effects the met chain can&rsquo;t see. That complementarity is why the critical
          rule demands both.</LI>
        <LI><strong>Drought pays with a lag in a perennial crop</strong> — the P&amp;L of a flowering-window drought
          arrives one season later. The alert is the <em>early</em> signal; the yield translation belongs to the
          Farmer-economics stress models and the supply balance sheets, which consume these same indices.</LI>
        <LI><strong>Fixed 1995–2024 calibration</strong> — a stable 30-year normal (standard practice). In a warming
          trend a fixed window slowly makes &ldquo;hot droughts&rdquo; look more extreme, which for a risk monitor is
          the conservative direction; the seeds can be rebuilt by re-running the one-shot workflow.</LI>
      </UL>

      <H2>Where it lives</H2>
      <P>
        Indices: <Code>backend/scripts/spi_calc.py</Code> / <Code>spei_calc.py</Code> (pure math), fed by{" "}
        <Code>fetch_origin_weather.py</Code> (regions, Open-Meteo pulls, seed + current-month orchestration) with
        30-year seeds built by the one-shot <Code>build-spi-baselines</Code> / <Code>build-spei-baselines</Code>{" "}
        workflows. Satellite: <Code>scraper/vhi.py</Code> (NOAA STAR weekly VHI per province). Rules:{" "}
        <Code>scraper/rules/iphm_thresholds.py</Code> evaluated by <Code>scraper/agronomic_alerts.py</Code>, which
        publishes to the map&rsquo;s agronomic ticker, the signals feed and the morning brief. Front-end surfaces:
        the per-origin weather charts (SPI/SPEI ramps), the map ticker and the supply-page weather panels.
      </P>
      <DataFiles files={["agronomic_alerts.json", "vhi_brazil.json", "brazil_weather.json"]} />
    </Paper>
  );
}
