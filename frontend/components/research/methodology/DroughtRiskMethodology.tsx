"use client";
import { Paper, H2, P, UL, LI, Code, Fml, Highlight, RefTable } from "./prose";

export default function DroughtRiskMethodology() {
  return (
    <Paper
      tone="cyan"
      updated="2026-07-22"
      kicker="Weather · drought model"
      title="Drought risk — how the SPI / SPEI / VHI stack works"
      subtitle="From 30-year calibrated rainfall z-scores to the IPHM alert rules that decide when dryness becomes a market signal"
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

      <H2>5 · The IPHM rule layer — from index to alert</H2>
      <P>
        Indices don&rsquo;t page anyone. The <strong>IPHM (Integrated Plant Health Management) ruleset</strong> is a
        declarative table evaluated every run against each region&rsquo;s current values
        (<Code>spi_1/3</Code>, <Code>spei_1/3</Code>, <Code>vhi</Code>, observed mean temp, forecast min temp,
        7-day forecast rain). Each rule is a conjunction of thresholds with a severity tier
        (<Code>watch</Code> → <Code>alert</Code> → <Code>critical</Code>) and a plain-language market impact. The
        drought-side rules:
      </P>
      <RefTable head={["Rule", "Conditions", "Severity"]} rows={[
        ["Severe defoliation / bean shrinkage", "VHI ≤ 35 AND SPEI-3 ≤ −1.5", "critical"],
        ["Flowering disruption / blossom drop", "SPEI-3 ≤ −1.0 AND ≥ 50 mm rain forecast in 7d", "watch"],
        ["Fungal / leaf-rust outbreak (wet tail)", "SPI-1 ≥ +1.5 AND mean temp 21–25 °C", "alert"],
      ]} />
      <UL>
        <LI><strong>The critical rule needs two independent witnesses</strong>: a met-model drought (SPEI-3 deep
          negative) <em>and</em> the satellite seeing stressed vegetation (VHI ≤ 35, its drought bin being &lt; 40).
          Neither alone fires it — that conjunction is the model&rsquo;s main false-positive defence.</LI>
        <LI><strong>Blossom-drop encodes a sequence, not a level</strong>: drought first, sudden heavy rain next — the
          classic false-flowering setup. Reading it needs both the state (SPEI-3) and the forecast, which is why the
          forecast lives inside the index feed.</LI>
        <LI><strong>The same engine polices both tails</strong> — extreme wet (rust) and extreme dry come from one
          machinery, so severities are comparable across threat types.</LI>
        <LI><strong>Frost is deliberately NOT here</strong> — it moved to a per-region physical model (radiative vs
          advective, duration, black frost); see Weather → Frost risk. A single generic threshold was too crude for a
          tail risk of that size.</LI>
      </UL>

      <H2>6 · Design choices &amp; honest limits</H2>
      <UL>
        <LI><strong>Z-scores are the whole point</strong>: SPI −1.8 in Dak Lak and SPI −1.8 in Sul de Minas are the
          same statistical rarity, so regions, seasons and origins compare on one scale — that is what lets one rule
          set serve every origin.</LI>
        <LI><strong>Point sampling, not gridded averages</strong> — one representative coordinate per producing zone.
          Cheap, transparent, and adequate at the 1–3-month scales the model trades on; it will under-represent
          intra-region variance in mountainous origins (Colombia, Ethiopia).</LI>
        <LI><strong>ET₀ is a demand proxy, not a soil model</strong> — there is no explicit soil-moisture bucket, no
          irrigation adjustment (parts of the Vietnamese basins are irrigated: reservoir levels are tracked separately
          in the supply pages), and no runoff. SPEI-3 is the pragmatic stand-in for all three.</LI>
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
    </Paper>
  );
}
