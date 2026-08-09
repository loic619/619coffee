"use client";
import { Paper, H2, P, UL, LI, Code, Highlight, RefTable } from "./prose";

export default function CpiMethodology() {
  return (
    <Paper
      tone="emerald"
      updated="2026-08-09"
      kicker="Macro · CPI"
      title="CPI, decoded — US CPI vs Eurozone HICP"
      subtitle="How each index is actually built, where European countries genuinely differ, what gets published at what detail — and the coffee series hiding inside both"
    >
      <P>
        Inflation prints move the two currencies that price every bag of coffee we track — the dollar the market
        quotes in, the euro the biggest consuming bloc pays in — and they carry, buried in their item detail,
        an official monthly measurement of <strong>retail coffee prices</strong> on both sides of the Atlantic.
        Before wiring CPI deeper into the dashboard, this paper pins down what these indexes really are: the two
        measurement machines are <em>not</em> the same, and the differences are large enough to matter whenever
        US and European numbers are compared.
      </P>

      <H2>1 · US CPI — one statistical agency, one survey machine</H2>
      <P>
        The US Consumer Price Index is produced by the <strong>Bureau of Labor Statistics</strong>. The headline
        series is <strong>CPI-U</strong> (all urban consumers, ~93% of the population); CPI-W (wage earners; used
        for Social-Security indexation) and the superlative <strong>chained C-CPI-U</strong> ride along the same
        collection. Construction, in five load-bearing choices:
      </P>
      <UL>
        <LI><strong>Weights come from a household survey</strong> — the Consumer Expenditure Survey. Since
          January&nbsp;2023 the weights are updated <strong>annually</strong> (previously biennially), using
          spending from a single calendar year, lagged two years.</LI>
        <LI><strong>Prices come from field + web collection</strong> — historically ~80,000 price quotes a month
          across 75 urban areas, plus a dedicated Housing survey for rents.</LI>
        <LI><strong>Formulas differ by level</strong>: within an item-area cell the BLS uses a
          <strong> geometric mean</strong> (since 1999 — it allows for consumer substitution between, say, two
          coffee brands); across cells the index is a fixed-weight <strong>Laspeyres-type</strong> aggregate.
          C-CPI-U replaces the upper level with a Törnqvist that uses <em>current</em> spending, which is why it
          runs ~0.2–0.3 pp cooler and gets revised.</LI>
        <LI><strong>Owner-occupied housing is IN — as a rent</strong>. <strong>Owners&rsquo; Equivalent Rent</strong>
          imputes what owners would pay to rent their own homes; with actual rents it makes shelter ≈ a third of
          the whole index. Remember this — it is the single biggest structural difference vs Europe.</LI>
        <LI><strong>Seasonal adjustment is published alongside NSA</strong>, with factors re-estimated every year
          (the last 5 years of SA data revise each February). The NSA index is what escalation contracts use.</LI>
      </UL>
      <Highlight>
        <strong>2025 caveat, still live</strong>: resource shortfalls made the BLS suspend collection entirely in
        three cities (Lincoln, Provo, Buffalo) and cut roughly <strong>15% of the sample</strong> in the remaining
        areas from April&nbsp;2025. The BLS states headline impact is minimal — but explicitly warns that
        <em> item-level</em> indexes get noisier. Our coffee series is an item-level index: treat single-month
        moves in it more sceptically after 2025-04 than before.
      </Highlight>

      <H2>2 · Eurozone HICP — twenty statistical agencies, one legal rulebook</H2>
      <P>
        The euro area has no BLS. Each national statistical institute (INSEE, Destatis, ISTAT…) compiles its own
        index, and Eurostat aggregates them into the euro-area HICP the ECB targets. What makes the
        <strong> Harmonised Index of Consumer Prices</strong> comparable is not a shared computer — it is a
        <strong> legal framework</strong> (Regulation (EU) 2016/792 and its implementing acts) that fixes:
      </P>
      <UL>
        <LI><strong>Scope</strong>: household final <em>monetary</em> consumption expenditure, on the
          <strong> domestic</strong> territory — tourists&rsquo; spending in the country counts, residents&rsquo;
          spending abroad doesn&rsquo;t (the US does the opposite). Non-monetary consumption — above all
          <strong> owner-occupied housing — is excluded</strong>: no OER, only actual rentals (~6–8% weight vs
          ~a third of shelter-inclusive US CPI).</LI>
        <LI><strong>Classification</strong>: a common European COICOP breakdown, transmitted to Eurostat at
          5-digit depth — every country slices consumption into the same named classes, coffee included.</LI>
        <LI><strong>Index mechanics</strong>: an annually <strong>chain-linked Laspeyres-type</strong> index
          (December link), with weights refreshed <em>every year</em> from national-accounts data — structurally
          faster-moving weights than the US.</LI>
        <LI><strong>Publication</strong>: a euro-area <strong>flash estimate at month-end</strong> (headline +
          main aggregates, days before the US even collects its release), full country × item detail ~2 weeks
          later — and HICP is <strong>essentially never revised</strong> (only errors and method changes), unlike
          the US SA series.</LI>
      </UL>
      <P>
        <strong>Since the January 2026 index</strong> (first published February 2026), the HICP reports on
        <strong> ECOICOP 2</strong> — identical to the UN&rsquo;s COICOP 2018 down to the 5th digit — with tables
        published on dual references <Code>2015=100</Code> and <Code>2025=100</Code>, and the old ECOICOP tables
        frozen at December 2025. Any pipeline that reads Eurostat HICP series (ours included) has to bridge that
        break in code lists and reference years.
      </P>

      <H2>3 · So do European countries differ from each other?</H2>
      <P>
        Yes — twice over, and the distinction is the answer to the question:
      </P>
      <UL>
        <LI><strong>Within the HICP: harmonised targets, permitted tools.</strong> The regulation fixes
          <em> what</em> must be measured, not every detail of <em>how</em>. Countries legitimately differ in:
          data sources (the Netherlands, Belgium and the Nordics run heavily on <strong>supermarket scanner data
          and web scraping</strong>; others still price outlets manually — for food items like coffee this
          changes how fast promotions show up); the <strong>elementary formula</strong> (geometric-mean Jevons vs
          ratio-of-averages Dutot is a national choice); sampling designs; and <strong>quality-adjustment
          methods</strong> (hedonics vs option-cost vs bracketing). These are tolerated differences <em>inside</em> a
          common definition — cross-country HICP comparisons remain legitimate, just not laboratory-identical.</LI>
        <LI><strong>Beside the HICP: every country still runs a national CPI</strong> — and those are NOT
          harmonised. Germany&rsquo;s VPI includes owner-occupied housing via imputed rents; France&rsquo;s IPC is
          close to its HICP but differs in coverage details; Italy publishes three indexes (NIC, FOI for wage
          indexation, and the HICP); Belgium runs a separate &ldquo;health index&rdquo; for wage indexation.
          National CPIs drive domestic wage/rent/contract indexation; the HICP exists for the ECB and for
          cross-country comparison. When a German inflation headline differs from &ldquo;German HICP&rdquo;, this
          is why.</LI>
      </UL>

      <H2>4 · US CPI vs HICP — the differences that actually bite</H2>
      <RefTable head={["Dimension", "US CPI-U", "Euro-area HICP"]} rows={[
        ["Producer", "one agency (BLS)", "national institutes + Eurostat rulebook"],
        ["Owner-occupied housing", "IN (OER; shelter ≈ ⅓)", "OUT (actual rents only)"],
        ["Population concept", "resident urban consumers", "domestic territory (incl. tourists)"],
        ["Weights source / cadence", "CE household survey · annual (lag 2y)", "national accounts · annual chain-linked"],
        ["Lower-level formula", "geometric mean (uniform)", "Jevons or Dutot (national choice)"],
        ["Flash estimate", "none (release ~mid-month)", "month-end flash, detail ~2 wks later"],
        ["Revisions", "SA factors revised 5y back; C-CPI-U revises", "essentially none"],
        ["Classification", "BLS item strata (~200)", "ECOICOP 2 = COICOP 2018, 5-digit"],
      ]} />
      <Highlight>
        The owner-occupied-housing gap alone means US CPI structurally runs hotter than HICP whenever rents
        outpace goods — comparing the two headlines without knowing this is comparing different baskets. The
        ECB/Eurostat have debated adding OOH to the HICP for a decade; it still isn&rsquo;t in.
      </Highlight>

      <H2>5 · What detail is actually published — and the coffee inside it</H2>
      <RefTable head={["", "US (BLS)", "Eurozone (Eurostat + NSIs)"]} rows={[
        ["Cadence", "monthly, ~mid-month", "flash month-end · full ~2 wks later"],
        ["Geography", "US + 4 regions + ~23 metro areas (bi/monthly)", "every member state + euro-area aggregate"],
        ["Item depth", "~200 strata + special aggregates, SA & NSA", "5-digit classes per country, NSA"],
        ["Coffee series", "Coffee · Roasted coffee · Instant coffee (CUSR/CUUR…SEFP01/02/03)", "a dedicated coffee class per country, every month"],
        ["History", "coffee series back to 1960s-80s", "HICP back to ~1996 (ECOICOP tables frozen at 2025-12)"],
      ]} />
      <P>
        Both systems therefore hand us a monthly, official, retail-level coffee price index — for the US as a
        single series (with roasted vs instant split), and for Europe <em>per country</em>, which is where it gets
        interesting: the same green-coffee rally passes through to German, French, Italian and Spanish shelves at
        visibly different speeds and magnitudes — measurable dispersion, published free, every month.
      </P>

      <H2>6 · What the dashboard already consumes — and where this can go</H2>
      <UL>
        <LI><strong>Today</strong>: <Code>us_cpi.json</Code> carries the four BLS headline series (all-items,
          core, food, energy) into the Macro page, and <Code>retail_cpi.json</Code> carries the retail-coffee
          trio — US roasted coffee (BLS), an EU coffee-HICP proxy built as a DE/FR/IT/ES basket, and Brazil&rsquo;s
          café moído from the IPCA (a third methodology again, for domestic-market context).</LI>
        <LI><strong>Two maintenance flags fall out of this paper</strong>: the US retail-coffee leg is currently
          stale (its series stops at 2020-12 — the fetch needs attention), and the EU proxy predates the
          <strong> ECOICOP-2 / 2025=100 transition</strong> — the Eurostat series behind it changed code list and
          reference in early 2026 and should be re-pointed before the frozen tables drift out of relevance.</LI>
        <LI><strong>Where this can go next</strong> (the follow-up study this paper prepares): deflate retail
          coffee CPI by the futures curve to measure <strong>pass-through lags</strong> per country; use the
          <strong> EZ coffee-CPI dispersion</strong> as a demand-side stress read; put CPI release dates on the
          macro-event calendar that feeds the currency index (both flash and full HICP dates matter for EUR);
          and treat post-2025-04 single-month moves in the US coffee item with the extra scepticism the BLS
          itself advises.</LI>
      </UL>

      <H2>Sources</H2>
      <P>
        BLS <em>Handbook of Methods</em>, ch. 17 (Consumer Price Index) and the 2025 collection-reduction
        notices; Regulation (EU) 2016/792 and the Eurostat <em>HICP Methodological Manual</em>; Eurostat
        &ldquo;HICP improvements — Q&amp;A 2026&rdquo; and Commission Delegated Regulation 2024/3159 (ECOICOP 2 /
        COICOP 2018 transition); Destatis and CBS(NL) 2026 transition notes; CRS Insight IN12596 on CPI data
        quality. Series identifiers referenced are the ones our exporters consume.
      </P>
    </Paper>
  );
}
