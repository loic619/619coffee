// /welcome — the name gate. No password: a visitor enters their first name and
// surname once; POST /api/identify sets a 1-year cookie so they're never asked
// again and records the name against their IP for the /admin access log. The
// middleware redirects any un-identified page load here (with ?next=).
export const dynamic = "force-dynamic";

export default function WelcomePage({
  searchParams,
}: {
  searchParams: { next?: string | string[]; err?: string | string[] };
}) {
  const rawNext = Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next;
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const err = Array.isArray(searchParams.err) ? searchParams.err[0] : searchParams.err;
  const errMsg =
    err === "2" ? "That access code isn't right — check it and try again."
    : err === "3" ? "Sign-in is temporarily unavailable — please try again shortly."
    : err ? "Please enter your first name and surname."
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl">☕</div>
          <h1 className="mt-2 text-xl font-bold text-white">Coffee Intel Map</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter your name and your access code to continue.
          </p>
        </div>

        <form
          action="/api/identify"
          method="POST"
          className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3"
        >
          {errMsg && (
            <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-md px-3 py-2">
              {errMsg}
            </p>
          )}

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">First name</span>
            <input
              name="first"
              type="text"
              required
              autoFocus
              autoComplete="given-name"
              maxLength={40}
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100
                         placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
              placeholder="Jane"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Surname</span>
            <input
              name="last"
              type="text"
              required
              autoComplete="family-name"
              maxLength={40}
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100
                         placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
              placeholder="Doe"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Access code</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={60}
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100
                         placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
              placeholder="••••••••"
            />
          </label>

          <input type="hidden" name="next" value={next} />

          <button
            type="submit"
            className="w-full rounded-md bg-amber-500/90 hover:bg-amber-400 text-slate-950 font-semibold text-sm py-2 transition-colors"
          >
            Continue
          </button>
        </form>

        <p className="mt-3 text-center text-[10px] text-slate-600">
          We remember you on this device so you only do this once.
        </p>
      </div>
    </div>
  );
}
