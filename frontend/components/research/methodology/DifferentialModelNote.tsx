"use client";
import { Paper, H2, H, P, UL, LI, Code, Fml, Highlight, RefTable, DataFiles } from "./prose";
import { FactorMapFigure, CorridorFigure } from "./DifferentialModelFigures";
import FactorMap, { FactorMapLegend } from "../factor-map/FactorMap";

export default function DifferentialModelNote() {
  return (
    <Paper
      tone="sky"
      updated="2026-08-10"
      kicker="Differential · model specification"
      title="The Differential Model — a research note"
      subtitle="Formalizing the full factor map — supply, demand, exchange economics and positioning — into one estimable model of an origin's differential"
    >
      <P>
        <strong>Abstract.</strong> The differential — the spread between an origin&rsquo;s physical price and its
        exchange reference — is the number this entire platform ultimately orbits. This note takes the complete
        factor map (the four interacting clusters feeding <em>Futures Price</em>, <em>Supply &amp; Demand</em> and
        <em> Exchange Economics</em>, which jointly resolve into the <em>Differential</em>) and turns it into a
        formal, estimable model. The central thesis: <strong>the differential is a bounded process living inside an
        arbitrage corridor</strong> whose <em>walls</em> are set by exchange economics, whose <em>position within
        the walls</em> is set by the physical supply/demand balance, and whose <em>short-run dynamics</em> are
        dominated by the futures leg — because positioning moves the reference price faster than the physical
        market re-prices. Each box of the map is given a variable, an equation and a data source; where the data
        does not yet exist, that is stated. This is the academic groundwork; implementation in the app follows it.
      </P>

      <H2>1 · The object</H2>
      <P>
        For origin-grade <Code>o</Code> at time <Code>t</Code>, the differential is
      </P>
      <Fml>{`D_o(t) = P_o(t) + FOB_o(t) − F(t)

P_o    physical price at origin, USD/MT  (ticker: VN FAQ, CON T7, UGA S15…)
FOB_o  origin→vessel cost stack          (Origin-logistics research)
F      nearby futures reference          (RC for robusta, KC for arabica)`}</Fml>
      <P>
        This is exactly the <Code>differential</Code> column the tender-parity pipeline already persists daily per
        origin. A negative <Code>D</Code> means the origin offers a discount to the exchange; a positive one, a
        premium. The modelling question is not &ldquo;where is the coffee price going&rdquo; — it is: <strong>what
        makes this spread move, by how much, and with what lead-lag structure?</strong>
      </P>

      <H2>2 · From map to model — the corridor thesis</H2>
      <P>
        The factor map is a directed graph: four clusters converge on three intermediate nodes (futures price,
        physical S&amp;D, exchange economics) which resolve into the differential. Reading it as an economist
        rather than as a diagram, the three intermediate nodes play <em>different mathematical roles</em>:
      </P>
      {/* The map itself. Until 2026-08 this note described a chart it never
          showed: the only figure was the four-cluster-box abstraction below,
          which summarises the map rather than being it. This is the real one —
          every factor at its own position, the diamond intact — and it is the
          SAME component the research index renders with per-node badges, so
          the two cannot drift. */}
      <figure className="my-4">
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <figcaption className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Fig. 1 — the factor map
          </figcaption>
          <span className="text-[10px] text-slate-500">
            every factor, at its position in the model; the diamond resolves futures price, physical
            supply &amp; demand and exchange economics into the differential
          </span>
          <span className="ml-auto"><FactorMapLegend /></span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/40">
          <FactorMap />
        </div>
      </figure>
      {/* Kept as Fig. 1b: the boxed summary is still the better read for the
          four-cluster argument the prose makes next. */}
      <FactorMapFigure />
      <UL>
        <LI><strong>Exchange economics defines the walls.</strong> If <Code>D</Code> falls below the tenderable
          parity boundary, tendering into the exchange becomes the best bid (grade it, deliver it); if it rises
          above the replacement/import-parity boundary, destination buyers switch origins or draw destination
          stocks. Both are <em>arbitrages</em> — slow, costly, frictionful, but real. They bound the process.</LI>
        <LI><strong>Physical S&amp;D sets the position between the walls.</strong> Crop size, farmer retention,
          visible stocks and consumption determine how much selling or buying pressure the differential must
          absorb — continuously, not at the boundaries.</LI>
        <LI><strong>The futures leg drives the high-frequency dynamics.</strong> <Code>D = physical − futures</Code>:
          when positioning shocks move <Code>F</Code> in hours while <Code>P_o</Code> re-prices in days, the
          differential mechanically absorbs the shock and then mean-reverts as the physical side catches up. The
          positioning cluster therefore predicts the <em>transitory</em> component of <Code>D</Code>.</LI>
      </UL>
      <Fml>{`D_o(t) = TP_o(t) + [ RP_o(t) − TP_o(t) ] · σ( z_o(t) )  +  ε_o(t)

TP_o   lower wall: tenderable parity      (exchange-delivery arbitrage)
RP_o   upper wall: replacement parity     (destination substitution)
σ(·)   logistic position-in-corridor
z_o    flow-pressure index  = β′ X_o(t)   (S&D block + positioning block + macro)
ε_o    transitory basis shock — the futures-leg overshoot, mean-reverting`}</Fml>
      <CorridorFigure />
      <Highlight>
        Everything on the map lives somewhere in this equation: exchange-economics boxes build <Code>TP</Code> and
        <Code> RP</Code> (and a squeeze overlay that temporarily bends the walls), supply and demand boxes build
        <Code> X</Code>, the positioning cluster builds <Code>ε</Code>&rsquo;s innovation process, and macro enters
        both <Code>F</Code> and the currency terms of <Code>P_o</Code>.
      </Highlight>

      <H2>3 · Pillar I — Supply (the blue cluster)</H2>
      <H>3.1 The crop identity: four factors, one production number</H>
      <P>
        The map resolves the green-bean crop into <strong>four factors with closed units</strong> — hectares, trees
        per hectare, cherry per tree, and the cherry→green conversion ratio; the first three multiply and the
        fourth divides:
      </P>
      <Fml>{`Crop_green(y) =  Acreage × Density × Yield_cherry
                 ─────────────────────────────────
                          Conversion

Acreage       hectares planted            ← E[profit] vs competing crops  [slow, years]
Density       trees per hectare           ← tree age (dashed), replanting choices
Yield_cherry  kg of cherry per tree       ← weather · fertilizer · irrigation | tree age
Conversion    kg of cherry per 1 kg of green bean  ← harvest timing → ripe-cherry ratio
              (≈5–6:1 fresh cherry → green; HIGHER ratio = worse outturn = less green)`}</Fml>
      <P>
        Upstream of the decision factors sits the map&rsquo;s economic test: <strong>cost of production</strong> and
        the <strong>benchmark of other crops</strong> (pepper, durian, cocoa compete for Vietnamese land) form
        <strong> expected profitability</strong>, which is then <em>matched — or not — against the pre-harvest
        market price</em>. That match/no-match verdict works twice: it drives <strong>acreage allocation</strong>
        on the slow clock (plant, maintain, or switch crops), and it colours the coming season&rsquo;s intensity of
        care (fertilizer application, harvest effort) on the fast clock. The deeper sub-drivers the map implies are
        made explicit here: <strong>fertilizer ← fertilizer prices</strong> (the cost-push paper), and
        <strong> irrigation ← water availability</strong> (weather, reservoirs) <strong>and irrigation
        infrastructure availability</strong> — Vietnam&rsquo;s dry-season pumping is bounded by both.
        <strong> Tree age</strong> interacts with acreage <em>and</em> density as the dashed slow/structural state:
        an ageing orchard yields less at constant acreage and forces the replant-vs-switch decision that loops back
        into acreage.
      </P>
      <P>
        Instrumentation: rain→yield curves, the drought/SPI-SPEI stack, fertilizer costs, farmer-economics
        break-evens and supply balance sheets are live; <strong>tree-age structure</strong> and
        <strong> competing-crop margins</strong> are the genuinely missing (slow) inputs, flagged in the roadmap.
      </P>
      <H>3.2 The conversion channel: timing, ripeness, outturn — and grade</H>
      <P>
        <strong>Early dry weather or late rains → early/late harvest → ripe-cherry ratio → conversion
        ratio</strong>: the fourth factor of the crop identity. Harvest timing shifts the ripe-cherry share; the
        ripeness mix sets how many kilograms of cherry are needed for one kilogram of green — so a timing shock
        raises the divisor and cuts the <em>production number itself</em>, even off an unchanged cherry crop. It then cuts a second
        time on the grade axis: because the differential is quoted for a specific grade (FAQ, S15, T7…), a
        worsened (higher) conversion ratio also shifts supply <em>between grades</em> — less of the quoted grade, more
        triage. Instrumented today only indirectly (harvest-progress notes, weather timing); a ripe-cherry /
        screen-size distribution feed is future work.
      </P>
      <H>3.3 Farmer&rsquo;s stock — the retention function</H>
      <Fml>{`Sales_o(t) = h( price vs reference,  financing cost,  storage capacity )

"farmers like the price"  → reference-dependent selling: sales accelerate above the
                             farmer's anchor (recent highs / break-even multiple)
"farmers financing"       → carry cost of holding: local rates, cash needs, crop credit`}</Fml>
      <P>
        This is the map&rsquo;s behavioural heart, and the app already models it (farmer-selling model,
        break-evens, VN local rates). Retention withholds supply from the differential <em>today</em> at the cost
        of overhang <em>later</em> — an intertemporal term the model captures by carrying farmer-stock estimates
        as a state variable feeding <strong>visible origin stocks</strong> and <strong>destination stocks</strong>
        (the observability cascade: farm → origin warehouse → afloat → destination — each step more visible, each
        step already partially fed by our exports/afloat/ECF data).
      </P>

      <H2>4 · Pillar II — Demand (the green cluster)</H2>
      <P>
        The demand chain runs from culture to cups: <strong>coffee culture</strong> (fed back by
        <strong> inflation, wages, purchasing power</strong> — the CPI research) shapes the
        <strong> product mix</strong>, which fixes <strong>grams per cup</strong> and <strong>cups per
        capita</strong>; with <strong>population growth</strong> that integrates to <strong>consumption</strong>;
        consumption splits into <strong>destination</strong> demand (roaster buying, where stocks sit) and
        <strong> origin</strong> demand (domestic consumption — Brazil and Ethiopia drink their own crop).
      </P>
      <UL>
        <LI><strong>The blend node is the cross-differential switch</strong>: when arabica gets expensive relative
          to robusta, roasters push robusta share up — demand migrates <em>between</em> differentials. Blend
          share is therefore a coupling term between the KC and RC complexes (and between origins within each),
          proxied today by the arb/rob ratio and import mixes; the map&rsquo;s &ldquo;implied blend&rdquo; box on
          the positioning side estimates the same object from hedging flows.</LI>
        <LI><strong>Purchasing power enters twice</strong> — once here (demand volume, trade-down between
          blends/qualities) and once in macro (importer-currency strength). The CPI/HICP paper documents the
          measurement; the S-curve demand models give the volume elasticities.</LI>
        <LI><strong>Destination vs origin demand matters for the differential specifically</strong>: destination
          stocks are a buffer that lets buyers strike; origin demand removes exportable surplus at source. Same
          tonnes, opposite differential sign.</LI>
      </UL>

      <H2>5 · Pillar III — Exchange economics (the corridor walls)</H2>
      <H>5.1 The lower wall — tenderable parity</H>
      <P>
        Fully instrumented: <Code>TP = FOB + freight + port transport + rent + loading-out + allowances</Code>,
        the confirmed $58/t adder stack, persisted daily per origin. The map&rsquo;s <strong>logistic cost,
        premium/discount, warehousing cost</strong> boxes are its inputs; <strong>structure</strong> (the futures
        curve — carry pays the warehouse, backwardation punishes it) tilts the <em>effective</em> parity;
        <strong> coffee afloat to grading ports</strong> is the arbitrage in transit — the observable flow that
        proves the wall is binding (our parity→inflow event study measures exactly this).
      </P>
      <H>5.2 The three motivations — when the walls move</H>
      <UL>
        <LI><strong>Motivation to grade</strong> — the plain arbitrage above. Driven by parity gap and structure;
          measured by gradings volume.</LI>
        <LI><strong>Motivation to squeeze</strong> — the map&rsquo;s most adversarial box: <strong>stocks volume
          </strong> (small certified pool = cheap to corner), <strong>position limits</strong> (the legal
          ceiling), <strong>OI repartition</strong> (who holds the open interest — the September X-ray&rsquo;s
          single-contract cohort read is precisely this input), and <strong>new rules</strong> (EUDR transition
          allowances re-pricing old certs). A squeeze temporarily <em>bends the walls</em>: nearby futures spike,
          differentials of tenderable origins compress, structure inverts — the model treats it as a regime
          overlay near notice periods, flagged by the commercial-flip tell (15-for-15 on warrant flow).</LI>
        <LI><strong>Motivation to stop coffee</strong> (take delivery off warrant) — <strong>expected commercial
          value</strong> vs <strong>expected discount</strong> from <strong>ageing and quality</strong> (the
          rulebook&rsquo;s age allowances — documented in Contract Rules), plus <strong>poison pill</strong>
          features (certs nobody wants: old crop, odd locations, EUDR-noncompliant). Stopping drains the
          certified pool, shrinking the buffer that anchors the lower wall.</LI>
      </UL>
      <H>5.3 The upper wall — replacement parity</H>
      <P>
        Least instrumented of the three. <Code>RP</Code> = the cost at which a destination buyer replaces this
        origin with the next-best substitute (other origin differential + quality adjustment + logistics delta)
        or draws destination stock. Today we can proxy it from cross-origin differentials and the
        destination-in-store cost stacks; a proper substitution matrix (who can replace whom, at what discount,
        with what certification constraints) is roadmap work.
      </P>

      <H2>6 · Pillar IV — Futures price &amp; positioning (the yellow cluster)</H2>
      <P>
        The reference leg. The map decomposes it into three questions the app already asks weekly, plus one it
        does not yet:
      </P>
      <UL>
        <LI><strong>Who is in the market?</strong> — identification of market makers and counterparties via
          <strong> Shapley-Owen</strong> decompositions (attributing price variance to cohorts),
          <strong> radial</strong> positioning analysis, <strong>roaster/producer coverage</strong> ratios (how
          hedged is the trade), and the <strong>implied blend</strong> read off hedging flows. Partially covered
          by the COT stack (cohort splits, September X-ray); the formal variance-attribution econometrics are new
          work and honestly the most speculative box on the map.</LI>
        <LI><strong>What is the market&rsquo;s state and feeling?</strong> — option curve (skew/vol), non-directional
          sentiment, positioning risk &amp; conviction → the intraweek nowcast + news-sentiment stack.</LI>
        <LI><strong>What will funds do next?</strong> — trading signals (positioning mismatch, OB/OS, dry powder),
          funds&rsquo; motivation to adjust (performance, risk premia, CTA model triggers, potential change
          speed). Covered by the signal engine and COT analytics; CTA-replication is partial.</LI>
        <LI><strong>Macro</strong> — <Code>E.CY</Code>/<Code>I.CY</Code> (exporter and importer currencies — the
          Coffee Currency Index), purchasing power, CPI/wages/rates. A BRL or VND move re-prices the farmgate leg
          of <Code>D</Code> overnight without any physical event: currency is the single fastest structural mover
          of differentials and is fully instrumented.</LI>
      </UL>
      <Highlight>
        The transmission asymmetry is the testable claim: positioning shocks should move <Code>F</Code> within
        hours and <Code>D</Code> inversely on impact, with <Code>D</Code> reverting over days as physicals
        re-quote. If true, the positioning cluster forecasts the <em>sign of the next differential move</em>
        even when it says nothing about the physical balance. This is Phase-1 testable with data we already hold
        (daily differentials since 2023 × the COT/nowcast stack).
      </Highlight>

      <H2>7 · Factor coverage — every box, its variable, its status</H2>
      <RefTable head={["Map factor", "Model variable / feed", "Status"]} rows={[
        ["Weather / fertilizer / irrigation → tree yield", "SPI·SPEI·VHI stack; rain→yield curves; fertilizer costs", "live"],
        ["Tree age · density · acreage · other-crop margins", "state variables of the crop equation", "missing (slow data)"],
        ["Early/late harvest → ripe cherry → conversion", "grade-mix supply shock", "partial (indirect)"],
        ["Cost of production / expected profitability", "farmer-economics break-evens", "live"],
        ["Farmer's stock · financing · 'likes the price'", "retention function h(·); farmer-selling model", "live"],
        ["Visible origin stocks / destination stocks", "stock cascade states; ECF/port/afloat feeds", "partial"],
        ["Culture → product mix → grams·cups·blend·population", "S-curve demand models; blend share", "partial"],
        ["Inflation / wages / purchasing power", "CPI & HICP feeds (see CPI paper)", "live"],
        ["Logistic · warehousing cost · premium/discount", "TP inputs — the $58/t adder stack", "live"],
        ["Tenderable parity / structure / coffee afloat", "TP_o(t) daily; curve structure; parity→inflow study", "live"],
        ["Stocks volume · position limits · OI repartition", "certified stocks; Sept X-ray cohort read", "live"],
        ["New rules · poison pill · ageing → expected discount", "EUDR allowances; age-allowance schedule (Contract Rules)", "live (rules), partial (cert-level)"],
        ["Motivation to squeeze / stop (spread)", "squeeze-regime overlay; commercial-flip tell", "partial"],
        ["Replacement parity (upper wall)", "cross-origin substitution matrix", "missing"],
        ["Shapley-Owen · radial · counterparty ID", "variance attribution by cohort", "missing (research)"],
        ["Roaster/producer coverage · implied blend", "hedging-coverage ratios", "partial"],
        ["Option curve · sentiment · conviction", "vol/skew; news-sentiment; intraweek nowcast", "live"],
        ["Mismatch · OB/OS · dry powder · CTA · risk premia", "signal engine + COT analytics", "live/partial"],
        ["E.CY / I.CY · CPI · rates", "Coffee Currency Index; macro feeds", "live"],
      ]} />

      <H2>8 · Estimation &amp; validation protocol</H2>
      <UL>
        <LI><strong>Data depth</strong>: daily per-origin differentials + parity walls since 2023-05 (Vietnam,
          738+ rows; Conilon and Uganda shorter) — enough for the Phase-1 error-correction estimates; the corridor
          parameters (<Code>β</Code>, reversion speed <Code>α</Code>) are origin-specific.</LI>
        <LI><strong>Form</strong>: an error-correction model around the corridor —
          <Code> ΔD(t) = α·[D(t−1) − D*(t−1)] + γ′·ΔX(t) + δ′·Pos(t) + u(t)</Code> with
          <Code> D*</Code> the corridor-implied level. Squeeze regime as a state (notice-period windows ×
          commercial-flip × stocks-volume), estimated as an overlay rather than forced into the linear core.</LI>
        <LI><strong>Walk-forward only</strong>: expanding-window refits, no look-ahead in any feed (every input
          above is already published on a dated pipeline — the discipline this platform is built on).</LI>
        <LI><strong>Benchmarks to beat</strong>: (i) random walk in <Code>D</Code>; (ii) corridor-midpoint
          reversion with no covariates; (iii) currency-only model. Metrics: MAE in USD/MT at 1w/4w/8w horizons +
          direction hit-rate; report per origin with n, honestly gated like the parity→inflow study (the model
          panel should show &ldquo;accumulating&rdquo; until an origin&rsquo;s history supports its claims).</LI>
      </UL>

      <H2>9 · Implementation roadmap (for the app, after this note)</H2>
      <UL>
        <LI><strong>Phase 1 — corridor nowcast</strong>: assemble <Code>D</Code>, <Code>TP</Code>, proxy
          <Code> RP</Code>, currency, farmer-selling and stock states into one daily per-origin frame (nearly all
          columns exist); fit the ECM; publish predicted vs realized with the walk-forward record pattern used by
          the open-direction model.</LI>
        <LI><strong>Phase 2 — positioning transmission</strong>: add the futures-leg innovation process (nowcast,
          signals, OI repartition) and test the transmission-asymmetry hypothesis; add the squeeze overlay.</LI>
        <LI><strong>Phase 3 — structure</strong>: close the missing boxes — tree-age/acreage states, competing-crop
          margins, substitution matrix for <Code>RP</Code>, grade-mix (conversion-ratio) feed, cohort variance
          attribution — each as its own dated research addition.</LI>
      </UL>

      <H2>10 · Limits, stated up front</H2>
      <UL>
        <LI>The corridor walls are <em>estimated costs</em>, not laws — parity uses our confirmed adders, but real
          arbitrage capacity (finance lines, vessel space, EUDR paperwork) throttles how hard the walls bind.</LI>
        <LI>Several map boxes are structurally slow (tree age, culture) — they belong to the model&rsquo;s state,
          not its weekly signal, and must not be over-fit to short histories.</LI>
        <LI>Differential history is short (2023→). Until cycles accumulate, the model&rsquo;s claims must stay
          gated per origin — direction and mechanism first, point precision later.</LI>
        <LI>The squeeze regime is adversarial and partially unobservable (position limits and repartition are seen
          only through COT granularity); the overlay flags conditions, it does not predict intent.</LI>
      </UL>

      <H2>Lineage &amp; references</H2>
      <P>
        Internal: Origin Logistics (FOBbing), Tender Parity (corridor floor + event study), September X-ray
        (OI repartition), Contract Rules &amp; RC Delivery (allowances, delivery mechanics), Drought/Yield/ENSO
        stack (crop), Farmer Economics &amp; Farmer Selling (retention), Demand S-curves, CPI paper (purchasing
        power), Currency Index (E.CY/I.CY), COT/Signals stack (positioning). External anchors: Working (1949) and
        Brennan (1958) on the price of storage; Garbade &amp; Silber (1983) on cash-futures linkage; Pirrong on
        delivery squeezes and market-power manipulation; USDA/ICO structures for consumption accounting.
      </P>
      <DataFiles files={["origin_prices_history.json", "tender_parity_history.json", "futures_price_history.json"]} />
    </Paper>
  );
}
