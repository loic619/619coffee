"use client";
// Figures for the Differential Model research note. Pure inline SVG so the
// diagrams ship with the note (no chart lib, no data fetch) and render
// identically wherever the note does. Cluster palette validated for the
// dark slate-900 surface (CVD-safe, all boxes also text-labeled):
//   supply #0284c7 · demand #059669 · exchange #8b5cf6 · positioning #d97706

const C = {
  supply: "#0284c7",
  demand: "#059669",
  exchange: "#8b5cf6",
  positioning: "#d97706",
  ink: "#e2e8f0",      // slate-200
  ink2: "#cbd5e1",     // slate-300
  ink3: "#94a3b8",     // slate-400
  muted: "#64748b",    // slate-500
  panel: "#1e293b",    // slate-800
  panelBorder: "#475569", // slate-600
  formula: "#fde68a",  // amber-200 — echoes the Fml panel
  axis: "#334155",     // slate-700
};

function Figure({ label, caption, minWidth, children }: {
  label: string; caption: string; minWidth: number; children: React.ReactNode;
}) {
  return (
    <figure className="my-3">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>{children}</div>
      </div>
      <figcaption className="text-[10px] text-slate-500 italic mt-1 leading-relaxed">
        <span className="font-semibold not-italic text-slate-400">{label}</span> — {caption}
      </figcaption>
    </figure>
  );
}

// ── Fig. 1 · the factor map as a directed graph ─────────────────────────────

type Line = { t: string; em?: boolean };

function ClusterBox({ x, y, w, h, color, title, lines }: {
  x: number; y: number; w: number; h: number; color: string; title: string; lines: Line[];
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={7} fill={color} fillOpacity={0.07}
        stroke={color} strokeOpacity={0.85} strokeWidth={1.4} />
      <rect x={x + 9} y={y + 9} width={7} height={7} rx={1.5} fill={color} />
      <text x={x + 21} y={y + 16} fontSize={9.5} fontWeight={700} fill={C.ink}>{title}</text>
      {lines.map((l, i) => (
        <text key={i} x={x + 9} y={y + 33 + i * 14.5} fontSize={8.8}
          fill={l.em ? C.ink2 : C.ink3} fontWeight={l.em ? 600 : 400}>{l.t}</text>
      ))}
    </g>
  );
}

function NodeBox({ x, y, w, title, sub, role }: {
  x: number; y: number; w: number; title: string; sub: string; role: string;
}) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={58} rx={6} fill={C.panel} fillOpacity={0.6}
        stroke={C.panelBorder} strokeWidth={1} />
      <text x={cx} y={y + 17} fontSize={9.5} fontWeight={700} fill={C.ink} textAnchor="middle">{title}</text>
      <text x={cx} y={y + 32} fontSize={8.5} fill={C.formula} textAnchor="middle" fontFamily="ui-monospace, monospace">{sub}</text>
      <text x={cx} y={y + 47} fontSize={8} fill={C.muted} textAnchor="middle" fontStyle="italic">{role}</text>
    </g>
  );
}

function Arrow({ from, to, color, marker }: {
  from: [number, number]; to: [number, number]; color: string; marker: string;
}) {
  return <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color}
    strokeOpacity={0.7} strokeWidth={1.3} markerEnd={`url(#${marker})`} />;
}

export function FactorMapFigure() {
  const BW = 165, BY = 10, BH = 178;
  const bx = [8, 173, 338, 503];
  return (
    <Figure label="Fig. 1" minWidth={640}
      caption="the factor map as a directed graph — four clusters converge on three intermediate nodes, which resolve into the corridor equation of §2. Dashed ⇢ marks the slow (structural) tree-age state; ÷ marks the conversion ratio entering the crop identity as a divisor.">
      <svg viewBox="0 0 700 414" role="img" className="w-full"
        aria-label="Factor map: supply, demand, exchange economics and positioning clusters feeding the physical S and D balance, the corridor walls and the futures leg, which resolve into the differential equation">
        <defs>
          {(["supply", "demand", "exchange", "positioning"] as const).map(k => (
            <marker key={k} id={`dfm-${k}`} viewBox="0 0 8 8" refX={7} refY={4}
              markerWidth={6} markerHeight={6} orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill={C[k]} fillOpacity={0.85} />
            </marker>
          ))}
          <marker id="dfm-neutral" viewBox="0 0 8 8" refX={7} refY={4}
            markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={C.ink3} />
          </marker>
        </defs>

        <ClusterBox x={bx[0]} y={BY} w={BW} h={BH} color={C.supply} title="SUPPLY" lines={[
          { t: "cost of production ·" },
          { t: "benchmark of other crops" },
          { t: "→ E[profit] vs pre-harvest price" },
          { t: "→ acreage  (hectares)", em: true },
          { t: "× density (trees/ha) ⟵ tree age ⇢", em: true },
          { t: "× yield  (kg cherry per tree)", em: true },
          { t: "    ⟵ weather · fertilizer · irrigation" },
          { t: "÷ conversion (kg cherry → kg green)", em: true },
          { t: "= crop → farmer retention → stocks" },
        ]} />
        <ClusterBox x={bx[1]} y={BY} w={BW} h={BH} color={C.demand} title="DEMAND" lines={[
          { t: "CPI · wages · purchasing power" },
          { t: "→ coffee culture → product mix" },
          { t: "→ grams per cup × cups per capita" },
          { t: "× population → consumption", em: true },
          { t: "blend switch (arabica ↔ robusta)" },
          { t: "destination vs origin demand" },
          { t: "destination stocks as buffer" },
        ]} />
        <ClusterBox x={bx[2]} y={BY} w={BW} h={BH} color={C.exchange} title="EXCHANGE ECONOMICS" lines={[
          { t: "FOB + freight + warehousing" },
          { t: "+ loading-out + allowances" },
          { t: "→ tenderable parity TP", em: true },
          { t: "certified stocks · ageing · EUDR" },
          { t: "grade / squeeze / stop motivations" },
          { t: "structure (carry ↔ inversion)" },
          { t: "origin substitution · dest. stocks" },
          { t: "→ replacement parity RP", em: true },
        ]} />
        <ClusterBox x={bx[3]} y={BY} w={BW} h={BH} color={C.positioning} title="POSITIONING" lines={[
          { t: "COT cohorts · OI repartition" },
          { t: "signals · dry powder · CTA" },
          { t: "option curve · sentiment ·" },
          { t: "conviction" },
          { t: "macro:  E.CY / I.CY · rates" },
          { t: "→ moves reference F in hours", em: true },
          { t: "    (physicals re-quote in days)" },
        ]} />

        <Arrow from={[90, BY + BH]} to={[140, 240]} color={C.supply} marker="dfm-supply" />
        <Arrow from={[255, BY + BH]} to={[220, 240]} color={C.demand} marker="dfm-demand" />
        <Arrow from={[420, BY + BH]} to={[421, 240]} color={C.exchange} marker="dfm-exchange" />
        <Arrow from={[585, BY + BH]} to={[613, 240]} color={C.positioning} marker="dfm-positioning" />

        <NodeBox x={60} y={240} w={240} title="PHYSICAL S&D BALANCE"
          sub="z — flow-pressure index β′X" role="sets the position between the walls" />
        <NodeBox x={316} y={240} w={210} title="CORRIDOR WALLS"
          sub="TP & RP  (+ squeeze overlay)" role="bounds the process" />
        <NodeBox x={534} y={240} w={158} title="FUTURES LEG F"
          sub="ε — transitory basis shock" role="high-frequency dynamics" />

        <Arrow from={[180, 298]} to={[280, 334]} color={C.ink3} marker="dfm-neutral" />
        <Arrow from={[421, 298]} to={[365, 334]} color={C.ink3} marker="dfm-neutral" />
        <Arrow from={[613, 298]} to={[460, 334]} color={C.ink3} marker="dfm-neutral" />

        <rect x={130} y={334} width={440} height={66} rx={8} fill={C.panel} fillOpacity={0.7}
          stroke={C.muted} strokeWidth={1.2} />
        <text x={350} y={363} fontSize={13} fill={C.formula} textAnchor="middle"
          fontFamily="ui-monospace, monospace">D(t) = TP + (RP − TP)·σ(z) + ε</text>
        <text x={350} y={382} fontSize={8.5} fill={C.muted} textAnchor="middle" fontStyle="italic">
          the differential — walls from exchange economics · position from S&D · shocks from the futures leg
        </text>
      </svg>
    </Figure>
  );
}

// ── Fig. 2 · corridor mechanics in differential space ───────────────────────

const RP_PTS = "44,74 180,70 330,66 500,66 530,74 562,82 594,76 645,68 676,66";
const TP_PTS = "44,220 180,222 330,224 500,224 530,230 562,236 594,232 645,226 676,224";
const D_PTS = [
  "44,150", "92,140", "138,142", "188,132", "230,142", "264,148",   // drifting on S&D
  "271,150", "277,196",                                              // positioning shock: gap down
  "295,176", "316,162", "340,152",                                   // mean-reversion
  "395,146", "440,150", "482,152",                                    // drifting again
  "516,162", "538,182", "560,205", "583,224",                        // squeeze: pressed into the wall
  "614,196", "645,178", "676,168",                                    // release
].join(" ");

export function CorridorFigure() {
  return (
    <Figure label="Fig. 2" minWidth={640}
      caption="corridor mechanics in differential space. Exchange economics builds the walls (TP below, RP above); S&D flow pressure sets σ(z), the position between them; the futures leg injects transitory ε shocks that mean-revert as physicals re-quote; squeeze windows near notice periods temporarily bend the walls.">
      <svg viewBox="0 0 700 294" role="img" className="w-full"
        aria-label="Schematic of the differential path bounded between the tenderable-parity lower wall and the replacement-parity upper wall, with a mean-reverting positioning shock and a squeeze window that bends the walls">
        <defs>
          <marker id="dfc-arrow" viewBox="0 0 8 8" refX={7} refY={4}
            markerWidth={5.5} markerHeight={5.5} orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={C.muted} />
          </marker>
        </defs>

        {/* corridor band + squeeze window */}
        <polygon points={`${RP_PTS} ${TP_PTS.split(" ").reverse().join(" ")}`}
          fill={C.exchange} fillOpacity={0.07} />
        <rect x={514} y={28} width={92} height={234} fill={C.positioning} fillOpacity={0.07} />
        <text x={560} y={40} fontSize={8.5} fill={C.ink2} textAnchor="middle" fontWeight={600}>squeeze window</text>
        <text x={560} y={50} fontSize={8} fill={C.muted} textAnchor="middle">(notice period — walls bend)</text>

        {/* walls */}
        <polyline points={RP_PTS} fill="none" stroke={C.exchange} strokeWidth={2} />
        <polyline points={TP_PTS} fill="none" stroke={C.exchange} strokeWidth={2} />
        <line x1={44} y1={56} x2={56} y2={56} stroke={C.exchange} strokeWidth={2} />
        <text x={60} y={59} fontSize={8.5} fill={C.ink2}>RP — replacement parity (upper wall)</text>
        <line x1={44} y1={244} x2={56} y2={244} stroke={C.exchange} strokeWidth={2} />
        <text x={60} y={247} fontSize={8.5} fill={C.ink2}>TP — tenderable parity (lower wall)</text>

        {/* wall arbitrage mechanisms */}
        <line x1={268} y1={50} x2={268} y2={62} stroke={C.muted} strokeWidth={1} markerEnd="url(#dfc-arrow)" />
        <text x={276} y={56} fontSize={8} fill={C.muted}>substitution / destocking caps the top</text>
        <line x1={300} y1={246} x2={300} y2={232} stroke={C.muted} strokeWidth={1} markerEnd="url(#dfc-arrow)" />
        <text x={308} y={248} fontSize={8} fill={C.muted}>tender / grading arbitrage floors the bottom</text>

        {/* σ(z) — position in corridor */}
        <line x1={165} y1={78} x2={165} y2={218} stroke={C.muted} strokeWidth={1}
          strokeDasharray="3 3" markerStart="url(#dfc-arrow)" markerEnd="url(#dfc-arrow)" />
        <circle cx={165} cy={141} r={3} fill={C.supply} stroke="#0f172a" strokeWidth={1.5} />
        <text x={173} y={104} fontSize={8.5} fill={C.ink3}>σ(z) — S&D flow pressure</text>
        <text x={173} y={115} fontSize={8.5} fill={C.ink3}>sets the position in the corridor</text>

        {/* the differential path */}
        <polyline points={D_PTS} fill="none" stroke={C.supply} strokeWidth={2.25}
          strokeLinejoin="round" strokeLinecap="round" />
        <line x1={44} y1={17} x2={56} y2={17} stroke={C.supply} strokeWidth={2.25} />
        <text x={60} y={20} fontSize={8.5} fill={C.ink} fontWeight={600}>D(t) — the differential</text>

        {/* ε — the transitory shock */}
        <text x={285} y={206} fontSize={8.5} fill={C.ink3}>ε — positioning shock: F jumps in hours, D gaps,</text>
        <text x={285} y={217} fontSize={8.5} fill={C.ink3}>then mean-reverts as physicals re-quote</text>

        {/* time axis */}
        <line x1={44} y1={272} x2={676} y2={272} stroke={C.axis} strokeWidth={1} markerEnd="url(#dfc-arrow)" />
        <text x={676} y={286} fontSize={8.5} fill={C.muted} textAnchor="end">time →</text>
      </svg>
    </Figure>
  );
}
