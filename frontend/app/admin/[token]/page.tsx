// /admin/<SECRET_TOKEN> — access-log dashboard.
//
// Security model: secret URL. The `[token]` path segment must
// constant-time-match `process.env.ADMIN_ACCESS_TOKEN`. Any mismatch
// returns a real Next.js 404 — same response shape as a non-existent
// page, so the URL is undiscoverable without already knowing it.
//
// Trade-offs vs the previous password-form model:
//   + No cookies, no session store, no login round-trip.
//   - The secret is in the URL. Anywhere the URL goes (bookmarks,
//     browser history, screen shares, chat), the secret goes too.
//     If it leaks, rotate ADMIN_ACCESS_TOKEN in Vercel.
//
// The middleware already excludes /admin/* from the access log, so the
// owner's own visits to this page do not appear in the dashboard's
// recent-activity table — and the token itself never lands in
// access:log.

import { notFound } from "next/navigation";
import { upstashConfigured, upstashPipeline } from "@/lib/upstashRest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LogEntry {
  ts: string;
  ip: string;
  name?: string;
  tier?: string;
  country: string | null;
  region: string | null;
  city: string | null;
  path: string;
  ua: string;
  ref: string;
}

interface VisitorRollup {
  ip: string;
  name: string;
  tier: string;
  hits: number;
  firstSeen: string;
  lastSeen: string;
  country: string;
  region: string;
  city: string;
  lastPath: string;
  lastUa: string;
}

interface DashboardData {
  visitors: VisitorRollup[];
  recent: LogEntry[];
  totalUniqueIps: number;
  truncated: boolean;
}

const RECENT_LIMIT = 100;
const VISITORS_LIMIT = 200;

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function hashToRollup(ip: string, fields: string[]): VisitorRollup {
  // Upstash HGETALL returns flat ["k1","v1","k2","v2",...]
  const h: Record<string, string> = {};
  for (let i = 0; i < fields.length - 1; i += 2) h[fields[i]] = fields[i + 1] ?? "";
  return {
    ip,
    name: h.name ?? "",
    tier: h.tier ?? "",
    hits: Number(h.hits ?? 0),
    firstSeen: h.first_seen ?? "",
    lastSeen: h.last_seen ?? "",
    country: h.last_country ?? "",
    region: h.last_region ?? "",
    city: h.last_city ?? "",
    lastPath: h.last_path ?? "",
    lastUa: h.last_ua ?? "",
  };
}

function shortUa(ua: string): string {
  if (!ua) return "—";
  // Trim down the Mozilla soup to the readable token (Chrome/X, Safari, …).
  const m = ua.match(/(Edg|Chrome|Firefox|Safari|Mobile|Android|iPhone|iPad)\/[\d.]+/i);
  return m ? m[0] : ua.slice(0, 40) + (ua.length > 40 ? "…" : "");
}

function fmtAge(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const h = (Date.now() - t) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d ago`;
  return iso.slice(0, 10);
}

async function loadDashboard(): Promise<DashboardData | null> {
  if (!upstashConfigured()) return null;

  const head = await upstashPipeline<[string[] | null, string[] | null]>([
    ["SMEMBERS", "access:ips"],
    ["LRANGE", "access:log", "0", String(RECENT_LIMIT - 1)],
  ]);
  if (!head) return null;
  const [ipsRaw, recentRaw] = head;
  const ips = Array.isArray(ipsRaw) ? ipsRaw : [];
  const recent: LogEntry[] = (Array.isArray(recentRaw) ? recentRaw : [])
    .map((s) => {
      try { return JSON.parse(s) as LogEntry; } catch { return null; }
    })
    .filter((x): x is LogEntry => x !== null);

  const capped = ips.slice(0, VISITORS_LIMIT);
  if (capped.length === 0) {
    return { visitors: [], recent, totalUniqueIps: ips.length, truncated: false };
  }

  const hashResults = await upstashPipeline<(string[] | null)[]>(
    capped.map((ip) => ["HGETALL", `access:ips:${ip}`]),
  );
  if (!hashResults) return null;

  const visitors: VisitorRollup[] = capped
    .map((ip, i) => hashToRollup(ip, hashResults[i] ?? []))
    .filter((v) => v.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  return {
    visitors,
    recent,
    totalUniqueIps: ips.length,
    truncated: ips.length > VISITORS_LIMIT,
  };
}

export default async function AdminAccessPage({
  params,
}: {
  params: { token: string };
}) {
  const expected = process.env.ADMIN_ACCESS_TOKEN;
  if (!expected || !constantTimeEquals(params.token, expected)) {
    // Match exactly the shape of any other non-existent page — undiscoverable.
    notFound();
  }

  const data = await loadDashboard();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-xl font-bold text-white">Access log</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real page loads (bots & sub-resource fetches filtered). Refresh the page to refresh the data.
          </p>
        </header>

        {!data && (
          <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-4 text-sm text-rose-300">
            Couldn&apos;t reach the log store. Check that <code>UPSTASH_REDIS_REST_URL</code> /{" "}
            <code>UPSTASH_REDIS_REST_TOKEN</code> are set in the Vercel env.
          </div>
        )}

        {data && (
          <>
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-200">
                  Unique visitors ({data.visitors.length}
                  {data.truncated && (
                    <span className="text-slate-500 font-normal">
                      {" "}/ {data.totalUniqueIps} (showing top {VISITORS_LIMIT})
                    </span>
                  )}
                  )
                </h2>
                <span className="text-[10px] text-slate-500">sorted by hits</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-slate-500 bg-slate-800/40">
                      <th className="text-right px-2 py-1.5 w-12">Hits</th>
                      <th className="text-left  px-2 py-1.5">Name</th>
                      <th className="text-left  px-2 py-1.5">IP</th>
                      <th className="text-left  px-2 py-1.5">Location</th>
                      <th className="text-left  px-2 py-1.5">Last path</th>
                      <th className="text-left  px-2 py-1.5">UA</th>
                      <th className="text-right px-2 py-1.5">First seen</th>
                      <th className="text-right px-2 py-1.5">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.visitors.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-2 py-3 text-center text-slate-600">
                          No visitors logged yet.
                        </td>
                      </tr>
                    ) : (
                      data.visitors.map((v) => {
                        const loc = [v.city, v.region, v.country].filter(Boolean).join(", ") || "—";
                        return (
                          <tr key={v.ip} className="border-t border-slate-800/60 align-top">
                            <td className="px-2 py-1.5 text-right text-amber-300 font-bold">{v.hits}</td>
                            <td className="px-2 py-1.5 text-slate-100 font-semibold whitespace-nowrap">
                              {v.name || "—"}
                              {v.tier && <span className="ml-1.5 text-[9px] font-normal text-slate-500 uppercase">{v.tier}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-slate-200">{v.ip}</td>
                            <td className="px-2 py-1.5 text-slate-300">{loc}</td>
                            <td className="px-2 py-1.5 text-slate-400">{v.lastPath || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-400">{shortUa(v.lastUa)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtAge(v.firstSeen)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtAge(v.lastSeen)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-200">
                  Recent activity ({data.recent.length})
                </h2>
                <span className="text-[10px] text-slate-500">newest first · last {RECENT_LIMIT}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-slate-500 bg-slate-800/40">
                      <th className="text-left  px-2 py-1.5 w-44">When</th>
                      <th className="text-left  px-2 py-1.5">Name</th>
                      <th className="text-left  px-2 py-1.5">IP</th>
                      <th className="text-left  px-2 py-1.5">Location</th>
                      <th className="text-left  px-2 py-1.5">Path</th>
                      <th className="text-left  px-2 py-1.5">Referrer</th>
                      <th className="text-left  px-2 py-1.5">UA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-2 py-3 text-center text-slate-600">
                          No hits logged yet — first page load after deploy will populate this.
                        </td>
                      </tr>
                    ) : (
                      data.recent.map((e, i) => {
                        const loc = [e.city, e.region, e.country].filter(Boolean).join(", ") || "—";
                        return (
                          <tr key={`${e.ts}-${i}`} className="border-t border-slate-800/60 align-top">
                            <td className="px-2 py-1.5 text-slate-500">{e.ts.replace("T", " ").slice(0, 19)}Z</td>
                            <td className="px-2 py-1.5 text-slate-100">
                              {e.name || "—"}
                              {e.tier && <span className="ml-1.5 text-[9px] text-slate-500 uppercase">{e.tier}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-slate-200">{e.ip}</td>
                            <td className="px-2 py-1.5 text-slate-300">{loc}</td>
                            <td className="px-2 py-1.5 text-slate-300">{e.path}</td>
                            <td className="px-2 py-1.5 text-slate-500">{e.ref || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-400">{shortUa(e.ua)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="text-[10px] text-slate-600">
              Storage: Upstash Redis · log capped at 5000 hits · per-IP rollups expire after 60 days.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
