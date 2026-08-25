"use client";
import { Paper, H2, P, UL, LI, Code, Fml, Highlight } from "./prose";

export default function SupplyMethodology() {
  return (
    <Paper
      tone="lime"
      updated="2026-07-14"
      kicker="Supply · Methodology"
      title="Supply modelling — production estimates, balance sheets & export nowcasts"
      subtitle="How the app turns USDA, CONAB, CECAFE and customs data into a forward view"
    >
      <P>
        The unit throughout is the <strong>60-kg bag</strong> (USDA PSD&rsquo;s native unit; internally 1 thousand bags
        = 60 MT). Crop years differ by origin — Brazil and Indonesia run <strong>Apr–Mar</strong>, Colombia/Vietnam/Uganda{" "}
        <strong>Oct–Sep</strong> — so every series is bucketed to its origin&rsquo;s crop year before anything is compared.
      </P>

      <H2>1 · Brazil export projection — the daily nowcast engine</H2>
      <P>
        The single source of truth for every forward Brazil-export visual. It blends a 12-month crop-year curve from
        three segments and anchors the total to an annual target:
      </P>
      <UL>
        <LI><strong>Realised</strong> — months already published in CECAFE&rsquo;s monthly series are taken as actuals.</LI>
        <LI><strong>Certificados pace (nowcast)</strong> — the in-progress month is linearly paced from daily
          export-registration data: <Code>projected = round(cum_bags / ref_day × days_in_month)</Code>. It deliberately
          uses the <em>Certificados de Origem</em> track (not Embarques) because the historical monthly series is itself
          certificados-based — mixing counting bases would jitter the handoff.</LI>
        <LI><strong>Seasonality</strong> — the remaining budget is distributed across future months by last year&rsquo;s
          shape: <Code>share[m] = prior_year[m] / Σ prior_year[remaining months]</Code> (uniform 1/N fallback).</LI>
      </UL>
      <Fml>{`remaining_budget = annual_target − Σ realised − Σ certificados
month value      = round( remaining_budget × share[m] )

annual_target precedence:
  1. hand-set USDA GAIN seed (e.g. 49.07M bags = 45M green + 4M soluble + 0.07M roast)
  2. USDA PSD exports (mt × 1000 / 60)
  3. sum of prior crop year, else 40,000,000`}</Fml>
      <Highlight>
        <strong>The safeguard floor.</strong> If the running pace burns through the annual target
        (<Code>remaining_budget ≤ 0</Code>), the engine rebases the target to <Code>realised + certificados + Σ
        historical-min-for-month</Code> (the minimum of each remaining calendar month over the last five years), sets a{" "}
        <Code>safeguard_triggered</Code> flag and exits with an alert code. This stops a hot start from implying an
        absurd full-year number.
      </Highlight>

      <H2>2 · The balance-sheet card — PSD backbone + overlays</H2>
      <P>
        Every origin gets the same stacked supply/demand view built on USDA FAS PSD green-bean balances. Each year stacks
        Opening + Exports + Consumption + stock change; a purple <strong>production line floats above</strong> the stack —
        and the gap between them is meaningful: it is imports plus non-bean (roast/soluble) disappearance and
        adjustments, because PSD balances are green-bean only. Three overlays add nuance:
      </P>
      <UL>
        <LI><strong>Multi-source spread</strong> — production shown as <Code>avg (min–max)</Code> with an error bar across
          the source estimates.</LI>
        <LI><strong>Realised-exports override</strong> — customs totals override PSD&rsquo;s annual exports on complete
          crops; the in-progress crop splits into realised-YTD (solid) + forecast-remaining (striped).</LI>
        <LI><strong>Forecast row</strong> — Brazil appends the projection engine&rsquo;s number as a faded striped row.</LI>
      </UL>
      <Fml>{`equation strip:  Net Stocks = Production(avg) − Exports − Consumption     [million bags]`}</Fml>

      <H2>3 · Multi-source production estimates</H2>
      <P>
        Production is never a single number. Brazil carries USDA / CONAB / ICO; Colombia carries USDA / FNC / ICO. The
        <strong> USDA column is auto-synced</strong> from PSD (<Code>production_mt / 60,000</Code> = million bags); the
        others are <strong>hand-curated twice a year</strong> after USDA&rsquo;s June Annual and December Semi-Annual,
        with a drift-check that flags when they fall out of date. USDA persistently prints above CONAB (CONAB is a field
        survey; USDA includes adjustments) — the spread itself is the signal, so the model shows it rather than
        averaging it away.
      </P>

      <H2>4 · CECAFE nowcast & velocity</H2>
      <P>
        CECAFE&rsquo;s monthly export series (from 1990) feeds the realised segment; its <strong>daily</strong>
        registration files (Embarques and Certificados, split arabica/conillon/soluvel) feed the pace nowcast. The daily
        KPI compares month-to-date cumulative bags against the <em>same calendar day of the prior month</em> (nearest
        preceding day if missing). An export-velocity badge benchmarks the latest month against a{" "}
        <strong>median of the same calendar month over the last five years</strong>:
      </P>
      <Fml>{`velocity = (latest_month_total − 5yr_median_for_that_month) / 5yr_median × 100`}</Fml>

      <H2>5 · USDA PSD + GAIN ingestion</H2>
      <P>
        PSD&rsquo;s CSV (thousand 60-kg bags → MT) is the balance backbone for 10 producers and 9 consuming markets. PSD
        lacks forward-year forecasts, so the GAIN Coffee Annual PDFs supply them — and critically GAIN
        <strong> sums Bean + Soluble + Roast exports</strong> so the figure is directly comparable to CECAFE&rsquo;s total
        (this is why the Brazil seed is 45M green + 4M soluble + 0.07M roast = 49.07M). Forward balances use the identity:
      </P>
      <Fml>{`expected_total = opening + production − consumption
projected_gap  = max(0, expected_total − already_exported)
mode = "forecast" when a GAIN row exists, else "proxy" (latest realised row)`}</Fml>

      <H2>6 · StoneX Ethiopia — a static field-survey model</H2>
      <P>
        Ethiopia&rsquo;s production is not scraped — it is a hand-maintained <strong>StoneX field survey</strong> of five
        representative districts plus USDA/ECTA secondary data, stored as static research so the daily scraper can never
        overwrite it. It is bottom-up production-by-region in thousand bags, with a full S&amp;D balance
        (<Code>ending = opening + production − consumption − exports</Code>) and a forward year driven by Ethiopia&rsquo;s
        <strong> biennial on/off cycle</strong> (regions alternate high/low years). The analytical narrative — exports
        depressed by ~160% birr depreciation turning coffee into a currency hedge, and a structural −49% fall in domestic
        consumption — is carried alongside the numbers.
      </P>

      <H2>7 · Arabica by processing — washed vs natural</H2>
      <P>
        The world balance sheet states arabica in two legs because the trade prices them separately. Almost no source
        publishes that breakdown — Marex, ECOM, Sopex and USDA all give a country total — so the split is an
        <strong> analyst overlay</strong>, applied per origin from how the crop is actually processed and recorded in each
        seed&rsquo;s <Code>arabica_split_basis</Code> field so the reasoning travels with the number:
      </P>
      <P>
        <strong>100% natural</strong> — Brazil (dry and pulped-natural; priced as naturals).{" "}
        <strong>100% washed</strong> — Colombia, the MAG 6 (Honduras, Guatemala, Nicaragua, Costa Rica, Mexico, Peru),
        Indonesia (giling basah / semi-washed), Vietnam, China and Tanzania.{" "}
        <strong>Mixed</strong> — Ethiopia 30/70 washed/natural (Yirgacheffe and Limu against the Harrar, Sidama and Guji
        naturals), India 50/50 (Plantation vs Cherry), Uganda 65/35 (Bugisu washed against West Nile drugar, weighted by
        the arabica belts in the weather model). Ivory Coast is robusta only.
      </P>
      <P>
        Two guard-rails: the two legs are forced to sum to the original arabica figure, so restating can never move an
        origin&rsquo;s headline production; and the migration only ever touches a leg still filed as unsplit, so a real
        published breakdown or a hand edit in the ✎ editor is never overwritten by a convention. On the demand side,
        each consumption hub keeps its arabica total and carries a washed share reflecting that market — washed-skewed in
        North America, naturals-skewed in Latin America where Brazilian domestic demand dominates.
      </P>

      <H2>8 · Depth level 3 — grades on supply, formats on demand</H2>
      <P>
        Under each processing leg the statement carries a third level, collapsible from the sheet header
        (<strong>Ungroup all</strong> / <strong>Group all</strong>) or row by row. The two sides break down in
        different currencies on purpose.
      </P>
      <P>
        <strong>Supply — quality grades, in each origin&rsquo;s own vocabulary.</strong> Honduras sells SHG, HG and
        Standard; Vietnam sells G1, G2 and G3; Brazil sells fine cup, GC and Rio. Those ladders do not map onto one
        another, so nothing is harmonised and a grade row is only ever summed inside its own origin. An origin with no
        ladder filed for a leg shows that leg as one honest <Code>ungraded</Code> row rather than being dropped.
        Ladders live in <Code>origin_grades.json</Code>.
      </P>
      <P>
        <strong>Demand — the form the coffee is sold in.</strong> Each hub&rsquo;s leg splits across retail (ground,
        beans, soft pads, capsules, RTD drinks, instant pure, instant mixes) and the coffee shop. Unlike grades this
        <em> is</em> comparable across hubs, and it is where the legs diverge most: robusta carries the instant
        categories almost entirely, washed arabica concentrates in whole bean, capsules and out-of-home. Mixes live in
        <Code>demand_segments.json</Code>, with a global default and per-hub overrides where a market genuinely
        departs from it.
      </P>
      <P>
        Both levels are stored as <strong>shares of the parent leg, never bags</strong>. Production is derived and hub
        totals are entered, so a share keeps the detail re-summing to its parent and stops it drifting when the parent
        moves. Rounding to one decimal is done with a largest-remainder allocator, so a reader can add a column of
        children and land on the subtotal exactly rather than 0.1 away from it. Both are editable behind the same
        password as the rest of the sheet, under <strong>Grades &amp; segments</strong>, and every ladder and every
        column must total 100% before a save is accepted.
      </P>

      <H2>9 · World-consumption coverage</H2>
      <P>
        A coverage gauge sums tracked consumption across all PSD markets and compares it to a manually-maintained ICO
        global reference: <Code>tracked_vs_ICO% = tracked / ICO × 100</Code> (currently the model captures ~80% of world
        demand). Growth-market demand to 2050 is projected with the logistic/saturation ceiling model documented under{" "}
        <strong>Demand modelling</strong>.
      </P>

      <H2>Where it lives</H2>
      <P>
        Projection engine: <Code>backend/scraper/brazil_export_forecast.py</Code> → <Code>brazil_export_projection.json</Code>.
        Balance card: <Code>components/supply/SupplyDemandBalance.tsx</Code>; multi-source seeds in
        <Code>br_balance_sheet.json</Code> / <Code>co_balance_sheet.json</Code> (refreshed by
        <Code>build_balance_sheets.py</Code>). CECAFE: <Code>fetch_cecafe.py</Code>. PSD/GAIN:
        <Code>sources/psd_coffee.py</Code> + <Code>usda_gain_pdf.py</Code> → <Code>demand_stocks.json</Code>. StoneX:
        <Code>components/supply/ethiopia/stonexSurvey.ts</Code> (its crop-survey numbers are also filed into
        <Code>et_balance_sheet.json</Code> so the world aggregation sees the field survey, not only the desk
        estimates). Processing split: <Code>backend/scripts/split_arabica_processing.py</Code>. World statement:
        <Code>components/supply/WorldBalanceSheet.tsx</Code> + <Code>world_balance_sheet.json</Code>, edited through
        <Code>WorldBalanceEditor.tsx</Code> → <Code>apply_world_balance_edit.py</Code>. Rendered across the
        <strong>Supply</strong> tab&rsquo;s
        per-origin sub-tabs.
      </P>
    </Paper>
  );
}
