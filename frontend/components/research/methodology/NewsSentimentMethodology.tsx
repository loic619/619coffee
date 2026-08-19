"use client";
import { Paper, H2, H, P, UL, LI, Code, Fml, Highlight, DataFiles } from "./prose";

// Small text matrix (not numbers) — distinct from RefTable's mono/right-aligned cells.
function Matrix({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
            {head.map((h, i) => <th key={i} className="pb-1.5 pr-4">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-800 align-top">
              {r.map((c, ci) => (
                <td key={ci} className={`py-1.5 pr-4 ${ci === 0 ? "text-slate-200 font-semibold whitespace-nowrap" : "text-slate-300"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <DataFiles files={["news.json"]} />
    </div>
  );
}

export default function NewsSentimentMethodology() {
  return (
    <Paper
      tone="rose"
      updated="2026-07-14"
      kicker="Signals · Applied"
      title="News & sentiment — turning headlines into a coffee signal"
      subtitle="How to read the LLM sentiment score, and how to trade with (and around) it"
    >
      <P>
        Coffee is an <strong>event-driven</strong> commodity: frost scares, drought, export bans, freight disruption,
        currency moves and certified-stock swings all break as <em>news</em> long before they settle into the weekly
        data. The news-sentiment model turns that flow into a single, fast read of the market narrative. This paper is
        the <em>applied</em> companion to the model mechanics under <strong>Signals &amp; forecasts</strong> — what the
        score is good for, and the discipline it demands.
      </P>

      <H2>What the model gives you</H2>
      <P>
        A large language model classifies the last seven days of coffee-relevant headlines as Bullish / Bearish /
        Neutral with a confidence, then aggregates them by a <strong>confidence-weighted vote</strong> (see the Signals
        paper for the internals). Two numbers come out, and they answer different questions:
      </P>
      <Fml>{`overall            = argmax_s Σ confidence[s]      ← which way the narrative leans (direction)
overall_confidence = Σ confidence[overall] / Σ all   ← how one-sided the flow is (conviction / crowding)`}</Fml>
      <P>
        Read them together. A <em>bullish</em> overall at <em>low</em> confidence is a contested tape; a bullish overall
        at <em>high</em> confidence is a crowded one-way narrative — which, as below, cuts both ways.
      </P>

      <H2>Five ways to use it</H2>

      <H>1 · Confirmation vs. divergence</H>
      <P>
        Sentiment is most reliable as an <strong>overlay</strong> on price and positioning, not a standalone trigger.
        Line it up against the price trend:
      </P>
      <Matrix
        head={["Sentiment ↓ / Price →", "Price rising", "Price falling"]}
        rows={[
          ["Bullish", "Confirmation — trend has narrative support; stay with it.", "Divergence — news leads or price lags; early-warning of a turn, or a bear-trap to fade."],
          ["Bearish", "Divergence — rally lacks story; suspect, fade-watch.", "Confirmation — downtrend backed by flow; stay short/aside."],
        ]}
      />
      <P>
        Confirmation raises conviction (and size); divergence is the interesting cell — it&rsquo;s either an early read
        on a turn or a signal the move is exhausted. Cross-check against fundamentals before acting on a divergence.
      </P>

      <H>2 · Trade the shift, not the level</H>
      <P>
        The <strong>change</strong> in tone carries more information than its absolute value. A flip from bearish to
        bullish on fresh supply news is a real event; a tape that&rsquo;s been mildly bullish for a month is just
        background. Track the day-over-day delta in <Code>overall</Code> and <Code>overall_confidence</Code> and react
        to <em>transitions</em> — especially a tone change that arrives <em>before</em> price confirms it.
      </P>

      <H>3 · Fade the extreme</H>
      <Highlight>
        Saturated, one-sided sentiment (everyone bullish into a frost scare) usually means the news is <em>already in
        the price</em>. The tell: bullish headlines keep coming but price stops making new highs. When
        <Code> overall_confidence</Code> is near its ceiling and price is no longer responding, lean toward fading the
        exhaustion rather than chasing it. Reflexivity is the enemy of late entries.
      </Highlight>

      <H>4 · Type the event → directional prior</H>
      <P>
        Sentiment tells you <em>timing and intensity</em>; the event type tells you <em>direction and durability</em>.
        Map the dominant driver to its structural sign, then use sentiment to time it and fundamentals to size it:
      </P>
      <Matrix
        head={["Headline driver", "Structural bias", "Notes"]}
        rows={[
          ["Frost / drought at flowering", "Bullish (supply shock)", "Fast, sharp; verify against the Weather & Farmer-economics models — a 'risk' headline is not yet a crop loss."],
          ["Export ban / policy / cess", "Bullish, origin-specific", "Check it isn't already a known, priced policy."],
          ["Freight / logistics disruption", "Cost-push", "Hits CIF/in-store parity more than flat price — see Freight & Destination In-store."],
          ["Large crop / demand downgrade", "Bearish", "Slower-burn; confirm against Supply balance sheets."],
          ["Currency move (BRL, VND…)", "Via FX, not fundamentals", "Read through the Macro currency index, not as a coffee story per se."],
        ]}
      />

      <H>5 · Bridge the weekly-data gap</H>
      <P>
        Positioning (COT) prints weekly and the balance sheets monthly — between them the market is partly blind.
        Sentiment is <strong>continuous</strong>, so it fills that window: pair it with the intraweek positioning
        nowcast (COT &amp; positioning paper) to read <em>what narrative is driving the intraweek flow</em> before the
        next official print confirms it.
      </P>

      <H2>A combined read</H2>
      <P>
        No single input decides a trade. The useful synthesis stacks three independent reads — price trend, sentiment,
        and COT positioning — and acts on agreement, steps back on conflict:
      </P>
      <Matrix
        head={["Configuration", "Bias"]}
        rows={[
          ["Price up · sentiment bullish · MM still light", "Add — trend, story and dry powder all align."],
          ["Price up · sentiment bullish · MM crowded long", "Hold/trim — narrative right but positioning exhausted; fade-watch."],
          ["Price flat · sentiment flips bullish · fresh supply news", "Lean long early — tone change leading price."],
          ["Price up · sentiment bearish/neutral", "Suspect rally — reduce conviction, wait for confirmation."],
          ["Conflicting reads", "Stand aside — sentiment's edge is confirmation, not contradiction."],
        ]}
      />

      <H2>Pitfalls & discipline</H2>
      <UL>
        <LI><strong>Confidence isn&rsquo;t calibrated.</strong> The LLM&rsquo;s self-reported confidence is ordinal, not
          a probability — rank with it, don&rsquo;t size linearly off it.</LI>
        <LI><strong>Reflexivity.</strong> By the time something is a headline, much is priced. Sentiment&rsquo;s edge is
          timing and confirmation, rarely primary discovery.</LI>
        <LI><strong>Small, recency-weighted sample.</strong> A 7-day window of ≤25 headlines is easily dominated by one
          big story — a single frost piece can swamp the vote. Watch the headline count behind the score.</LI>
        <LI><strong>Selection bias.</strong> The tone reflects the feed&rsquo;s composition; pure price-recap wires are
          excluded for exactly this reason, but source mix still shapes the read.</LI>
        <LI><strong>Classification error.</strong> Models misread conditionals and risk language — &ldquo;frost
          <em>could</em> hit&rdquo; is a risk, not a fact. A bullish-<em>risk</em> headline ≠ a bullish outcome.</LI>
        <LI><strong>Don&rsquo;t double-count.</strong> If sentiment is merely re-reading the same price move, it is not
          independent information — weight it only when it adds a view price doesn&rsquo;t already show.</LI>
      </UL>

      <H2>Where it lives & status</H2>
      <P>
        The classifier runs live into <Code>quant_report.json → sentiment</Code> on each quant run, from the
        <Code> NewsItem</Code> feed (the same articles behind the <strong>News</strong> tab). It is currently surfaced
        only on the standalone Signals page; the score is available to wire into the daily brief or a Research/News
        widget whenever desired. Treat it as one independent read among several — most valuable exactly when it{" "}
        <em>confirms</em> or <em>cleanly contradicts</em> price and positioning.
      </P>
    </Paper>
  );
}
