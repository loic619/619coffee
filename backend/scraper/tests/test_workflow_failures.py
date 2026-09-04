"""The failure taxonomy's arithmetic, and the honesty rules inside it."""
import json
from pathlib import Path

from backend.scraper import research_workflow_failures as W


def run(name, event="schedule", dur=10):
    return {"id": 1, "name": name, "event": event, "duration_s": dur,
            "created_at": "2026-08-01T00:00:00Z"}


class TestClassify:
    def test_reads_the_known_workflows_off_their_own_semantics(self):
        cat, lane, conf, _ = W.classify("1.8 – Check Live Quotes Freshness")
        assert (cat, lane, conf) == ("D", "operational", True)

    def test_a_retired_workflow_gets_its_own_lane(self):
        # 1.6 was deleted 2026-08-14. Its 29 failures are frozen history and
        # must not sit in the same bucket as something still running.
        assert W.classify("1.6 – Morning Brief")[1] == "retired"

    def test_ci_is_pre_merge_even_when_unlisted(self):
        assert W.classify("9.9 – Some New Gate")[1] == "pre-merge"

    def test_an_unknown_operational_workflow_stays_ACTIONABLE(self):
        # The fallback must not flatter the metric. An unclassified operational
        # failure counts against us rather than being explained away.
        cat, lane, conf, _ = W.classify("7.7 – Something Nobody Documented")
        assert lane == "operational" and cat == "C" and conf is False


class TestActionableRate:
    def test_subtracts_pre_merge_retired_and_intentional_only(self):
        runs = ([run("9.2 – Backend Lint", "push")] * 10
                + [run("1.6 – Morning Brief", "workflow_run")] * 5
                + [run("1.5 – Check Data Pipeline Freshness")] * 4
                + [run("1.11 – Port Activity Scraper (PortWatch)")] * 3)
        s = W.summarise(runs)
        assert s["n"] == 22
        assert s["lane_counts"]["pre-merge"] == 10
        assert s["lane_counts"]["retired"] == 5
        assert s["category_counts"]["D"] == 4
        assert s["actionable"] == 3               # only the PortWatch ones
        assert s["actionable_pct"] == round(100 * 3 / 22, 1)

    def test_does_NOT_subtract_external_failures(self):
        # A transient that keeps recurring is still a real source problem.
        # Excusing B and C is how the metric would stop meaning anything.
        runs = [run("1.7 – Cecafe Daily Registration")] * 6
        s = W.summarise(runs)
        assert s["category_counts"]["B"] == 6
        assert s["actionable"] == 6

    def test_a_pure_watchdog_sample_is_entirely_unactionable(self):
        # The whole point: a day where the only failures are freshness checks
        # firing on stale data is a day the system behaved as designed.
        runs = [run("1.5 – Check Data Pipeline Freshness")] * 8
        s = W.summarise(runs)
        assert s["actionable"] == 0 and s["actionable_pct"] == 0.0

    def test_tags_every_run_in_place_so_the_page_can_show_the_reasoning(self):
        runs = [run("1.11 – Port Activity Scraper (PortWatch)")]
        W.summarise(runs)
        assert runs[0]["category"] == "C"
        assert "no data" in runs[0]["evidence"]
        assert runs[0]["confident"] is True

    def test_empty_sample_does_not_divide_by_zero(self):
        s = W.summarise([])
        assert s["n"] == 0 and s["actionable_pct"] == 0.0


class TestAgainstTheRealSample:
    RAW = Path(__file__).resolve().parents[3] / "data" / "workflow_failures_raw.json"

    def test_the_committed_sample_reproduces_the_published_numbers(self):
        raw = json.loads(self.RAW.read_text(encoding="utf-8"))
        s = W.summarise(raw["runs"])
        assert s["n"] == 240
        assert s["lane_counts"]["pre-merge"] == 168
        assert s["lane_counts"]["retired"] == 29
        assert s["category_counts"]["D"] == 16
        assert s["actionable"] == 27

    def test_the_headline_holds_the_vast_majority_are_not_application_failures(self):
        raw = json.loads(self.RAW.read_text(encoding="utf-8"))
        s = W.summarise(raw["runs"])
        assert s["actionable_pct"] < 15
