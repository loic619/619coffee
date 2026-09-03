"use client";
import { H, P, RefTable, DataFiles, Code } from "../methodology/prose";
import { useFetchJson } from "@/lib/useFetchJson";
import { fmtNum } from "@/lib/formatters";

interface Row {
  id: string; metric: string; op: string; threshold: number; label: string;
  current: number | null; as_of: string | null; condition: boolean | null;
  armed: boolean; last_fired: string | null;
}
interface Payload { checked_at: string; delivery: string; rules: Row[]; }

/**
 * Read-only view of the admin threshold alerts. Rules are edited in the repo
 * (data/alert_thresholds.json); this page shows what each one is watching,
 * where the number stands, and whether it is armed. It deliberately carries
 * no link to the delivery channel.
 */
export default function ThresholdAlerts() {
  const { data, error } = useFetchJson<Payload>("/data/alert_thresholds.json");

  return (
    <>
      <P>
        The app is a set of reference surfaces; nothing on it reaches a reader who is not
        looking at the screen. This is the smallest thing that changes that: a short list of
        rules over published numbers, checked after every export, delivered as a message the
        moment a condition <em>becomes</em> true.
      </P>
      <H>How a rule behaves</H>
      <P>
        Edge-triggered, not level-triggered. A rule fires once when its condition turns true,
        then disarms; it re-arms only after the condition has been observed false again. A market
        that sits above a line for a fortnight produces one message, not fourteen. Rules live in{" "}
        <Code>data/alert_thresholds.json</Code> — edit, push, and the next export run applies them.
        Workflow 1.26 runs the check; state is committed alongside so a re-run never re-sends.
      </P>
      <H>Current rules</H>
      {error ? (
        <P className="text-slate-500">alert_thresholds.json has not been published yet — the first run of workflow 1.26 writes it.</P>
      ) : !data ? (
        <P>Loading…</P>
      ) : (
        <>
          <RefTable
            head={["rule", "watching", "threshold", "current", "as of", "state", "last fired"]}
            rows={data.rules.map((r) => [
              r.label,
              r.metric,
              `${r.op} ${fmtNum(r.threshold)}`,
              r.current == null ? "—" : fmtNum(Math.round(r.current * 100) / 100),
              r.as_of ?? "—",
              r.condition == null ? "no data" : r.condition ? (r.armed ? "true · will fire" : "true · fired, waiting to clear") : (r.armed ? "armed" : "re-arming"),
              r.last_fired ? r.last_fired.slice(0, 16).replace("T", " ") + " UTC" : "never",
            ])}
          />
          <P className="text-slate-500">
            Checked {data.checked_at.slice(0, 16).replace("T", " ")} UTC · delivery: {data.delivery}.
          </P>
        </>
      )}
      <DataFiles files={["alert_thresholds.json"]} note="Published by workflow 1.26 after each export; rules come from data/alert_thresholds.json in the repo." />
    </>
  );
}
