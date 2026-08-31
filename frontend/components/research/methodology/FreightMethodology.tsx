"use client";
import { Paper, H2, P, UL, LI, Code, Fml, Highlight, RefTable, DataFiles } from "./prose";

export default function FreightMethodology() {
  return (
    <Paper
      tone="violet"
      updated="2026-08-30"
      kicker="Freight · Methodology"
      title="Freight & port activity — how the numbers are built"
      subtitle="Container route estimates, the dry-bulk fertilizer proxy, and satellite port throughput"
    >
      <P>
        The Freight tab carries three independent signals, each answering a different question. <strong>Container
        rates</strong> (USD/FEU) price the ocean leg that moves coffee to roasters. The <strong>dry-bulk indicator</strong>
        proxies the cost pressure on <em>fertilizer</em> shipped into Brazil — an input cost, not a coffee cost.
        And <strong>port activity</strong> reads physical throughput at origin gateways from satellite AIS. This paper
        documents how each is estimated, with the formulas and their limits.
      </P>

      <H2>1 · Container freight — the FBX-multiplier route model</H2>
      <P>
        Coffee ships in 40-ft containers, but no public daily index exists for most coffee export lanes
        (Santos→Rotterdam, Djibouti→Rotterdam, …). We asked Freightos directly rather than assuming: harvesting the lane
        list off its own index page returns <strong>twelve tradelanes, and only twelve</strong> — China ⇄ NA West Coast,
        China ⇄ NA East Coast, China ⇄ North Europe, China ⇄ Mediterranean, NA East Coast ⇄ North Europe, and Europe →
        South America East/West Coast. There is <strong>no South America → Europe lane</strong> (FBX24/26 run the import
        direction, the opposite of the way coffee moves), <strong>nothing out of Africa</strong> and nothing in the
        Caribbean. Coffee leaves on legs Freightos does not publish.
      </P>
      <P>
        All twelve are now scraped and stored — FBX is the only container-freight source available here, and a spot
        index not captured on the day is gone — and the full set is shown on the Freight tab under <strong>FBX
        Tradelanes</strong>, unscaled and as published. Three of them carry the coffee corridor model:
      </P>
      <UL>
        <LI><strong>FBX11</strong> — China/East Asia → North Europe. The workhorse base.</LI>
        <LI><strong>FBX01</strong> — China/East Asia → North America West Coast.</LI>
        <LI><strong>FBX03</strong> — China/East Asia → North America East Coast.</LI>
      </UL>
      <P>
        Vietnam routes are treated as <em>direct</em> (Vietnam ≈ China sailing dynamics, multiplier ≈ 1). South-American
        and African lanes have no equivalent index, so they ride FBX11 as a <strong>directional proxy</strong>, scaled
        down by a fixed multiplier and flagged <Code>~est</Code> so the user knows it is an estimate rather than a
        measurement. Note what that implies: four corridors share a single signal, so their percentage moves are
        identical <em>by construction</em>, not because two sources agree. Hamburg is Rotterdam × 1.02 and is flagged
        the same way.
      </P>
      <RefTable
        head={["Route", "Index", "Mult.", "Proxy"]}
        rows={[
          ["Ho Chi Minh → Rotterdam", "FBX11", "×1.00", "—"],
          ["Ho Chi Minh → Hamburg", "FBX11", "×1.02", "~est"],
          ["Ho Chi Minh → Los Angeles", "FBX01", "×1.00", "—"],
          ["Santos → Rotterdam", "FBX11", "×0.58", "~est"],
          ["Cartagena → Rotterdam", "FBX11", "×0.55", "~est"],
          ["Djibouti → Rotterdam", "FBX11", "×0.70", "~est"],
          ["Santos → New York", "FBX03", "×0.45", "~est"],
        ]}
      />
      <P>The rate and its weekly change come straight off the index:</P>
      <Fml>{`rate  = round( latest_FBX_rate × multiplier )      [USD/FEU]
prev  = round( prev_FBX_rate   × multiplier )      (else prev = rate → 0 change)
prev_FBX = most recent FBX print dated 7 or more days back`}</Fml>
      <P>
        The comparison is <Code>date &lt;= today − 7</Code>, not <Code>&lt;</Code>. The strict version skipped the print
        dated exactly seven days back — the ideal comparison point — and fell through to one 9–14 days old while the
        brief still called it &ldquo;w/w&rdquo;; replayed over the stored history it misstated the change on 9 of 18
        observations. Because the index is only scraped Fri &amp; Sun, an exact-7-day hit is the common case, not a
        corner case. Each route also publishes the <Code>prev_date</Code> it actually compared against, so the span is
        stated rather than assumed.
      </P>
      <Highlight>
        <strong>Cadence, and why the archive is the only archive.</strong> Freight is scraped <strong>Fridays &amp;
        Sundays only</strong> — verified over three months, FBX prints essentially never moved Mon–Thu. Each run
        captures a <em>single current value</em>, so the stored series is a step function that holds flat between
        scrapes rather than a true daily series. Read levels and weekly changes, not intra-week wiggles.
        <br /><br />
        Two probes went looking for the back history rather than assuming it was out of reach. They captured{" "}
        <em>every</em> network response on the lane pages and on the public <Code>fbx.freightos.com</Code> site, and
        found no series endpoint, no export link, and — from the DOM, not by inference — <strong>no chart element at
        all</strong> (0 <Code>&lt;canvas&gt;</Code>, 0 chart <Code>&lt;svg&gt;</Code>). The page carries one current
        number and nothing more; the history lives behind a Freightos subscription. So the series here is the only one
        that will ever exist for these lanes, which is why <Code>freight.json</Code> publishes the{" "}
        <strong>entire stored record</strong> rather than a rolling window, and the chart&rsquo;s 3M / 1Y / All control
        chooses the view instead of the exporter choosing it for you.
      </Highlight>
      <P className="text-[11px] text-slate-500">
        The same route table is consumed by the Research → <strong>Destination In-store</strong> tab, which reads the
        <Code>vn-eu</Code> rate as its FBX11 base and re-applies the multiplier method per destination port. Note the
        multipliers are fixed constants, manually calibrated — they assume each proxy lane tracks FBX directionally at a
        constant ratio, which a Suez/Panama disruption can break.
      </P>

      <H2>2 · Dry-bulk freight — the BDRY fertilizer-cost proxy</H2>
      <P>
        Fertilizer — the largest cash input on a Brazilian coffee farm — moves as <strong>dry bulk</strong>
        (Capesize/Supramax), not in containers, and its landed (CIF) cost rises and falls with dry-bulk freight. With no
        free real-time dry-bulk index, the model uses <strong>BDRY</strong> (Breakwave Dry Bulk Shipping ETF, NYSE
        Arca), which holds a rolling book of Capesize + Supramax freight <em>futures</em>, as a tradable daily proxy.
      </P>
      <Fml>{`MoM = (last / close[-22] − 1) × 100      (~22 trading days ≈ 1 month)
WoW = (last / close[-5]  − 1) × 100      (~5 trading days  ≈ 1 week)
+ 52-week low / high range bar`}</Fml>
      <P>
        The read: <strong>rising BDRY → tighter dry-bulk freight → higher CIF fertilizer cost into Brazil → margin
        pressure on growers</strong>. It is a daily Yahoo-Finance pull feeding the Freight tab and the farmer-economics
        fertilizer block. Caveat: BDRY is an ETF on futures, exposed to roll yield and equity-market noise — a proxy for
        cost <em>pressure</em>, not a freight rate.
      </P>

      <H2>3 · Port activity — IMF PortWatch (satellite AIS)</H2>
      <P>
        Rates tell you cost; port activity tells you <strong>physical flow</strong>. The model pulls IMF PortWatch&rsquo;s
        daily dataset (built on UN Global Platform AIS satellite tracking) for the coffee export gateways it still
        covers — Ho Chi Minh, Santos, Vitória, Mangalore, Kochi, Barranquilla, and Djibouti (outlet for landlocked
        Ethiopia). PortWatch rebuilt <Code>Daily_Ports_Data</Code> around a smaller port set during 2026 and stopped
        publishing eight gateways we previously tracked, Buenaventura, Cartagena, Panjang, Tanjung Priok, Puerto Cortés,
        Puerto Quetzal, Mombasa and Dar es Salaam among them; Djibouti&rsquo;s series is frozen after 2026-02-22 for the
        same reason. Those are recorded in <Code>COVERAGE_DROPPED</Code> rather than quietly deleted.
      </P>
      <UL>
        <LI><strong>Three metrics</strong> — port calls (vessel-arrival count), import and export (estimated trade
          volume in metric tons).</LI>
        <LI><strong>Five vessel types</strong> — container, dry-bulk, general-cargo, ro-ro, tanker — each metric is also
          split by type, so the coffee-relevant container/export flow can be isolated.</LI>
        <LI><strong>History from 2021</strong>, refreshed weekly (Wednesdays, after PortWatch&rsquo;s Tuesday update).</LI>
      </UL>
      <P className="text-[11px] text-slate-500">
        Caveat: import/export tonnages are <em>AIS model estimates</em>, not customs truth, and totals are all-cargo —
        the coffee signal is inferred from these gateways, not measured bag-by-bag.
      </P>

      <H2>4 · Seasonality — the year-over-year overlay</H2>
      <P>
        Port throughput is highly seasonal (harvest, shipping peaks), so absolute levels are read against the calendar.
        Every year is collapsed onto a common <Code>1…365</Code> day-of-year index so Jan 1 lines up across years
        (Feb 29 is merged onto Feb 28 to keep leap and non-leap years aligned). The chart then draws the current year,
        the two prior years, and a grey <strong>min–max band</strong> across all earlier years, plus a year-to-date
        comparison:
      </P>
      <Fml>{`day value  = Σ over active vessel types of metric_<type>
band       = [min, max] across prior years (excludes current)
YTD %      = (Σ current YTD − Σ prior-year same-window) / prior × 100`}</Fml>
      <P className="text-[11px] text-slate-500">
        The band is a full min–max envelope (sensitive to a single outlier year), and the current year is naturally
        incomplete past today. Daily and cumulative views are both available; everything recomputes client-side from the
        PortWatch JSON when you toggle vessel types.
      </P>

      <H2>Where it lives</H2>
      <P>
        Container routes: <Code>backend/routes/freight.py</Code> + <Code>scraper/exporters/macro.py</Code>
        (<Code>ROUTE_CONFIG</Code>, FBX × multiplier) → <Code>freight.json</Code>. Dry bulk:
        <Code>scraper/sources/dry_bulk.py</Code> → <Code>farmer_economics.json → fertilizer.dry_bulk</Code>. Port
        activity: <Code>scraper/sources/port_activity.py</Code> → <Code>public/data/port_activity/*.json</Code>.
        Seasonality math: <Code>app/freight/seasonal.ts</Code> + <Code>PortActivity.tsx</Code>. All rendered on the{" "}
        <strong>Freight</strong> tab, with the route spread also surfaced in the Macro freight-context panel.
      </P>
      <DataFiles files={["freight.json"]} />
    </Paper>
  );
}
