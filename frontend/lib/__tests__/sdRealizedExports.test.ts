import { describe, expect, it } from "vitest";
import { buildRealizedExportsOverlay } from "../sdRealizedExports";

// Oct-Sep crop years (Vietnam-style). Builds `count` months starting at
// {y, m} with a fixed kbags value unless overridden per "YYYY-MM".
function months(
  startY: number, startM: number, count: number,
  base: number, overrides: Record<string, number> = {},
) {
  const out = [];
  let y = startY, m = startM;
  for (let i = 0; i < count; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: ym, kbags: overrides[ym] ?? base });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

describe("buildRealizedExportsOverlay seasonal remaining", () => {
  it("estimates missing months from prior-year seasonality on the current partial crop", () => {
    // Crops 2022/23, 2023/24, 2024/25 complete at 1000 kbags/month, with
    // distinct Aug + Sep values; 2025/26 realised Oct→Jul only.
    const feed = [
      ...months(2022, 10, 36, 1000, {
        "2023-08": 1100, "2023-09": 600,
        "2024-08": 1300, "2024-09": 900,
        "2025-08": 1400, "2025-09": 1350,
      }),
      ...months(2025, 10, 10, 2000), // current crop, 10 of 12 months
    ];
    const overlay = buildRealizedExportsOverlay({
      monthly: feed, cropYearStartMonth: 10, sourceLabel: "Test Customs",
    });
    const cur = overlay?.byCropYear["2025/26"];
    expect(cur?.isPartial).toBe(true);
    expect(cur?.kbags).toBe(20000);
    // Aug avg = (1100+1300+1400)/3 = 1266.67; Sep avg = (600+900+1350)/3 = 950.
    expect(cur?.seasonalRemainingKbags).toBe(Math.round(1266.6666 + 950));
    // Complete crops never carry the field.
    expect(overlay?.byCropYear["2024/25"]?.seasonalRemainingKbags).toBeUndefined();
  });

  it("omits the estimate when the feed has no prior-year history for the missing months", () => {
    const feed = months(2025, 10, 10, 2000); // only the current partial crop
    const overlay = buildRealizedExportsOverlay({
      monthly: feed, cropYearStartMonth: 10, sourceLabel: "Test Customs",
    });
    const cur = overlay?.byCropYear["2025/26"];
    expect(cur?.isPartial).toBe(true);
    expect(cur?.seasonalRemainingKbags).toBeUndefined();
  });

  it("uses only the last three observations per missing calendar month", () => {
    // Five prior Augs: 100, 200, 3000, 3000, 3000 — only the newest three count.
    const feed = [
      ...months(2020, 10, 60, 1000, {
        "2021-08": 100, "2022-08": 200,
        "2023-08": 3000, "2024-08": 3000, "2025-08": 3000,
      }),
      ...months(2025, 10, 11, 1000), // current crop missing only Sep? no — Oct→Aug = 11 months, missing Sep
    ];
    const overlay = buildRealizedExportsOverlay({
      monthly: feed, cropYearStartMonth: 10, sourceLabel: "Test Customs",
    });
    // Missing month is Sep 2026; prior Seps are all 1000 → estimate 1000.
    expect(overlay?.byCropYear["2025/26"]?.seasonalRemainingKbags).toBe(1000);
  });
});
