"use client";
// Honduras — origin country profile.
//
// Built from a 2021 source dossier (IHCAFE regional census, exporter league,
// destination split, an 11-year S&D balance). Everything the source stated is
// reproduced; everything that could be checked against itself HAS been, and
// the five reconciliations are published in §11 rather than quietly patched —
// a profile that silently corrects its source is a profile you cannot audit.
//
// Palette: categorical slots validated with the dataviz validator against this
// app's surface (#0f172a) — lightness band, chroma floor, CVD separation,
// normal-vision floor and contrast all pass.
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { Paper, H2, P, UL, LI, Code, Highlight, RefTable } from "../methodology/prose";

const C = { blue: "#3987e5", green: "#199e70", gold: "#c98500", rose: "#d55181", orange: "#d95926" };
const tip = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 };

/* ── source data ──────────────────────────────────────────────────────────
   Transcribed verbatim from the 2021 dossier. Derived figures below are
   COMPUTED from these rather than copied, so a correction here propagates. */

const REGIONS = [
  { name: "Copán",         farmers:  8236, mz: 54715, qq: 1308107, alt: "1,000–1,500 m" },
  { name: "Santa Bárbara", farmers: 15132, mz: 58338, qq: 1036801, alt: "1,000–1,500 m" },
  { name: "Ocotepeque",    farmers:  6827, mz: 34508, qq:  865563, alt: "—" },
  { name: "Lempira",       farmers: 12864, mz: 49845, qq: 1202235, alt: "1,000–1,500 m" },
  { name: "Comayagua",     farmers: 13798, mz: 74662, qq: 1682204, alt: "1,000–1,500 m" },
  { name: "El Paraíso",    farmers: 15973, mz: 84232, qq: 1098063, alt: "1,000–1,400 m" },
];
const T_FARMERS = REGIONS.reduce((s, r) => s + r.farmers, 0);
const T_MZ      = REGIONS.reduce((s, r) => s + r.mz, 0);
const T_QQ      = REGIONS.reduce((s, r) => s + r.qq, 0);
const MZ_TO_HA  = 0.6987;
const QQ_ORO_KG = 45.36;   // 100 lb

const HARVEST = [
  { m: "Sep", pct: 1 }, { m: "Oct", pct: 6 }, { m: "Nov", pct: 18 }, { m: "Dec", pct: 32 },
  { m: "Jan", pct: 28 }, { m: "Feb", pct: 10 }, { m: "Mar", pct: 3 },
];
const HARVEST_SUM = HARVEST.reduce((s, h) => s + h.pct, 0);

const EXPORTERS = [
  { n: "Co. Honducafé", v: 2062953 }, { n: "Becamo", v: 1129261 },
  { n: "Olam Honduras", v: 601231 }, { n: "Sogimex", v: 359995 },
  { n: "Cohmasa", v: 255645 }, { n: "Hawit-Caffex", v: 239616 },
  { n: "Boncafé", v: 226152 }, { n: "Louis Dreyfus", v: 225948 },
  { n: "Beneficio Santa Rosa", v: 221021 }, { n: "Molino de Honduras", v: 216373 },
];
const EXP_OTHERS = 1166162;
const EXP_TOTAL  = 6704359;                                    // as stated
const EXP_TOP10  = EXPORTERS.reduce((s, e) => s + e.v, 0);

const SD = [
  { y: "2010-11", init: 220, prod: 4100, dom: 250, exp: 3866, imp: 5, end: 209 },
  { y: "2011-12", init: 209, prod: 5850, dom: 250, exp: 5474, imp: 4, end: 339 },
  { y: "2012-13", init: 339, prod: 4450, dom: 250, exp: 4341, imp: 4, end: 202 },
  { y: "2013-14", init: 202, prod: 5350, dom: 255, exp: 4897, imp: 3, end: 403 },
  { y: "2014-15", init: 403, prod: 5390, dom: 275, exp: 5169, imp: 4, end: 353 },
  { y: "2015-16", init: 353, prod: 6260, dom: 300, exp: 5520, imp: 4, end: 797 },
  { y: "2016-17", init: 797, prod: 8000, dom: 325, exp: 7529, imp: 6, end: 949 },
  { y: "2017-18", init: 949, prod: 7750, dom: 335, exp: 7436, imp: 37, end: 965 },
  { y: "2018-19", init: 965, prod: 7450, dom: 365, exp: 7035, imp: 5, end: 1020 },
  { y: "2019-20", init: 1020, prod: 6450, dom: 380, exp: 5964, imp: 5, end: 1131 },
  { y: "2020-21", init: 1131, prod: 7275, dom: 390, exp: 6850, imp: 5, end: 1171 },
];
const SD_BALANCED = SD.every(r => r.init + r.prod + r.imp - r.exp - r.dom === r.end);

const CHAIN: { from: string; flows: [string, number][] }[] = [
  { from: "Small farmers", flows: [["Middlemen", 77], ["Cooperatives", 15], ["Medium farmers", 4], ["Large farmers", 4]] },
  { from: "Medium farmers", flows: [["Middlemen", 62], ["Cooperatives", 20], ["Exporters", 11], ["Large farmers", 7]] },
  { from: "Large farmers", flows: [["Middlemen", 83], ["Exporters", 17]] },
  { from: "Middlemen", flows: [["Exporters", 67], ["Cooperatives", 31], ["Importers abroad", 2]] },
  { from: "Cooperatives", flows: [["Exporters", 81], ["Local roasters", 15], ["Importers abroad", 4]] },
  { from: "Exporters", flows: [["Importers abroad", 95], ["Local roasters", 5]] },
];

const TRUST = [
  { to: "The trust itself — a bank guarantee opening credit lines", usd: 9.00 },
  { to: "FCN (Fondo Cafetero Nacional)", usd: 1.75 },
  { to: "Loan repayment (1.00 government · 0.50 Taiwan loan)", usd: 1.50 },
  { to: "IHCAFE", usd: 1.00 },
];
const TRUST_SUM = TRUST.reduce((s, t) => s + t.usd, 0);

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;

export default function HondurasProfile() {
  const regionRows = REGIONS.map(r => ({ ...r, yield: r.qq / r.mz }))
    .sort((a, b) => b.yield - a.yield);
  const bagsFromRegions = T_QQ * QQ_ORO_KG / 60 / 1e6;
  const peak = SD.reduce((a, b) => (b.prod > a.prod ? b : a));
  const trough = SD.reduce((a, b) => (b.prod < a.prod ? b : a));
  // Sharpest year-on-year fall in production, as a share of the prior year.
  const drop = SD.slice(1).reduce(
    (worst, r, i) => {
      const d = (r.prod - SD[i].prod) / SD[i].prod;
      return d < worst.d ? { d, y: r.y } : worst;
    },
    { d: 0, y: "" },
  );
  const expShare = 100 * SD.reduce((s, r) => s + r.exp, 0) / SD.reduce((s, r) => s + r.prod, 0);
  const last = SD[SD.length - 1];

  return (
    <Paper
      tone="emerald"
      updated="2026-08-25"
      kicker="Origin profile · Honduras"
      title="Honduras — origin country profile"
      subtitle="Six regions, 73k growers and a 2× yield spread: what the 2021 dossier says, and which of its numbers survive checking"
    >
      <P>
        <strong>Abstract.</strong> Honduras is Central America&rsquo;s largest coffee producer and, on the
        source&rsquo;s own numbers, a country where roughly {fmt(T_FARMERS)} growers across six regions work an
        average of {(T_MZ / T_FARMERS).toFixed(1)} manzanas each — a smallholder origin whose output is
        nonetheless concentrated at the export gate, with the top ten exporters handling{" "}
        <strong>{pct(100 * EXP_TOP10 / EXP_TOTAL)}</strong> of shipments and one house alone{" "}
        <strong>{pct(100 * EXPORTERS[0].v / EXP_TOTAL)}</strong>. This profile reproduces the dossier and then
        checks it against itself. The supply-and-demand balance is internally exact in{" "}
        <strong>all {SD.length} years</strong>; five other figures do not reconcile, and §11 says which and by
        how much rather than correcting them silently.
      </P>

      <Highlight>
        <strong>Vintage.</strong> The source dossier is dated <strong>2021</strong>. Structure — regions,
        altitude bands, the levy, the chain, the port pair — moves slowly and is likely still broadly right.
        Volumes, prices and the exporter league move fast and should be treated as a 2021 snapshot until
        refreshed against the app&rsquo;s live series.
      </Highlight>

      <H2>1 · The country in numbers</H2>
      <RefTable
        head={["Measure", "Source figure", "Status"]}
        rows={[
          ["Population", "~8 million", <span key="a" className="text-slate-500">context</span>],
          ["Coffee area", "~350,000 (unit disputed — see §11)",
            <span key="b" className="text-amber-400">check §11</span>],
          ["Production", "~5–6 million 60-kg bags",
            <span key="c" className="text-emerald-400">consistent with the regional census ({bagsFromRegions.toFixed(2)}m)</span>],
          ["Coffee share of GDP", "stated as 50%",
            <span key="d" className="text-rose-400">implausible — see §11</span>],
          ["Growers (6 regions)", `${fmt(T_FARMERS)}`,
            <span key="e" className="text-emerald-400">sums from the census</span>],
          ["Cost of production", "US¢60–80 / lb",
            <span key="f" className="text-slate-500">as stated</span>],
        ]}
      />

      <H2>2 · Altitude — where the quality sits</H2>
      <P>
        Honduras grades by height, and the mass of the crop sits in the two upper bands. On the source&rsquo;s
        split, less than a tenth of production is Central Standard while roughly half is SHG — which is why
        the country trades as a differentiated origin rather than a volume filler.
      </P>
      <RefTable
        head={["Band", "Altitude", "Share of production"]}
        rows={[
          [<span key="a" className="font-semibold text-slate-200">SHG</span>, "above 1,300 m", "45–55%"],
          [<span key="b" className="font-semibold text-slate-200">HG</span>, "900–1,300 m", "37–47%"],
          [<span key="c" className="font-semibold text-slate-200">Central Standard</span>, "below 900 m", "8–9%"],
        ]}
      />

      <H2>3 · The six regions</H2>
      <P>
        IHCAFE divides the country into six denominations of origin. The striking number is not the size
        ranking but the <strong>yield spread</strong>: Ocotepeque returns{" "}
        <strong>{(regionRows[0].yield / regionRows[regionRows.length - 1].yield).toFixed(2)}×</strong> what
        El Paraíso does per manzana, on holdings of a broadly similar kind. El Paraíso is simultaneously the
        largest region by area and the weakest by yield — a productivity gap, not a land-scarcity one.
      </P>
      <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
          Yield by region — quintales oro per manzana
        </div>
        <div className="mb-2 text-[10px] text-slate-500">
          Computed from the census (production ÷ area), not copied from the source&rsquo;s stated column —
          which is how the Lempira discrepancy in §11 surfaced.
        </div>
        <div style={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regionRows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#64748b" }} interval={0} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={44} />
              <Tooltip contentStyle={tip}
                formatter={(v) => [`${Number(v ?? 0).toFixed(2)} qq/mz`, "yield"]} />
              <Bar dataKey="yield" radius={[4, 4, 0, 0]}>
                {regionRows.map(r => (
                  <Cell key={r.name} fill={r.yield >= 22 ? C.green : r.yield >= 17 ? C.blue : C.orange} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {([["≥ 22 qq/mz", C.green], ["17–22", C.blue], ["< 17", C.orange]] as [string, string][])
            .map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}
              </span>
            ))}
        </div>
      </div>
      <RefTable
        head={["Region", "Growers", "Area (mz)", "qq oro", "qq/mz", "Altitude"]}
        rows={[
          ...regionRows.map(r => [
            r.name, fmt(r.farmers), fmt(r.mz), fmt(r.qq),
            <span key={r.name} className="font-semibold text-slate-200">{r.yield.toFixed(2)}</span>,
            r.alt,
          ]),
          [<strong key="t">Total</strong>, <strong key="f">{fmt(T_FARMERS)}</strong>,
            <strong key="m">{fmt(T_MZ)}</strong>, <strong key="q">{fmt(T_QQ)}</strong>,
            <strong key="y">{(T_QQ / T_MZ).toFixed(2)}</strong>, "—"],
        ]}
      />
      <P>
        That total is <Code>{fmt(T_MZ)}</Code> mz ≈ <Code>{fmt(Math.round(T_MZ * MZ_TO_HA))}</Code> ha, and{" "}
        <Code>{fmt(T_QQ)}</Code> qq oro ≈ <strong>{bagsFromRegions.toFixed(2)}m 60-kg bags</strong> — which
        lands inside the &ldquo;5–6 million bags&rdquo; the intro claims, so the census and the headline agree.
        Average holding: <strong>{(T_MZ / T_FARMERS).toFixed(1)} mz</strong> ({(T_MZ / T_FARMERS * MZ_TO_HA).toFixed(1)} ha),
        average output <strong>{(T_QQ / T_FARMERS).toFixed(0)} qq</strong> per grower.
      </P>

      <H2>4 · The calendar</H2>
      <P>
        Rain falls May to October; harvest opens in October behind it and runs to March. Two thirds of the
        crop moves in the three months <strong>December–February</strong>, with December alone at 32% — so
        the origin&rsquo;s selling pressure, its labour demand and its weather exposure are all concentrated
        into one quarter.
      </P>
      <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Harvest pace — % of crop by month</div>
        <div className="mb-2 text-[10px] text-slate-500">
          The source&rsquo;s months sum to {HARVEST_SUM}%, not 100 — see §11.
        </div>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={HARVEST} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 10, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40}
                tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={tip} formatter={(v) => [`${Number(v ?? 0)}%`, "of crop"]} />
              <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                {HARVEST.map(h => <Cell key={h.m} fill={h.pct >= 18 ? C.gold : C.blue} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <H2>5 · Risk</H2>
      <UL>
        <LI><strong>Drought</strong> — the source names it the primary climate risk, sharpening with warming.</LI>
        <LI><strong>Tropical storms</strong> — they deliver the rain and can destroy the crop in the same
          pass. The dossier cites <Code>1969</Code>, <Code>1974</Code>, <Code>1982</Code> and{" "}
          <Code>1998</Code> (Mitch). Note the timing: the Atlantic season peaks September–November, which is
          exactly when the crop is ripening and the first 25% is being picked.</LI>
        <LI><strong>Coffee leaf rust</strong> — flagged in the source as unverified. Given the 2012–13
          Central American epidemic, this is the gap most worth closing first.</LI>
      </UL>

      <H2>6 · The coffee trust — a levy that is partly a deposit</H2>
      <P>
        Every exported quintal (46 kg) carries a withholding of{" "}
        <strong>US${TRUST_SUM.toFixed(2)}</strong>. What makes it unusual is that two thirds of it is not a
        tax at all: <strong>US$9.00</strong> capitalises a trust that stands as a bank guarantee, opening
        credit to producers through IHCAFE or a bank — and is <em>returned</em> to any producer who does not
        draw on it.
      </P>
      <RefTable
        head={["Destination", "US$ / 46-kg quintal", "Share"]}
        rows={[
          ...TRUST.map(t => [t.to, t.usd.toFixed(2), pct(100 * t.usd / TRUST_SUM)]),
          [<strong key="t">Total withholding</strong>,
            <strong key="v">{TRUST_SUM.toFixed(2)}</strong>,
            <strong key="s">100%</strong>],
        ]}
      />
      <P className="text-slate-400">
        The components sum to the stated total exactly. The open question the source itself raises is
        whether the refund is <em>practically</em> recoverable — a US$9.00/qq claim that is hard to redeem is
        an export tax by another name, and at{" "}
        <strong>${(9.00 * EXP_TOTAL / 1e6).toFixed(1)}m</strong> across the {fmt(EXP_TOTAL)} bags shipped, the
        distinction is not small.
      </P>

      <H2>7 · The domestic chain — the middleman is the market</H2>
      <P>
        Small farmers send <strong>77%</strong> of their crop to intermediaries and only 15% to cooperatives;
        direct sale to an exporter does not appear in their options at all. Middlemen then pass 67% to
        exporters and 31% to cooperatives — so the cooperative sector buys more coffee from middlemen than it
        receives from its own members&rsquo; first sale.
      </P>
      <div className="my-4 space-y-2">
        {CHAIN.map(row => (
          <div key={row.from} className="rounded border border-slate-800 bg-slate-900/40 p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">{row.from}</div>
            <div className="flex h-5 w-full overflow-hidden rounded">
              {row.flows.map(([to, share], i) => (
                <div key={to} title={`${to} — ${share}%`}
                  style={{
                    width: `${share}%`,
                    background: [C.gold, C.green, C.blue, C.rose][i % 4],
                    marginRight: i < row.flows.length - 1 ? 2 : 0,
                  }}
                  className="flex items-center justify-center">
                  {share >= 12 && (
                    <span className="truncate px-1 text-[9px] font-semibold text-slate-950">{share}%</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {row.flows.map(([to, share], i) => (
                <span key={to} className="flex items-center gap-1 text-[9px] text-slate-400">
                  <span className="h-2 w-2 rounded-sm"
                    style={{ background: [C.gold, C.green, C.blue, C.rose][i % 4] }} />
                  {to} {share}%
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <P className="text-slate-400">
        Every row sums to exactly 100%, so the chain as stated is complete. Note that middlemen and
        cooperatives both <em>buy</em> as well as sell, so these are shares of throughput, not of the national
        crop — the percentages cannot be chained end-to-end without double counting.
      </P>

      <H2>8 · Exporters — a concentrated gate on a fragmented farm base</H2>
      <P>
        {fmt(T_FARMERS)} growers ship through a handful of houses. The top ten account for{" "}
        <strong>{pct(100 * EXP_TOP10 / EXP_TOTAL)}</strong> of the {fmt(EXP_TOTAL)} 46-kg bags exported, and
        Honducafé alone for {pct(100 * EXPORTERS[0].v / EXP_TOTAL)} — nearly double the second name. The
        international trade houses named in the dossier are <strong>Louis Dreyfus</strong> (one plant, Villanueva)
        and <strong>Volcafe</strong> (mills at San Pedro Sula, Santa Rosa de Copán and Comayagua; buying
        stations at San Nicolás and El Paraíso; cherry purchasing at La Fortuna).
      </P>
      <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-400">
          Exports by house — thousand 46-kg bags
        </div>
        <div style={{ height: 250 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={[...EXPORTERS, { n: "All others", v: EXP_OTHERS }]}
              margin={{ top: 4, right: 16, bottom: 4, left: 96 }}>
              <CartesianGrid stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="n" tick={{ fontSize: 9, fill: "#94a3b8" }} width={94} />
              <Tooltip contentStyle={tip}
                formatter={(v) => [`${fmt(Number(v ?? 0))} bags`, "exported"]} />
              <Bar dataKey="v" radius={[0, 4, 4, 0]}>
                {[...EXPORTERS, { n: "All others", v: EXP_OTHERS }].map(e => (
                  <Cell key={e.n} fill={e.n === "All others" ? "#475569"
                    : e.n === "Louis Dreyfus" ? C.rose : C.gold} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Every bar is already named on the category axis, so colour here is
            emphasis rather than identity — but "why is one bar pink" still
            needs answering in the figure and not three paragraphs away. */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {([["Honduran house", C.gold],
             ["international trade house", C.rose],
             ["all other exporters combined", "#475569"]] as [string, string][]).map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}
            </span>
          ))}
        </div>
      </div>

      <H2>9 · Destinations — a European origin</H2>
      <P>
        <strong>71%</strong> of Honduran coffee goes to Europe, with Germany and Belgium taking 25% each —
        Belgium&rsquo;s share reflecting Antwerp&rsquo;s role as the warehousing gateway rather than Belgian
        consumption. North America takes {pct(21.47, 2)} (US {pct(18.45, 2)}, Canada {pct(2.21, 2)}), Asia 3%
        and South America {pct(1.3)}.
      </P>
      <RefTable
        head={["Destination", "Share", "Note"]}
        rows={[
          ["Europe — total", "71%", "Germany 25% · Belgium 25% · Italy 6.5% · France 3%"],
          ["North America", "21.47%", "USA 18.45% · Canada 2.21%"],
          ["Asia", "3%", "Korea 1.46%"],
          ["South America", "1.3%", "—"],
          [<span key="o" className="text-slate-400">Unattributed remainder</span>,
            <span key="v" className="text-slate-400">{pct(100 - 71 - 21.47 - 3 - 1.3, 2)}</span>,
            <span key="n" className="text-slate-400">consistent with &ldquo;other regions, &lt;1% each&rdquo;</span>],
        ]}
      />
      <P>
        Shipment runs from the highlands to <strong>Puerto Cortés</strong> on the Caribbean or{" "}
        <strong>Amapala</strong> on the Pacific. With 71% of volume Europe-bound, Cortés carries the
        strategic weight — a single-port dependency worth naming as a logistics risk.
      </P>

      <H2>10 · Supply and demand, 2010-11 → 2020-21</H2>
      <P>
        Production nearly doubled across the series ({fmt(SD[0].prod)}k → {fmt(last.prod)}k bags), running from
        a trough of {fmt(trough.prod)}k in {trough.y} to a peak of {fmt(peak.prod)}k in {peak.y} — a{" "}
        <strong>{(peak.prod / trough.prod).toFixed(2)}×</strong> range across eleven years. Domestic
        consumption climbed steadily over the same span, {SD[0].dom}k to {last.dom}k. Exports absorb{" "}
        <strong>{pct(expShare)}</strong> of production over the period: this is an export origin with a small
        and slow-growing home market.
      </P>
      <P>
        The shape is a growth trend with one violent interruption. The sharpest year-on-year fall is{" "}
        <strong>{pct(100 * drop.d)}</strong> in <Code>{drop.y}</Code> — which is the season Central
        America&rsquo;s leaf-rust epidemic ran through the region. The dossier does not make that link, and
        this profile cannot confirm it from the balance sheet alone; it is noted because §5 flags rust as the
        one risk the source left unverified, and a 24% single-year hole is the reason that gap is the first
        one worth closing.
      </P>
      <P>
        The quieter story is stocks. Ending stocks went from {SD[0].end}k to{" "}
        <strong>{fmt(last.end)}k</strong> — {(last.end / SD[0].end).toFixed(1)}× — reaching{" "}
        {pct(100 * last.end / (last.exp + last.dom))} of annual offtake in {last.y}. An origin that once
        carried three weeks of cover now carries roughly two months.
      </P>
      <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
          Production, exports and ending stocks — thousand 60-kg bags
        </div>
        <div className="mb-2 text-[10px] text-slate-500">
          One scale for all three series: stocks are genuinely an order of magnitude smaller, and that is the
          point of the chart rather than something to hide with a second axis.
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={SD} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="y" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={12} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={48}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tip} formatter={(v, n) => [fmt(Number(v ?? 0)), String(n)]} />
              <Bar dataKey="prod" name="production" fill={C.green} radius={[3, 3, 0, 0]} />
              <Line dataKey="exp" name="exports" stroke={C.gold} strokeWidth={2} dot={false} />
              <Line dataKey="end" name="ending stocks" stroke={C.rose} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {[["production", C.green], ["exports", C.gold], ["ending stocks", C.rose]].map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}
            </span>
          ))}
        </div>
      </div>
      <RefTable
        head={["Crop year", "Initial", "Production", "Domestic", "Exports", "Imports", "Ending"]}
        rows={SD.map(r => [r.y, fmt(r.init), fmt(r.prod), fmt(r.dom), fmt(r.exp), fmt(r.imp),
          <span key={r.y} className="font-semibold text-slate-200">{fmt(r.end)}</span>])}
      />
      <P className="text-slate-400">
        Thousand 60-kg bags. Every row satisfies{" "}
        <Code>initial + production + imports − exports − domestic = ending</Code> exactly —{" "}
        {SD_BALANCED ? "all 11 years, checked" : "NOT all years — see §11"}.
      </P>

      <H2>11 · What did not reconcile</H2>
      <P>
        Five items. None is fatal to the picture, and all are stated rather than patched, because a profile
        that quietly corrects its source cannot be audited against it later.
      </P>
      <RefTable
        head={["#", "Item", "What the source says", "What checking shows"]}
        rows={[
          ["1", <strong key="a">Coffee = 50% of GDP</strong>, "50% of national GDP",
            "Implausible for any economy — no single crop is half of GDP. Most likely a category slip for a share of AGRICULTURAL GDP or of export earnings. Flagged, not used anywhere in this profile."],
          ["2", <strong key="b">Coffee area unit</strong>, "~350,000 ha",
            `The six regions total ${fmt(T_MZ)} mz — which matches "350k" almost exactly if the unit is MANZANAS, not hectares. In hectares the census gives ${fmt(Math.round(T_MZ * MZ_TO_HA))}. The mz reading is the coherent one.`],
          ["3", <strong key="c">Lempira yield</strong>, "21.12 qq/mz",
            `${fmt(1202235)} qq ÷ ${fmt(49845)} mz = 24.12, not 21.12. Every other region's stated yield reproduces exactly, so this looks like a 4→1 transcription slip. The charts and table above use the computed 24.12.`],
          ["4", <strong key="d">Harvest pace</strong>, "monthly percentages",
            `They sum to ${HARVEST_SUM}%, leaving ${100 - HARVEST_SUM}% unallocated — probably an April tail or rounding. The shape is unaffected.`],
          ["5", <strong key="e">Export total</strong>, `${fmt(EXP_TOTAL)} bags`,
            `Top ten + others = ${fmt(EXP_TOP10 + EXP_OTHERS)}, a difference of ${fmt(EXP_TOTAL - EXP_TOP10 - EXP_OTHERS)} bags. Rounding; noted for completeness.`],
        ]}
      />

      <H2>12 · Open questions</H2>
      <UL>
        <LI><strong>Intercropping</strong> — no data in the source. Shade and companion cropping bear
          directly on climate resilience and on how a farmer&rsquo;s income responds to a price shock.</LI>
        <LI><strong>Leaf rust</strong> — flagged unverified. Given 2012–13, the highest-value gap here.</LI>
        <LI><strong>Trust recoverability</strong> — is the US$9.00 genuinely refundable in practice? It
          decides whether the levy is US$4.25 or US$13.25 per quintal.</LI>
        <LI><strong>Fiscal incentives</strong> — the source raises the question and does not answer it.</LI>
        <LI><strong>Vintage refresh</strong> — the S&amp;D series stops at 2020-21. Recent crop years,
          current differentials and the exporter league are the obvious next update.</LI>
      </UL>

      <P className="text-[10px] text-slate-500">
        Source: 2021 origin dossier (IHCAFE regional census, exporter league, destination split, 11-year
        balance) plus the IHCAFE <em>Ruta del Café</em> regional maps. Every derived figure on this page is
        computed from the tabulated source data at render time rather than transcribed, so a correction to
        the tables propagates through the prose.
      </P>
    </Paper>
  );
}
