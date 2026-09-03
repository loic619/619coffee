"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useContract } from "@/lib/useContract";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";

type LabelFmt = NonNullable<TooltipContentProps<ValueType, NameType>["labelFormatter"]>;

interface SeriesPoint { day: number; oi?: number; price?: number; }
interface Series { symbol: string; label: string; fnd: string | null; data: SeriesPoint[]; }
// Pre-computed front calendar spread (front-FND contract − contract after it),
// indexed to the FRONT contract's day-to-FND. Computed by the backend because
// the next contract's days-to-its-own-FND fall outside the chart's [-45, 0]
// window when the front is near rollover, so a frontend join over individual
// series would render all-null.
interface FrontSpread {
  frontSym: string;
  nextSym:  string;
  frontLabel: string;
  nextLabel:  string;
  data: { day: number; spread: number }[];
}

const COLORS = [
  "#94a3b8","#64748b","#475569","#334155","#cbd5e1",
  "#a8a29e","#78716c","#57534e","#d6d3d1","#e7e5e4",
];
const NEXT_CONTRACT_COLOR = "#ef4444";
// Spread line — amber so it's distinguishable from the grey OI lines and the
// red next-FND OI highlight.
const SPREAD_COLOR = "#fbbf24";

// ── Embedded static data (real OI, last 30 trading days before each FND) ──────

const STATIC_SERIES: Record<"robusta" | "arabica", Series[]> = {
  arabica: [
    { symbol:"KCH25", label:"H25", fnd:"2025-02-20", data:[{day:-30,oi:89497},{day:-29,oi:88403},{day:-28,oi:86918},{day:-27,oi:85969},{day:-26,oi:84983},{day:-25,oi:85666},{day:-24,oi:84324},{day:-22,oi:83990},{day:-21,oi:83285},{day:-20,oi:83154},{day:-19,oi:81304},{day:-18,oi:81227},{day:-17,oi:78499},{day:-16,oi:78081},{day:-15,oi:75676},{day:-14,oi:73495},{day:-13,oi:69709},{day:-12,oi:66901},{day:-11,oi:64817},{day:-10,oi:62830},{day:-9,oi:58553},{day:-8,oi:53537},{day:-7,oi:48263},{day:-6,oi:42591},{day:-5,oi:27867},{day:-4,oi:20026},{day:-2,oi:14573},{day:-1,oi:6292},{day:0,oi:1880}] },
    { symbol:"KCK25", label:"K25", fnd:"2025-04-22", data:[{day:-30,oi:78052},{day:-29,oi:78067},{day:-28,oi:77434},{day:-27,oi:76441},{day:-26,oi:75091},{day:-25,oi:75292},{day:-24,oi:75405},{day:-23,oi:75631},{day:-22,oi:72779},{day:-21,oi:73268},{day:-20,oi:72227},{day:-19,oi:71628},{day:-18,oi:70746},{day:-17,oi:67914},{day:-16,oi:65592},{day:-15,oi:63124},{day:-14,oi:60922},{day:-13,oi:59521},{day:-12,oi:57556},{day:-11,oi:53961},{day:-10,oi:48364},{day:-9,oi:43124},{day:-8,oi:34644},{day:-7,oi:28584},{day:-6,oi:17728},{day:-5,oi:13004},{day:-4,oi:7838},{day:-3,oi:5750},{day:-1,oi:2502},{day:0,oi:988}] },
    { symbol:"KCN25", label:"N25", fnd:"2025-06-20", data:[{day:-30,oi:68784},{day:-29,oi:68718},{day:-28,oi:66783},{day:-27,oi:65006},{day:-26,oi:61647},{day:-25,oi:60889},{day:-24,oi:60196},{day:-23,oi:59485},{day:-22,oi:59174},{day:-21,oi:59201},{day:-20,oi:57794},{day:-18,oi:56247},{day:-17,oi:55186},{day:-16,oi:53614},{day:-15,oi:53004},{day:-14,oi:51795},{day:-13,oi:51993},{day:-12,oi:51018},{day:-11,oi:49475},{day:-10,oi:45776},{day:-9,oi:43057},{day:-8,oi:38351},{day:-7,oi:29241},{day:-6,oi:24848},{day:-5,oi:16608},{day:-4,oi:10078},{day:-3,oi:6955},{day:-2,oi:4032},{day:0,oi:942}] },
    { symbol:"KCU25", label:"U25", fnd:"2025-08-21", data:[{day:-30,oi:70666},{day:-29,oi:70560},{day:-28,oi:68411},{day:-27,oi:66469},{day:-26,oi:65563},{day:-25,oi:65441},{day:-24,oi:64888},{day:-23,oi:64648},{day:-22,oi:64762},{day:-21,oi:64730},{day:-20,oi:64182},{day:-19,oi:63578},{day:-18,oi:63248},{day:-17,oi:62057},{day:-16,oi:61039},{day:-15,oi:60033},{day:-14,oi:59571},{day:-13,oi:58036},{day:-12,oi:57246},{day:-11,oi:56310},{day:-10,oi:52301},{day:-9,oi:45672},{day:-8,oi:36856},{day:-7,oi:28622},{day:-6,oi:23805},{day:-5,oi:19895},{day:-4,oi:15532},{day:-3,oi:12553},{day:-2,oi:9706},{day:-1,oi:5787},{day:0,oi:1326}] },
    { symbol:"KCZ25", label:"Z25", fnd:"2025-11-20", data:[{day:-30,oi:71888},{day:-29,oi:71822},{day:-28,oi:72230},{day:-27,oi:72600},{day:-26,oi:72319},{day:-25,oi:71223},{day:-24,oi:69916},{day:-23,oi:70466},{day:-22,oi:69963},{day:-21,oi:69938},{day:-20,oi:68924},{day:-19,oi:67523},{day:-18,oi:65912},{day:-17,oi:64465},{day:-16,oi:62232},{day:-15,oi:60078},{day:-14,oi:59273},{day:-13,oi:58684},{day:-12,oi:57123},{day:-11,oi:54996},{day:-10,oi:49619},{day:-9,oi:45835},{day:-8,oi:42630},{day:-7,oi:37993},{day:-6,oi:35306},{day:-5,oi:22345},{day:-4,oi:15340},{day:-3,oi:10964},{day:-2,oi:7534},{day:-1,oi:1806},{day:0,oi:1690}] },
    { symbol:"KCH26", label:"H26", fnd:"2026-02-19", data:[{day:-30,oi:76560},{day:-29,oi:77206},{day:-28,oi:74796},{day:-27,oi:74080},{day:-26,oi:72554},{day:-25,oi:72503},{day:-24,oi:71170},{day:-22,oi:70785},{day:-21,oi:68744},{day:-20,oi:67945},{day:-19,oi:67429},{day:-18,oi:67832},{day:-17,oi:66393},{day:-16,oi:64217},{day:-15,oi:62567},{day:-14,oi:61528},{day:-13,oi:60702},{day:-12,oi:58747},{day:-11,oi:57287},{day:-10,oi:53584},{day:-9,oi:49005},{day:-8,oi:43629},{day:-7,oi:37454},{day:-6,oi:30095},{day:-5,oi:17584},{day:-4,oi:10993},{day:-2,oi:8053},{day:-1,oi:4055},{day:0,oi:1294}] },
    { symbol:"KCK26", label:"K26", fnd:"2026-04-22", data:[{day:-30,oi:73654},{day:-29,oi:70773},{day:-28,oi:70305},{day:-27,oi:70173},{day:-26,oi:70784},{day:-25,oi:68988},{day:-24,oi:68610},{day:-23,oi:68457},{day:-22,oi:66602},{day:-21,oi:64198},{day:-20,oi:61395},{day:-19,oi:59558},{day:-18,oi:58271},{day:-17,oi:58305},{day:-16,oi:58799},{day:-15,oi:57211},{day:-14,oi:57211},{day:-13,oi:55365},{day:-12,oi:54345},{day:-11,oi:50999},{day:-10,oi:46545},{day:-9,oi:38438}] },
  ],
  robusta: [
    { symbol:"RMF25", label:"F25", fnd:"2024-12-26", data:[{day:-30,oi:36662},{day:-29,oi:37076},{day:-28,oi:37380},{day:-27,oi:36993},{day:-26,oi:35314},{day:-25,oi:35514},{day:-24,oi:35033},{day:-23,oi:34434},{day:-22,oi:33621},{day:-21,oi:33246},{day:-20,oi:31224},{day:-19,oi:29838},{day:-18,oi:28255},{day:-17,oi:25097},{day:-16,oi:23769},{day:-15,oi:21683},{day:-14,oi:20972},{day:-13,oi:20150},{day:-12,oi:19184},{day:-11,oi:15838},{day:-10,oi:14531},{day:-9,oi:13390},{day:-8,oi:12853},{day:-7,oi:11859},{day:-6,oi:9398},{day:-5,oi:5245},{day:-4,oi:3432},{day:-3,oi:2663},{day:-2,oi:1280}] },
    { symbol:"RMH25", label:"H25", fnd:"2025-02-25", data:[{day:-30,oi:37696},{day:-29,oi:37458},{day:-28,oi:36573},{day:-27,oi:35624},{day:-26,oi:36975},{day:-25,oi:36602},{day:-24,oi:36333},{day:-23,oi:36101},{day:-22,oi:35742},{day:-21,oi:34557},{day:-20,oi:33732},{day:-19,oi:32586},{day:-18,oi:30823},{day:-17,oi:30159},{day:-16,oi:28964},{day:-15,oi:26580},{day:-14,oi:23479},{day:-13,oi:21850},{day:-12,oi:19888},{day:-11,oi:18701},{day:-10,oi:16260},{day:-9,oi:14876},{day:-8,oi:14017},{day:-7,oi:13082},{day:-6,oi:12275},{day:-5,oi:8958},{day:-4,oi:7181},{day:-3,oi:4412},{day:-2,oi:1778},{day:-1,oi:1157},{day:0,oi:570}] },
    { symbol:"RMK25", label:"K25", fnd:"2025-04-25", data:[{day:-30,oi:32465},{day:-29,oi:32854},{day:-28,oi:32598},{day:-27,oi:32318},{day:-26,oi:32031},{day:-25,oi:31027},{day:-24,oi:30667},{day:-23,oi:30760},{day:-22,oi:31652},{day:-21,oi:29852},{day:-20,oi:28249},{day:-19,oi:26852},{day:-18,oi:24782},{day:-17,oi:23489},{day:-16,oi:21950},{day:-15,oi:20327},{day:-14,oi:19262},{day:-13,oi:17232},{day:-12,oi:15868},{day:-11,oi:14735},{day:-10,oi:14037},{day:-9,oi:12330},{day:-8,oi:11666},{day:-7,oi:10476},{day:-6,oi:8496},{day:-3,oi:5386},{day:-2,oi:4968},{day:-1,oi:4983},{day:0,oi:4547}] },
    { symbol:"RMN25", label:"N25", fnd:"2025-06-25", data:[{day:-30,oi:38518},{day:-29,oi:38810},{day:-28,oi:38397},{day:-27,oi:37915},{day:-26,oi:37152},{day:-24,oi:34361},{day:-23,oi:34580},{day:-21,oi:34082},{day:-20,oi:34461},{day:-19,oi:35015},{day:-18,oi:34077},{day:-17,oi:33905},{day:-16,oi:33232},{day:-15,oi:31244},{day:-14,oi:29396},{day:-13,oi:27887},{day:-12,oi:26537},{day:-11,oi:25440},{day:-10,oi:20535},{day:-9,oi:18974},{day:-8,oi:17942},{day:-7,oi:16768},{day:-6,oi:15747},{day:-5,oi:14912},{day:-4,oi:10460},{day:-3,oi:9110},{day:-2,oi:7500},{day:-1,oi:5389},{day:0,oi:3503}] },
    { symbol:"RMU25", label:"U25", fnd:"2025-08-26", data:[{day:-30,oi:40672},{day:-29,oi:40318},{day:-28,oi:39147},{day:-27,oi:37635},{day:-26,oi:37403},{day:-25,oi:36387},{day:-24,oi:36728},{day:-23,oi:36571},{day:-22,oi:36414},{day:-21,oi:36014},{day:-20,oi:35761},{day:-19,oi:34583},{day:-18,oi:33487},{day:-17,oi:32508},{day:-16,oi:31105},{day:-15,oi:29468},{day:-14,oi:25827},{day:-13,oi:22975},{day:-12,oi:20651},{day:-11,oi:20683},{day:-10,oi:19256},{day:-9,oi:18468},{day:-8,oi:17614},{day:-7,oi:16542},{day:-6,oi:15691},{day:-5,oi:14800},{day:-4,oi:14271},{day:-3,oi:12761},{day:-2,oi:8962},{day:0,oi:6984}] },
    { symbol:"RMX25", label:"X25", fnd:"2025-10-28", data:[{day:-30,oi:34108},{day:-29,oi:34431},{day:-28,oi:34387},{day:-27,oi:34720},{day:-26,oi:34076},{day:-25,oi:32249},{day:-24,oi:32153},{day:-23,oi:32059},{day:-22,oi:31670},{day:-21,oi:31476},{day:-20,oi:31177},{day:-19,oi:31040},{day:-18,oi:30656},{day:-17,oi:30245},{day:-16,oi:29219},{day:-15,oi:27757},{day:-14,oi:26500},{day:-13,oi:24695},{day:-12,oi:23650},{day:-11,oi:19966},{day:-10,oi:19148},{day:-9,oi:18343},{day:-8,oi:11321},{day:-7,oi:10670},{day:-6,oi:10531},{day:-5,oi:10273},{day:-4,oi:9484},{day:-3,oi:8669},{day:-2,oi:7559},{day:-1,oi:6817},{day:0,oi:3893}] },
    { symbol:"RMF26", label:"F26", fnd:"2025-12-26", data:[{day:-30,oi:34893},{day:-29,oi:34607},{day:-28,oi:33040},{day:-27,oi:31861},{day:-26,oi:30748},{day:-25,oi:30859},{day:-24,oi:29413},{day:-23,oi:28704},{day:-22,oi:28719},{day:-21,oi:28111},{day:-20,oi:27786},{day:-19,oi:26994},{day:-18,oi:26026},{day:-17,oi:24272},{day:-16,oi:21692},{day:-15,oi:19871},{day:-14,oi:17585},{day:-13,oi:16162},{day:-12,oi:14984},{day:-11,oi:13519},{day:-10,oi:13105},{day:-9,oi:11575},{day:-8,oi:10706},{day:-7,oi:9571},{day:-6,oi:7275},{day:-5,oi:5127},{day:-4,oi:4802},{day:-3,oi:3843},{day:-2,oi:2900}] },
    { symbol:"RMH26", label:"H26", fnd:"2026-02-24", data:[{day:-30,oi:48087},{day:-29,oi:47929},{day:-28,oi:47572},{day:-27,oi:46633},{day:-26,oi:46026},{day:-25,oi:45543},{day:-24,oi:44495},{day:-23,oi:44770},{day:-22,oi:42559},{day:-21,oi:43110},{day:-20,oi:42392},{day:-19,oi:40911},{day:-18,oi:38535},{day:-17,oi:35695},{day:-16,oi:34003},{day:-15,oi:32559},{day:-14,oi:29935},{day:-13,oi:27957},{day:-12,oi:25901},{day:-11,oi:22387},{day:-10,oi:20714},{day:-9,oi:19516},{day:-8,oi:18617},{day:-7,oi:16577},{day:-6,oi:15622},{day:-5,oi:14974},{day:-4,oi:13367},{day:-3,oi:10476},{day:-2,oi:5423},{day:-1,oi:3077},{day:0,oi:393}] },
    { symbol:"RMK26", label:"K26", fnd:"2026-04-27", data:[{day:-30,oi:47149},{day:-29,oi:46966},{day:-28,oi:47615},{day:-27,oi:48422},{day:-26,oi:47363},{day:-25,oi:44268},{day:-24,oi:41662},{day:-23,oi:39446}] },
  ],
};

// ── Chart helpers ─────────────────────────────────────────────────────────────

// Stable dataKey used by the spread line — kept out of the contract-label
// namespace so it can't collide with a future contract label like "N–U25".
const SPREAD_KEY = "__spread";

function buildChartData(series: Series[], spread: FrontSpread | null) {
  const daySet = new Set<number>();
  series.forEach(s => s.data.forEach(p => daySet.add(p.day)));
  spread?.data.forEach(p => daySet.add(p.day));
  const days = Array.from(daySet).sort((a, b) => a - b);

  // Spread is keyed by day, so a Map is O(1) per lookup instead of the linear
  // scan we'd otherwise do per (day × contract) cell.
  const spreadByDay = new Map<number, number>();
  spread?.data.forEach(p => spreadByDay.set(p.day, p.spread));

  return days.map(day => {
    const row: Record<string, number | null> = { day };
    series.forEach(s => {
      const point = s.data.find(p => p.day === day);
      row[s.label] = point && point.oi != null ? Math.round(point.oi / 1000 * 10) / 10 : null;
    });
    if (spread) {
      const v = spreadByDay.get(day);
      row[SPREAD_KEY] = v != null ? v : null;
    }
    return row;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OIFndChart({ market, height = 320 }: { market: "robusta" | "arabica"; height?: number }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [spread, setSpread] = useState<FrontSpread | null>(null);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    fetch(`/data/oi_fnd_chart.json`)
      .then(r => r.json())
      .then((json: { arabica: Series[]; robusta: Series[]; arabica_front_spread?: FrontSpread | null; robusta_front_spread?: FrontSpread | null }) => {
        const apiSeries: Series[] = json?.[market] ?? [];
        const apiSpread = json?.[`${market}_front_spread`] ?? null;
        if (!apiSeries.length) {
          setSeries(STATIC_SERIES[market]);
          setSpread(null);
          setIsMock(true);
          return;
        }
        // Merge: start from static, overlay JSON data points per symbol.
        // Union by day with JSON taking precedence on collision; preserve
        // both `oi` and `price` so the spread overlay still has the price
        // series available for the front-month pair.
        const apiBySymbol = new Map(apiSeries.map(s => [s.symbol, s]));
        const merged = STATIC_SERIES[market].map(staticS => {
          const apiS = apiBySymbol.get(staticS.symbol);
          if (!apiS) return staticS;
          const byDay = new Map<number, SeriesPoint>();
          staticS.data.forEach(p => byDay.set(p.day, p));
          apiS.data.forEach(p => byDay.set(p.day, p));   // JSON wins on collision
          const data = Array.from(byDay.values()).sort((a, b) => a.day - b.day);
          return { ...staticS, data };
        });
        // Add any new symbols from JSON not in static
        apiSeries.forEach(apiS => {
          if (!merged.find(s => s.symbol === apiS.symbol)) merged.push(apiS);
        });
        setSeries(merged);
        setSpread(apiSpread && apiSpread.data?.length ? apiSpread : null);
        setIsMock(false);
      })
      .catch(() => {
        setSeries(STATIC_SERIES[market]);
        setSpread(null);
        setIsMock(true);
      });
  }, [market]);

  const isRobusta = market === "robusta";
  const title = isRobusta ? "LDN OI Evolution to FND" : "NY OI Evolution to FND";
  const accent = isRobusta ? "bg-emerald-900/60" : "bg-indigo-900/60";

  const [picked] = useContract();
  if (!series.length) return null;

  const today = new Date().toISOString().slice(0, 10);
  // Highlight the contract the reader picked on the chain table if it is one
  // of ours; otherwise the next-FND contract, as before.
  const pickedHere = picked && series.some(s => s.symbol.toUpperCase() === picked) ? picked : null;
  const nextSymbol = pickedHere ?? (series
    .filter(s => s.fnd && s.fnd >= today)
    .sort((a, b) => (a.fnd ?? "").localeCompare(b.fnd ?? ""))[0]?.symbol ?? null);

  const spreadLegend = spread ? `${spread.frontLabel}–${spread.nextLabel} spread` : "";
  const spreadUnit   = isRobusta ? "$/t" : "¢/lb";

  // Collapse the legend to three entries: the highlighted next-FND contract
  // (red), every other contract merged into one grey "Past contracts", and the
  // amber front spread. The per-contract grey lines are otherwise indistinct and
  // their ~10 legend rows crowded the plot (worst in the compact PDF).
  const nextLabel = series.find((s) => s.symbol === nextSymbol)?.label ?? null;
  const legendItems: { id: string; value: string; color: string }[] = [
    ...(nextLabel ? [{ id: "next", value: `${nextLabel} · ${pickedHere ? "selected" : "next FND"}`, color: NEXT_CONTRACT_COLOR }] : []),
    { id: "past", value: "Past contracts", color: "#64748b" },
    ...(spread ? [{ id: "spread", value: spreadLegend, color: SPREAD_COLOR }] : []),
  ];
  const renderLegend = () => (
    <ul style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14,
                 listStyle: "none", margin: 0, padding: "8px 0 0", fontSize: 11 }}>
      {legendItems.map((it) => (
        <li key={it.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 16, borderTop: `2px solid ${it.color}`, display: "inline-block" }} />
          <span className="recharts-legend-item-text" style={{ color: "#cbd5e1" }}>{it.value}</span>
        </li>
      ))}
    </ul>
  );

  const chartData = buildChartData(series, spread);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className={`text-center text-sm font-semibold text-slate-200 mb-1 ${accent} rounded py-1 flex items-center justify-center gap-2`}>
        {title}
        {isMock && (
          <span className="text-[10px] text-slate-400 font-normal">(embedded data)</span>
        )}
      </div>
      <p className="text-center text-[10px] text-slate-500 mb-3">
        Open Interest (K contracts) vs trading days to First Notice Day
        {spread && (
          <> · front spread <span style={{ color: SPREAD_COLOR }}>{spreadLegend}</span> ({spreadUnit})</>
        )}
      </p>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 4, right: 6, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          {/* Axis titles dropped — the caption above already states OI (K) vs
              trading days to FND and the spread unit; tight widths reclaim the
              left/right gutters so the plot fills the card. */}
          <XAxis
            dataKey="day"
            type="number"
            domain={[-45, 0]}
            tickCount={10}
            height={18}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
          />
          <YAxis
            yAxisId="oi"
            width={32}
            tickFormatter={v => `${v}K`}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
          />
          {spread && (
            <YAxis
              yAxisId="spread"
              orientation="right"
              width={34}
              tick={{ fill: SPREAD_COLOR, fontSize: 11 }}
            />
          )}
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            // OI lines display as "{v}K"; the spread line shows the raw value
            // in its native unit ($/t for RC, ¢/lb for KC).
            formatter={((v, name) => {
              if (name === spreadLegend) return [`${v} ${spreadUnit}`, name as NameType];
              return [`${v}K`, name as NameType];
            }) satisfies Formatter<ValueType, NameType>}
            labelFormatter={((l) => `Day ${l} to FND`) satisfies LabelFmt}
          />
          <Legend content={renderLegend} />
          {series.map((s, i) => {
            const isNext = s.symbol === nextSymbol;
            return (
              <Line
                key={s.symbol}
                yAxisId="oi"
                type="monotone"
                dataKey={s.label}
                stroke={isNext ? NEXT_CONTRACT_COLOR : COLORS[i % COLORS.length]}
                strokeWidth={isNext ? 2.5 : 1.5}
                dot={false}
                // Bridge exchange-holiday gaps: trading_days_to counts Mon–Fri
                // but not ICE holidays, so a holiday leaves a 1-day hole at a
                // per-contract index. connectNulls keeps each line continuous.
                connectNulls={true}
              />
            );
          })}
          {spread && (
            <Line
              yAxisId="spread"
              type="monotone"
              dataKey={SPREAD_KEY}
              name={spreadLegend}
              stroke={SPREAD_COLOR}
              strokeWidth={2.5}
              strokeDasharray="4 2"
              dot={false}
              connectNulls={true}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
