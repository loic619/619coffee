import { fetchFreight } from "@/lib/api";
import FreightClient, { type FreightData } from "./FreightClient";
// Committed static file is the source of truth for this static-deployed site.
// Imported at build time so the page renders without a live backend; the daily
// data commit triggers a redeploy that picks up the latest file.
import freightStatic from "@/public/data/freight.json";

export default async function FreightPage() {
  // Prefer the live backend if one is configured; otherwise use the static
  // file — and SAY SO. The fallback used to be silent, so a stale number
  // rendered with exactly the chrome of a live one. Which source served the
  // page is the one thing a reader of a freight rate needs to know first.
  let data: FreightData;
  let source: "live" | "static";
  try {
    data = (await fetchFreight()) as FreightData;
    source = "live";
  } catch {
    data = freightStatic as FreightData;
    source = "static";
  }
  return <FreightClient data={data} source={source} />;
}
