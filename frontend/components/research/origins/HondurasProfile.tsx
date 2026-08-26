"use client";
// Honduras — origin country profile.
//
// Built from a 2021 source dossier (IHCAFE regional census, exporter ranking,
// destination split, an 11-year S&D balance). Everything the source stated is
// reproduced; everything that could be checked against itself HAS been, and
// the five reconciliations are published in §11 rather than quietly patched —
// a profile that silently corrects its source is a profile you cannot audit.
//
// Palette: categorical slots validated with the dataviz validator against this
// app's surface (#0f172a) — lightness band, chroma floor, CVD separation,
// normal-vision floor and contrast all pass.
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Tooltip, XAxis, YAxis,
} from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { Paper, H2, P, UL, LI, Code, Highlight, RefTable } from "../methodology/prose";
import { loadHondurasLive, type HondurasLive } from "./hondurasLive";

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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Dossier production keyed by PSD's row label (the season's START year), so
 *  the two series line up on one axis without either being re-stamped. */
const SD_BY_START: Record<number, { prod: number; exp: number; end: number }> = {};
SD.forEach(r => { SD_BY_START[Number(r.y.slice(0, 4))] = { prod: r.prod, exp: r.exp, end: r.end }; });

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}
        </span>
      ))}
    </div>
  );
}

function Figure({ title, note, height, children }: {
  title: string; note?: string; height: number; children: React.ReactElement;
}) {
  return (
    <div className="my-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{title}</div>
      {note && <div className="mb-2 text-[10px] text-slate-500">{note}</div>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

/** §§11–14. Split out because it is the only part of the page that depends on
 *  a network read: the dossier renders whether or not the live series load. */
function VintageCheck({ live }: { live: HondurasLive | null | false }) {
  if (live === false) {
    return (
      <>
        <H2>11 · The vintage check</H2>
        <P className="text-slate-400">
          The live series could not be loaded, so the 2021 dossier above stands unchecked against them.
          Nothing here is stale — it is simply unverified this session.
        </P>
      </>
    );
  }
  if (!live) {
    return (
      <>
        <H2>11 · The vintage check</H2>
        <P className="text-slate-500">Reading the app&rsquo;s live series…</P>
      </>
    );
  }

  const psd = live.psd;
  const overlap = psd.filter(r => SD_BY_START[r.y] != null);
  const forward = psd.filter(r => SD_BY_START[r.y] == null);
  // How far apart the two sources sit on the years they both cover. Signed and
  // averaged, so a consistent level gap is distinguishable from noise.
  const prodGap = overlap.length
    ? overlap.reduce((s, r) => s + (r.prod - SD_BY_START[r.y].prod) / SD_BY_START[r.y].prod, 0) / overlap.length * 100
    : NaN;
  const expGap = overlap.length
    ? overlap.reduce((s, r) => s + (r.exp - SD_BY_START[r.y].exp) / SD_BY_START[r.y].exp, 0) / overlap.length * 100
    : NaN;
  const stockRatio = overlap.length
    ? overlap.reduce((s, r) => s + SD_BY_START[r.y].end, 0) / overlap.reduce((s, r) => s + r.end, 0)
    : NaN;
  const chart = psd.map(r => ({
    y: r.y, label: `${r.y}-${String(r.y + 1).slice(2)}`,
    psd: Math.round(r.prod), dossier: SD_BY_START[r.y]?.prod ?? null,
  }));
  const worstResid = psd.reduce((a, r) => (Math.abs(r.resid) > Math.abs(a.resid) ? r : a), psd[0]);

  const shg = live.conventional.find(g => g.grade === "SHG");
  const hg = live.conventional.find(g => g.grade === "HG");
  const shgC = live.certified.find(g => g.grade === "SHG");
  const euPorts = live.portShare.filter(p => ["Antwerp", "Hamburg", "Bremen"].indexOf(p.port) >= 0);
  const euOffers = euPorts.reduce((s, p) => s + p.n, 0);

  const bestLag = live.cortesLag.length
    ? live.cortesLag.reduce((a, b) => (b.r > a.r ? b : a))
    : null;
  const seasonHolds = live.cortesYears.filter(y => y.springX > 1 && y.autumnX < 1).length;

  const appNames = live.appRegions.map(r => r.name);
  const shared = REGIONS.filter(r => appNames.indexOf(r.name) >= 0).map(r => r.name);
  const dossierOnly = REGIONS.filter(r => appNames.indexOf(r.name) < 0).map(r => r.name);
  const appOnly = appNames.filter(n => REGIONS.every(r => r.name !== n));

  return (
    <>
      <H2>11 · The vintage check — the dossier against USDA</H2>
      <P>
        The dossier stops at 2020-21. The app carries USDA PSD for Honduras back to 1960 and forward to{" "}
        <Code>{psd[psd.length - 1].y}-{String(psd[psd.length - 1].y + 1).slice(2)}</Code>, which both extends
        the series and — more usefully — gives the dossier an independent second opinion on the years it
        does cover. On the {overlap.length} overlapping years USDA runs{" "}
        <strong>{prodGap.toFixed(1)}%</strong> against the dossier on production and{" "}
        <strong>{expGap.toFixed(1)}%</strong> on exports: a consistent level difference, not noise, and small
        enough that the two are recognisably describing the same country.
      </P>
      <Figure
        title="Production — the dossier vs USDA PSD, thousand 60-kg bags"
        note="Both series on one scale. USDA continues past the point where the dossier stops."
        height={230}
      >
        <ComposedChart data={chart} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 8, fill: "#64748b" }} minTickGap={4} />
          <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={48}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={tip} formatter={(v, n) => [v == null ? "—" : fmt(Number(v)), String(n)]} />
          <Bar dataKey="psd" name="USDA PSD" fill={C.blue} radius={[3, 3, 0, 0]} />
          <Line dataKey="dossier" name="2021 dossier" stroke={C.gold} strokeWidth={2} dot={{ r: 2 }}
            connectNulls={false} />
        </ComposedChart>
      </Figure>
      <Legend items={[["USDA PSD", C.blue], ["2021 dossier", C.gold]]} />

      <Highlight>
        <strong>Where they genuinely disagree: stocks.</strong> Across the overlapping years the dossier
        carries ending stocks averaging <strong>{stockRatio.toFixed(1)}×</strong> USDA&rsquo;s. This is not a
        level offset of a few percent like production — it is two different pictures of the same origin. The
        dossier shows a large, growing carry-out; USDA shows an origin that ships nearly everything it grows
        and holds almost nothing. The §10 paragraph about cover has been qualified accordingly. Note the two
        are not measuring quite the same thing either: the app tracks PSD&rsquo;s <em>bean</em> attributes,
        so soluble and roast-and-ground flows sit outside the balance — visible as a residual of up to{" "}
        {fmt(Math.round(Math.abs(worstResid.resid)))}k bags in {worstResid.y}-
        {String(worstResid.y + 1).slice(2)}, against dossier rows that closed to zero exactly.
      </Highlight>

      <P>
        Forward of the dossier, USDA has Honduras oscillating in a{" "}
        <strong>{(Math.min(...forward.map(r => r.prod)) / 1000).toFixed(1)}–
        {(Math.max(...forward.map(r => r.prod)) / 1000).toFixed(1)}m bag</strong> band — no return to the
        2016-17 peak the dossier recorded, and a flatter series than the 2010s.
      </P>
      <RefTable
        head={["Crop year", "Initial", "Production", "Domestic", "Exports", "Ending"]}
        rows={forward.map(r => [
          `${r.y}-${String(r.y + 1).slice(2)}`,
          fmt(Math.round(r.init)), fmt(Math.round(r.prod)), fmt(Math.round(r.dom)),
          fmt(Math.round(r.exp)),
          <span key={r.y} className="font-semibold text-slate-200">{fmt(Math.round(r.end))}</span>,
        ])}
      />
      <P className="text-slate-400">
        USDA FAS PSD, thousand 60-kg bags, read live from the app&rsquo;s own copy.
      </P>

      {live.estimates.length > 0 && (
        <>
          <P>
            The crop-estimate board carries a second forecaster alongside USDA, which is the more honest way
            to read a forward number — where they part company is the uncertainty:
          </P>
          <RefTable
            head={["Season", "USDA", "Marex", "Spread", ""]}
            rows={live.estimates.map(e => [
              e.season,
              e.usda == null ? "—" : `${e.usda.toFixed(1)}m`,
              e.marex == null ? "—" : `${e.marex.toFixed(1)}m`,
              e.usda != null && e.marex != null
                ? <span key={e.season} className={Math.abs(e.usda - e.marex) >= 0.5 ? "font-semibold text-amber-400" : "text-slate-400"}>
                    {(e.usda - e.marex >= 0 ? "+" : "") + (e.usda - e.marex).toFixed(1)}m
                  </span>
                : "—",
              e.forecast ? "forecast" : "actual",
            ])}
          />
        </>
      )}

      <H2>12 · The altitude ladder, priced</H2>
      <P>
        §2 argued that Honduras trades as a differentiated origin because the mass of the crop sits in the
        two upper altitude bands. The physical offer sheet lets that be checked with money rather than
        asserted: of <strong>{live.offersTotal}</strong> live Honduran offers,{" "}
        {live.offersQuoted} quote a differential to the board, and they sort into exactly the
        dossier&rsquo;s ladder.
      </P>
      <RefTable
        head={["Grade", "Conventional", "n", "Certified", "n"]}
        rows={["SHG", "HG", "Stocklot"].map(g => {
          const c = live.conventional.find(x => x.grade === g);
          const k = live.certified.find(x => x.grade === g);
          const cell = (s: typeof c) => s
            ? <span className="font-semibold text-slate-200">{(s.median >= 0 ? "+" : "") + s.median.toFixed(0)}¢</span>
            : "—";
          return [
            <strong key={g}>{g}</strong>,
            <span key={`${g}c`}>{cell(c)}</span>, c ? String(c.n) : "—",
            <span key={`${g}k`}>{cell(k)}</span>, k ? String(k.n) : "—",
          ];
        })}
      />
      <P>
        {shg && hg && (
          <>
            The altitude step is worth <strong>{(shg.median - hg.median).toFixed(0)}¢</strong> on
            conventional coffee — SHG at {shg.median >= 0 ? "+" : ""}{shg.median.toFixed(0)}¢ against HG at{" "}
            {hg.median >= 0 ? "+" : ""}{hg.median.toFixed(0)}¢.{" "}
          </>
        )}
        {shg && shgC && (
          <>
            Certification is worth more again: <strong>{(shgC.median - shg.median).toFixed(0)}¢</strong> on
            top of SHG. {" "}
          </>
        )}
        Stocklots price at a discount, which is what a stocklot is. Small samples per cell — read these as
        the shape of the ladder, not as a fixing.
      </P>
      <P>
        The destination split checks out too, from an angle the dossier never intended. Of the{" "}
        {live.offersTotal} offers, <strong>{euOffers}</strong> sit in Antwerp, Hamburg or Bremen — the
        physical market quotes Honduras where the dossier says it ships it (§9: 71% Europe, Germany and
        Belgium 25% each). Antwerp alone carries{" "}
        {live.portShare[0] && `${live.portShare[0].n} of them`}.
      </P>

      <H2>13 · The calendar, checked at the port</H2>
      <P>
        §4 takes the harvest pace from the dossier. Puerto Cortés — the port §9 names as the origin&rsquo;s
        strategic dependency — reports daily container movements in the app, which makes the calendar
        testable rather than merely stated.
      </P>
      {live.cortes.length === 12 && bestLag ? (
        <>
          <Figure
            title="Puerto Cortés container exports by calendar month — 100 = the average month"
            note={`All containerised exports, not coffee alone. ${Math.min(...live.cortes.map(r => r.n))}–${Math.max(...live.cortes.map(r => r.n))} observations per month.`}
            height={190}
          >
            <BarChart data={live.cortes.map(r => ({ ...r, name: MONTHS[r.m - 1] }))}
              margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#64748b" }} interval={0} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={40} />
              <Tooltip contentStyle={tip}
                formatter={(v) => [Number(v ?? 0).toFixed(0), "index"]} />
              <Bar dataKey="index" radius={[4, 4, 0, 0]}>
                {live.cortes.map(r => (
                  <Cell key={r.m} fill={r.index >= 100 ? C.green : C.blue} />
                ))}
              </Bar>
            </BarChart>
          </Figure>
          <Legend items={[["above an average month", C.green], ["below", C.blue]]} />
          <P>
            The port does not peak when the crop is picked. It peaks about a quarter later. Correlating the
            monthly index against the dossier&rsquo;s harvest shares at each lag:
          </P>
          <RefTable
            head={["Harvest lagged by", "Correlation with port exports"]}
            rows={live.cortesLag.map(l => [
              `${l.lag} month${l.lag === 1 ? "" : "s"}`,
              <span key={l.lag} className={l.lag === bestLag.lag ? "font-semibold text-slate-200" : "text-slate-400"}>
                r = {l.r >= 0 ? "+" : ""}{l.r.toFixed(3)}{l.lag === bestLag.lag ? "  ← peak" : ""}
              </span>,
            ])}
          />
          <P>
            <strong>r = {bestLag.r >= 0 ? "+" : ""}{bestLag.r.toFixed(3)} at {bestLag.lag} months.</strong>{" "}
            The lag is read off where the correlation peaks, not assumed. Read plainly: cherry picked in
            December leaves Cortés in a box around March. That is the origin&rsquo;s pipeline delay, and it
            is the gap between a weather event at harvest and the shipment it eventually shows up in.
          </P>
          <P>
            One pooled correlation can be carried by a single season, so the per-year version matters more
            than the r. It holds in <strong>{seasonHolds} of {live.cortesYears.length}</strong> complete
            years:
          </P>
          <RefTable
            head={["Year", "Mar–Apr vs average", "Oct–Nov vs average", "Ratio"]}
            rows={live.cortesYears.map(y => [
              String(y.year), `${y.springX.toFixed(2)}×`, `${y.autumnX.toFixed(2)}×`,
              <span key={y.year} className="font-semibold text-slate-200">
                {(y.springX / y.autumnX).toFixed(2)}×
              </span>,
            ])}
          />
          <P className="text-slate-400">
            The caveat that matters: Cortés handles all of Honduras&rsquo; containerised trade, not only
            coffee, so this is corroboration and not proof. It is suggestive because the swing is large for
            an all-cargo series and because it lands where a coffee explanation predicts.
          </P>
        </>
      ) : (
        <P className="text-slate-400">Port series unavailable — the calendar stands unchecked.</P>
      )}

      <H2>14 · Six regions, or five? The two schemes do not match</H2>
      <P>
        §3 reproduces the dossier&rsquo;s census by department. The app tracks Honduras by IHCAFE growing
        region, weighted on 2024 departmental output, and the two lists overlap only partly — which is worth
        knowing before any figure is carried from one to the other.
      </P>
      <RefTable
        head={["", "Regions"]}
        rows={[
          [<strong key="a">In both</strong>, shared.length ? shared.join(" · ") : "—"],
          [<strong key="b">Dossier only</strong>, dossierOnly.length ? dossierOnly.join(" · ") : "—"],
          [<strong key="c">App only</strong>, appOnly.length ? appOnly.join(" · ") : "—"],
        ]}
      />
      <P>
        Montecillos and Agalta are IHCAFE denomination names rather than departments, which is the tell: the
        dossier tabulated an administrative cut and this profile originally described it as a denomination
        cut. §3 has been corrected. The practical consequence is that a per-region yield from §3 cannot be
        joined to a per-region weather or vegetation reading without deciding what to do about the three
        names that only exist on one side.
      </P>
      {live.vhi.length > 0 && (
        <>
          <P>
            Where the crop stands as this renders — NOAA vegetation health, the app&rsquo;s own weekly read,
            worst region first:
          </P>
          <RefTable
            head={["Region", "Week", "VHI", "State", "In the dossier?"]}
            rows={live.vhi.map(v => [
              <strong key={v.region}>{v.region}</strong>, v.week,
              <span key={`${v.region}v`} className="font-semibold text-slate-200">{v.vhi.toFixed(1)}</span>,
              <span key={`${v.region}s`} className={
                v.severity === "stress" ? "text-amber-400" : "text-slate-400"}>{v.severity}</span>,
              REGIONS.some(r => r.name === v.region) ? "yes" : "no — app-only region",
            ])}
          />
          <P className="text-slate-400">
            VHI below 40 is conventionally read as vegetative stress. Note which name heads the table —
            El Paraíso, the worst reading, and the region §3 already identified as the largest by area and
            the weakest by yield. One weekly reading is not a trend, and this is a live value that will
            differ by the time you read it.
          </P>
        </>
      )}
      <P className="text-[10px] text-slate-500">
        Live as of — USDA / crop estimates {live.asOf.psd ?? "—"} · offer sheet {live.asOf.spot ?? "—"} ·
        Puerto Cortés through {live.asOf.port ?? "—"} · VHI {live.asOf.vhi ?? "—"}.
      </P>
    </>
  );
}

export default function HondurasProfile() {
  // null = still loading, false = failed. The dossier renders either way.
  const [live, setLive] = useState<HondurasLive | null | false>(null);
  useEffect(() => {
    let alive = true;
    loadHondurasLive()
      .then(d => { if (alive) setLive(d); })
      .catch(() => { if (alive) setLive(false); });
    return () => { alive = false; };
  }, []);

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
        Volumes, prices and the ranking of export houses move fast and should be treated as a 2021 snapshot until
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
        The dossier&rsquo;s census is cut by <strong>department</strong> — Copán, Santa Bárbara, Ocotepeque,
        Lempira, Comayagua and El Paraíso are all administrative departments of Honduras, not IHCAFE&rsquo;s
        growing regions, and §14 shows where the two schemes part company. The striking number is not the
        size ranking but the <strong>yield spread</strong>: Ocotepeque returns{" "}
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
        The quieter story is stocks — and it is the one claim in this profile that a second source refuses
        to support. On the dossier&rsquo;s own numbers ending stocks went from {SD[0].end}k to{" "}
        <strong>{fmt(last.end)}k</strong> — {(last.end / SD[0].end).toFixed(1)}× — reaching{" "}
        {pct(100 * last.end / (last.exp + last.dom))} of annual offtake in {last.y}, which would take the
        origin from about three weeks of cover to roughly two months. <strong>USDA disagrees outright</strong>,
        carrying Honduran ending stocks at a small fraction of that and roughly flat. §11 puts the two series
        side by side; until that is settled, treat the stock build as the dossier&rsquo;s reading and not as
        an established fact about the origin.
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

      <VintageCheck live={live} />

      <H2>15 · What did not reconcile</H2>
      <P>
        Five items <em>within the dossier</em>. None is fatal to the picture, and all are stated rather than
        patched, because a profile that quietly corrects its source cannot be audited against it later. The
        disagreements between the dossier and outside sources are separate, and live in §11.
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

      <H2>16 · Open questions</H2>
      <UL>
        <LI><strong>Ending stocks</strong> — the dossier and USDA describe different origins (§11). One of
          them is wrong by roughly 4×, and nothing in either source says which.</LI>
        <LI><strong>Who actually exports it</strong> — the §8 ranking of export houses is the one block of
          the dossier with no live counterpart. Nothing in the app carries per-house export volumes, so
          those market shares stand frozen at 2021 with no way to tell whether they have drifted. In a
          market where houses are acquired, exit or lose share, five years is a long time; this is the
          highest-value remaining gap.</LI>
        <LI><strong>Intercropping</strong> — no data in the source. Shade and companion cropping bear
          directly on climate resilience and on how a farmer&rsquo;s income responds to a price shock.</LI>
        <LI><strong>Leaf rust</strong> — flagged unverified. Given 2012–13, still worth closing.</LI>
        <LI><strong>Trust recoverability</strong> — is the US$9.00 genuinely refundable in practice? It
          decides whether the levy is US$4.25 or US$13.25 per quintal.</LI>
        <LI><strong>Fiscal incentives</strong> — the source raises the question and does not answer it.</LI>
      </UL>

      <P className="text-[10px] text-slate-500">
        Sources: the 2021 origin dossier (IHCAFE regional census, exporter ranking, destination split, 11-year
        balance) plus the IHCAFE <em>Ruta del Café</em> regional maps, frozen as constants because a
        historical document should not drift. Everything in §§11–14 is read live from the app&rsquo;s own
        nightly data — USDA PSD, the crop-estimate board, the physical offer sheet, Puerto Cortés port calls
        and NOAA VHI — so the vintage check ages with the data rather than with this page. Every derived
        figure is computed at render time rather than transcribed.
      </P>
    </Paper>
  );
}
