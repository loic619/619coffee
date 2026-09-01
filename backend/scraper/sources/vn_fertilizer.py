"""
vn_fertilizer.py — Monthly scraper for Vietnam fertilizer import data.

Source: Vietnam Customs Statistical Publication portal
  https://www.customs.gov.vn/index.jsp?pageId=441&cid=192

Flow:
  1. Playwright navigates to the portal (establishes session cookies).
  2. page.evaluate() calls LayDanhSachMoiCongBoServlet via the bridge proxy
     (direct requests fail — proxy requires browser session).
  3. Filter publications for type "1n" (all-trader imports) and period "k2"
     (second half of month → full-month cumulative column).
  4. Download each PDF via requests (files.customs.gov.vn is open access).
  5. pdfplumber extracts row-25 "Phân bón" sub-items from each report.
  6. Monthly totals = diff between consecutive k2 cumulative columns.
  7. Write scraped data to backend/scraper/cache/vn_fertilizer.json
     (read by vietnam_supply.build_fertilizer_context() at export time).

Column layout in PDFs (0-indexed):
  [0] row index  [1] commodity  [2] unit  [3] period_qty  [4] period_usd
  [5] ytd_cum_qty  [6] ytd_cum_usd
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_PORTAL_URL = "https://www.customs.gov.vn/index.jsp?pageId=441&cid=192"
_BRIDGE_URL = (
    "https://www.customs.gov.vn/bridge"
    "?url=/customs/api/LayDanhSachMoiCongBoServlet"
    "&site=https://tongcuc.customs.gov.vn/"
)
_CACHE_PATH = Path(__file__).resolve().parents[2] / "scraper" / "cache" / "vn_fertilizer.json"

# Vietnamese sub-type name → output field (cumulative tons → kt)
_VN_FERT_MAP: dict[str, str] = {
    "phân ure":   "urea_kt",
    "phân kali":  "kcl_kt",
    "phân dap":   "dap_kt",
    "phân sa":    "as_kt",
    "phân npk":   "npk_kt",
}

# YTD cumulative quantity column index
_CUM_COL = 5


# ── number helpers ──────────────────────────────────────────────────────────────

def _parse_vn_number(s: str | None) -> float:
    """Parse Vietnamese number format (period = thousands separator).

    "1.173.727" → 1173727.0
    "24.302"    → 24302.0
    Also handles plain floats.
    """
    if not s:
        return 0.0
    s = s.strip()
    # If more than one period: all periods are thousands separators
    if s.count(".") > 1:
        s = s.replace(".", "")
    else:
        # Could be a decimal — keep last period as decimal
        parts = s.split(".")
        if len(parts) == 2 and len(parts[1]) == 3:
            # "24.302" → likely 24302 (thousands), not 24.302
            s = s.replace(".", "")
    s = re.sub(r"[^\d.]", "", s)
    try:
        return float(s)
    except ValueError:
        return 0.0


# ── period code helpers ─────────────────────────────────────────────────────────

def _period_to_month(code: str) -> str | None:
    """'2026-t4k2' → '2026-04', '2025-t12k2' → '2025-12'. Returns None if unparseable."""
    m = re.search(r"(\d{4})-t(\d{1,2})k[12]", code, re.IGNORECASE)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    return None


def _is_k2(code: str) -> bool:
    return bool(re.search(r"k2", code, re.IGNORECASE))


def _is_1n(code: str) -> bool:
    """'1n' = all-trader (not FDI-only 3n). Check filename or type field."""
    return bool(re.search(r"[\-_\(]1n(?=[\-_\(\.]|$)", code, re.IGNORECASE) or re.search(r"^1n$", code, re.IGNORECASE))


# ── PDF parsing ─────────────────────────────────────────────────────────────────

def _extract_fert_cumulative(pdf_bytes: bytes) -> dict[str, float]:
    """
    Parse a Vietnam Customs 1n PDF, return {field: cumulative_kt} for fertilizer types.
    Returns empty dict on any error or if data not found.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.error("[vn_fertilizer] pdfplumber not installed")
        return {}

    try:
        results: dict[str, float] = {}
        in_fert = False

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for pg in pdf.pages:
                for table in (pg.extract_tables() or []):
                    for row in table:
                        if not row:
                            continue

                        row_text = " ".join(c or "" for c in row).lower()

                        # Enter fertilizer section at "phân bón" header row
                        if not in_fert and "phân bón" in row_text:
                            in_fert = True
                            continue

                        if not in_fert:
                            continue

                        # Exit at next major section (non-empty numeric index > 25)
                        idx_cell = (row[0] or "").strip()
                        if idx_cell:
                            try:
                                if int(re.sub(r"[^\d]", "", idx_cell)) > 25:
                                    in_fert = False
                                    break
                            except (ValueError, TypeError):
                                pass

                        # Match sub-type rows
                        commodity = (row[1] if len(row) > 1 else None) or ""
                        commodity_lower = commodity.strip().lower()
                        for vn_name, field in _VN_FERT_MAP.items():
                            if vn_name in commodity_lower:
                                cum_raw = row[_CUM_COL] if len(row) > _CUM_COL else None
                                cum_tons = _parse_vn_number(cum_raw)
                                results[field] = round(cum_tons / 1000, 3)  # tons → kt
                                break

        return results

    except Exception as e:
        logger.warning(f"[vn_fertilizer] PDF parse error: {e}")
        return {}


# ── portal helpers ──────────────────────────────────────────────────────────────

async def _fetch_publication_list(page) -> list[dict]:
    """Call LayDanhSachMoiCongBoServlet via page.evaluate() (requires browser session)."""
    try:
        result = await page.evaluate(f"""async () => {{
            const resp = await fetch(
                '{_BRIDGE_URL}',
                {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'x-requested-with': 'XMLHttpRequest'
                    }},
                    body: JSON.stringify({{"pageId": "441", "pageSize": 200, "pageIndex": 1}})
                }}
            );
            if (!resp.ok) return null;
            return resp.json();
        }}""")
        if not result:
            return []
        # Response may be a dict with a list field, or directly a list
        if isinstance(result, list):
            return result
        for key in ("data", "list", "items", "records", "danhSach"):
            if isinstance(result.get(key), list):
                return result[key]
        return []
    except Exception as e:
        logger.warning(f"[vn_fertilizer] publication list fetch failed: {e}")
        return []


def _download_pdf(url: str, session=None, timeout: int = 60) -> bytes | None:
    """Download PDF from files.customs.gov.vn (no auth required)."""
    import requests
    try:
        # files.customs.gov.vn ships a misconfigured TLS chain (intermediate
        # cert is sometimes missing on the edge). verify=False is intentional;
        # the host is non-auth and we validate the response body (PDF magic)
        # before trusting it.
        getter = session or requests
        resp = getter.get(url, timeout=timeout, verify=False)
        if resp.status_code != 200 or b"%PDF" not in resp.content[:10]:
            return None
        return resp.content
    except Exception as e:
        logger.warning(f"[vn_fertilizer] PDF download failed {url}: {e}")
        return None


# ── path A: URL prediction (primary — no browser, no bridge) ────────────────────
#
# The portal bridge (path B below) has never returned publications in CI, but
# the k2/1n bulletins are URL-predictable on files.customs.gov.vn (verified:
# /CustomsCMS/TONG_CUC/2026/7/6/2026-t6k2-1n(vn-sb).pdf). Publication lands in
# data-month+1 (occasionally +2), day clusters near the 6th-10th. Same
# discovery machinery as vn_coffee_export / the 5X harvester.

_FILES_HOST = "https://files.customs.gov.vn"
# Plausibility-ordered days; 6 first — the verified Jul-2026 publication day.
_DAY_ORDER = [6, 7, 8, 9, 10, 11, 5, 12, 13, 14, 15, 4, 16, 17, 3, 18, 19, 2,
              20, 21, 1, 22, 23, 24, 25, 26, 27, 28]


def _shift_month(year: int, month: int, by: int) -> tuple[int, int]:
    m = month + by
    y = year
    while m > 12:
        m -= 12
        y += 1
    return y, m


def _candidate_1n_urls(data_y: int, data_m: int) -> list[str]:
    """Predicted URLs for one data month's k2 (full-month cumulative) 1n
    bulletin, most plausible first. Stem-major order so a present month
    resolves in a handful of requests; the Vietnamese edition only — the
    parser matches Vietnamese commodity names."""
    urls: list[str] = []
    for off in (1, 2):
        pub_y, pub_m = _shift_month(data_y, data_m, off)
        for tprefix in ("t", "T"):
            for mfmt in (str(data_m), f"{data_m:02d}"):
                for suffix in ("(vn-sb)", "(VN-SB)"):
                    stem = f"{data_y}-{tprefix}{mfmt}k2-1n{suffix}.pdf"
                    for d in _DAY_ORDER:
                        urls.append(
                            f"{_FILES_HOST}/CustomsCMS/TONG_CUC/{pub_y}/{pub_m}/{d}/{stem}")
    seen: set[str] = set()
    return [u for u in urls if not (u in seen or seen.add(u))]


def _harvest_pdfs_via_urls(months_back: int = 18) -> dict[str, bytes]:
    """Path A: fetch the last `months_back` k2/1n bulletins by URL prediction.
    Returns {YYYY-MM: pdf_bytes}. Keep-alive session (a fresh TLS handshake
    per candidate is what makes miss-sweeps expensive); stops after three
    consecutive missing months going backward (archive end)."""
    from datetime import date

    import requests
    session = requests.Session()

    y, m = date.today().year, date.today().month - 1
    if m == 0:
        y, m = y - 1, 12
    out: dict[str, bytes] = {}
    misses = 0
    for _ in range(months_back):
        key = f"{y}-{m:02d}"
        body = None
        for url in _candidate_1n_urls(y, m):
            body = _download_pdf(url, session=session, timeout=12)
            if body:
                print(f"[vn_fertilizer] [pathA] {key}: {url.rsplit('/', 1)[-1]}")
                break
        if body:
            out[key] = body
            misses = 0
        else:
            misses += 1
            print(f"[vn_fertilizer] [pathA] {key}: not found "
                  f"({misses} consecutive miss(es))")
            if misses >= 3:
                print("[vn_fertilizer] [pathA] archive appears to end here — stopping.")
                break
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


# ── monthly derivation ──────────────────────────────────────────────────────────

def _derive_monthly(cumulative: dict[str, dict[str, float]]) -> list[dict]:
    """
    cumulative: {month_key: {field: kt, ...}}
    Returns list of monthly dicts sorted by month, with monthly = diff from prior k2.
    """
    fields = list(_VN_FERT_MAP.values())
    months = sorted(cumulative.keys())

    rows = []
    for i, month in enumerate(months):
        cum = cumulative[month]
        if i == 0:
            # First available month: monthly = cumulative (Jan = YTD Jan)
            monthly = {f: cum.get(f, 0.0) for f in fields}
        else:
            prev = cumulative[months[i - 1]]
            prev_yr  = int(months[i - 1][:4])
            this_yr  = int(month[:4])
            if prev_yr != this_yr:
                # Year boundary: cumulative resets at January
                monthly = {f: cum.get(f, 0.0) for f in fields}
            else:
                monthly = {f: max(0.0, round(cum.get(f, 0.0) - prev.get(f, 0.0), 3)) for f in fields}

        total = round(sum(monthly.values()), 1)
        rows.append({
            "month":   month,
            "urea_kt": monthly.get("urea_kt", 0),
            "kcl_kt":  monthly.get("kcl_kt",  0),
            "dap_kt":  monthly.get("dap_kt",  0),
            "as_kt":   monthly.get("as_kt",   0),
            "npk_kt":  monthly.get("npk_kt",  0),
            "total_kt": total,
        })

    return rows


# ── main runner ─────────────────────────────────────────────────────────────────

async def run(page, db) -> None:  # noqa: ARG001
    """
    Scrape Vietnam Customs fertilizer import data, write to cache.
    On any failure: logs and retains existing cache (does NOT raise).
    """
    import warnings
    warnings.filterwarnings("ignore", message="Unverified HTTPS request")

    try:
        # Path A first: URL prediction against files.customs.gov.vn — no
        # browser session needed, and unlike the bridge it actually delivers.
        pdf_by_month = _harvest_pdfs_via_urls()
        if pdf_by_month:
            print(f"[vn_fertilizer] [pathA] {len(pdf_by_month)} k2/1n bulletins "
                  f"via URL prediction")
        else:
            # Path B fallback: the portal bridge (requires the browser session).
            print("[vn_fertilizer] [pathA] nothing found — falling back to the "
                  "portal bridge")
            print("[vn_fertilizer] Navigating to Vietnam Customs portal...")
            await page.goto(_PORTAL_URL, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2_000)

            publications = await _fetch_publication_list(page)
            print(f"[vn_fertilizer] Got {len(publications)} publications")

            if not publications:
                print("[vn_fertilizer] No publications returned — retaining cache")
                return

            # Filter: 1n (all-trader) + k2 (second-half = full-month cumulative)
            k2_pubs: list[dict] = []
            for pub in publications:
                # Candidates: check fileSoBo URL or any text/type field
                file_url  = pub.get("fileSoBo") or pub.get("filePath") or pub.get("url") or ""
                type_code = pub.get("loaiBaoCao") or pub.get("type") or pub.get("reportType") or ""
                name      = pub.get("tenBaoCao") or pub.get("name") or pub.get("title") or ""
                combined  = f"{file_url} {type_code} {name}"

                if not _is_k2(combined):
                    continue
                if not _is_1n(combined):
                    continue

                month = _period_to_month(combined)
                if month:
                    k2_pubs.append({"month": month, "url": file_url, "raw": combined})

            print(f"[vn_fertilizer] {len(k2_pubs)} k2/1n reports identified")

            if not k2_pubs:
                print("[vn_fertilizer] No k2/1n publications found — retaining cache")
                return

            # Deduplicate by month (keep latest URL per month), then download.
            by_month: dict[str, str] = {}
            for pub in k2_pubs:
                by_month[pub["month"]] = pub["url"]
            for month, url in sorted(by_month.items()):
                body = _download_pdf(url)
                if body:
                    pdf_by_month[month] = body
                else:
                    print(f"[vn_fertilizer] {month}: PDF download failed — skipping")

        # Parse each PDF for the fertilizer sub-types.
        cumulative: dict[str, dict[str, float]] = {}
        for month, pdf_bytes in sorted(pdf_by_month.items()):
            fert = _extract_fert_cumulative(pdf_bytes)
            if not fert:
                print(f"[vn_fertilizer] {month}: no fertilizer data extracted")
            else:
                cumulative[month] = fert
                print(f"[vn_fertilizer] {month}: {fert}")

        if not cumulative:
            print("[vn_fertilizer] No data extracted — retaining cache")
            return

        if cumulative:
            monthly = _derive_monthly(cumulative)
            _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            cache = {
                "scraped_at": datetime.utcnow().isoformat() + "Z",
                "monthly":    monthly,
            }
            _CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"[vn_fertilizer] Done. {len(monthly)} months written to cache.")

    except Exception as e:
        print(f"[vn_fertilizer] FAILED: {e} — retaining cache")


# ── standalone ──────────────────────────────────────────────────────────────────

async def _standalone():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page    = await browser.new_page()
        await run(page, None)
        await browser.close()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    asyncio.run(_standalone())
