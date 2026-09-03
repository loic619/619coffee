// /welcome — the access gate. A visitor enters their name and the access code
// for their tier once; POST /api/identify verifies the code, sets the signed
// tier cookie the middleware enforces on every page load, and records the name
// against their IP for the /admin access log. Un-identified page loads are
// redirected here by the middleware (with ?next=).
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

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
    : err ? "Please enter your name."
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl">☕</div>
          <h1 className="mt-2 text-xl font-bold text-white">{PRODUCT_NAME}</h1>
          {/* A forwarded link lands a stranger on a coffee cup and a password
              box. Two sentences say what this is before asking for anything. */}
          <p className="mt-1 text-sm text-slate-300">{PRODUCT_TAGLINE}</p>
          <p className="mt-2 text-xs text-slate-500">
            Futures, positioning, freight, supply and demand for the coffee complex,
            updated daily. Access is by invitation — enter the code you were given.
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

          {/* One field. First name / surname assumed a shape many of this
              audience's names do not have. */}
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Your name</span>
            <input
              name="name"
              type="text"
              required
              autoFocus
              autoComplete="name"
              maxLength={80}
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100
                         placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
              placeholder="As you'd like to be known here"
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
              placeholder="Paste the code exactly as it was sent"
            />
            <span className="block mt-1 text-[10px] text-slate-600">
              Case-sensitive. Your code decides what you can see — see below.
            </span>
          </label>

          <input type="hidden" name="next" value={next} />

          {/* The reassurance sits with the action it reassures about, not
              three lines below the button where it did the least work. */}
          <button
            type="submit"
            className="w-full rounded-md bg-amber-500/90 hover:bg-amber-400 text-slate-950 font-semibold text-sm py-2 transition-colors"
          >
            Continue
          </button>
          <p className="text-center text-[10px] text-slate-600">
            Remembered on this device — you only do this once.
          </p>
        </form>

        {/* What each code unlocks. The tiers were a config value with no
            product story; a visitor holding a code had no way to know what it
            was for. */}
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <dt className="text-slate-400 font-medium">Guest</dt>
          <dd>Every market tab — Daily Brief, Futures, COT, Freight, Supply, Demand, Macro, Map.</dd>
          <dt className="text-slate-400 font-medium">Member</dt>
          <dd>
            Everything a guest sees, plus the Research library — the positioning
            studies, the model methodology and track records, and the origin deep-dives
            behind the market view.
          </dd>
          <dt className="text-slate-400 font-medium">Admin</dt>
          <dd>Everything, including the data map and platform controls.</dd>
        </dl>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Holding a guest code and want Research? Ask whoever sent you the code — access is
          granted by invitation, not by form.
        </p>
      </div>
    </div>
  );
}
