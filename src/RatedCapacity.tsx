import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Rated Capacity Tab
 * - Top card: "Rated Capacity" (editable Installed Capacity + PLF, computed Rated Capacity)
 * - Historical Capacity card below
 *
 * IMPORTANT:
 * - Uses ONLY /data/capacity.csv (no separate Capacity.csv).
 * - Installed Capacity (top row) auto-initializes from the LATEST month row in capacity.csv
 *   ONLY if there is no non-zero localStorage installed data.
 * - Uses localStorage keys:
 *    - ratedCapacity_installed
 *    - ratedCapacity_plf
 */

type SourceKey =
  | "Coal"
  | "Oil & Gas"
  | "Nuclear"
  | "Hydro"
  | "Solar"
  | "Wind"
  | "Small-Hydro"
  | "Bio Power";

const SOURCES: SourceKey[] = [
  "Coal",
  "Oil & Gas",
  "Nuclear",
  "Hydro",
  "Solar",
  "Wind",
  "Small-Hydro",
  "Bio Power",
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function fmt2(n: number) {
  const v = round2(n);
  return v.toFixed(2);
}

function safeNum(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function sumSources(obj: Record<string, number>, keys: string[]) {
  return keys.reduce((acc, k) => acc + safeNum(obj[k]), 0);
}

function parseCSVSimple(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return { header: [], rows: [] as string[][] };

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const header = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { header, rows };
}

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        {right ? <div className="text-sm text-slate-600">{right}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function numberInputClass() {
  return "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 tabular-nums";
}

function compareMonthKey(a: string, b: string) {
  // MM/YYYY
  const [am, ay] = a.split("/").map((x) => Number(x));
  const [bm, by] = b.split("/").map((x) => Number(x));
  if (ay !== by) return ay - by;
  return am - bm;
}

function minusMonths(monthKey: string, monthsBack: number) {
  const [mm, yyyy] = monthKey.split("/").map((x) => Number(x));
  let m = mm;
  let y = yyyy;
  let left = monthsBack;

  while (left > 0) {
    m -= 1;
    if (m <= 0) {
      m = 12;
      y -= 1;
    }
    left -= 1;
  }
  return `${String(m).padStart(2, "0")}/${String(y)}`;
}

function clampMonthKeyToOptions(target: string, options: string[]) {
  if (!options.length) return target;
  if (options.includes(target)) return target;

  const sorted = options.slice().sort(compareMonthKey);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (compareMonthKey(sorted[i], target) <= 0) return sorted[i];
  }
  return sorted[0];
}

function netColorClass(v: number) {
  if (v > 0) return "text-emerald-600";
  if (v < 0) return "text-rose-600";
  return "text-slate-700";
}

function normalizeHeader(h: string) {
  return (h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/–/g, "-")
    .replace(/—/g, "-");
}

/**
 * Accepts:
 *  - MM/YYYY or M/YYYY
 *  - MM/YY or M/YY        (interpreted as 20YY)
 *  - DD/MM/YYYY or D/M/YYYY (treated as monthly -> MM/YYYY)
 *  - DD/MM/YY or D/M/YY     (treated as monthly; YY -> 20YY)
 *  - DD-MM-YYYY or DD-MM-YY (treated as monthly)
 */
function normalizeMonth(m: string) {
  const t = (m || "").trim();

  // MM/YYYY
  let r = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (r) {
    const mm = String(Number(r[1])).padStart(2, "0");
    const yyyy = r[2];
    return `${mm}/${yyyy}`;
  }

  // MM/YY -> 20YY
  r = t.match(/^(\d{1,2})\/(\d{2})$/);
  if (r) {
    const mm = String(Number(r[1])).padStart(2, "0");
    const yyyy = `20${r[2]}`;
    return `${mm}/${yyyy}`;
  }

  // DD/MM/YYYY
  r = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (r) {
    const mm = String(Number(r[2])).padStart(2, "0");
    const yyyy = r[3];
    return `${mm}/${yyyy}`;
  }

  // DD/MM/YY -> 20YY
  r = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (r) {
    const mm = String(Number(r[2])).padStart(2, "0");
    const yyyy = `20${r[3]}`;
    return `${mm}/${yyyy}`;
  }

  // DD-MM-YYYY
  r = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (r) {
    const mm = String(Number(r[2])).padStart(2, "0");
    const yyyy = r[3];
    return `${mm}/${yyyy}`;
  }

  // DD-MM-YY -> 20YY
  r = t.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (r) {
    const mm = String(Number(r[2])).padStart(2, "0");
    const yyyy = `20${r[3]}`;
    return `${mm}/${yyyy}`;
  }

  return null;
}

async function fetchTextWithFallback(paths: string[]) {
  let lastErr: any = null;
  for (const p of paths) {
    try {
      const res = await fetch(`${p}?v=${Date.now()}`);
      if (!res.ok) {
        lastErr = new Error(`${p} HTTP ${res.status}`);
        continue;
      }
      const txt = await res.text();
      if (!txt || !txt.trim()) {
        lastErr = new Error(`${p} empty`);
        continue;
      }
      return { path: p, text: txt };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All fallbacks failed");
}

/** MM/YYYY -> YYYY-MM for <input type="month" /> */
function monthKeyToInputValue(mk: string) {
  const [mm, yyyy] = (mk || "").split("/");
  if (!mm || !yyyy) return "";
  return `${yyyy}-${mm}`;
}

/** YYYY-MM -> MM/YYYY */
function inputValueToMonthKey(v: string) {
  const m = (v || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const yyyy = m[1];
  const mm = m[2];
  return `${mm}/${yyyy}`;
}

/* =========================================================
   Capacity Card (unchanged)
========================================================= */

function isoMinusDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoPlusDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function growthPct(curr: number, prev: number) {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}
function formatDDMMYYYYFromISO(iso: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatDDMMYYFromISO(iso: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function computeDomain(values: Array<number | null | undefined>, padPct = 0.05, minAbsPad = 1) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return undefined;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    const pad = Math.max(minAbsPad, Math.abs(min) * padPct);
    return [min - pad, max + pad] as [number, number];
  }
  const range = max - min;
  const pad = Math.max(minAbsPad, range * padPct);
  return [min - pad, max + pad] as [number, number];
}

type CapacityCardPoint = {
  label: string;
  iso: string;
  units: number;
  prev_year_units: number | null;
  yoy_pct: number | null;
  mom_pct: number | null;
  __mean_units?: number | null;
  __p1_units?: number | null;
  __p2_units?: number | null;
  __m1_units?: number | null;
  __m2_units?: number | null;
  __mean_yoy?: number | null;
  __p1_yoy?: number | null;
  __p2_yoy?: number | null;
  __m1_yoy?: number | null;
  __m2_yoy?: number | null;
};

function monthKeyToISOStart(mk: string) {
  // mk = MM/YYYY
  const [mm, yyyy] = (mk || "").split("/");
  if (!mm || !yyyy) return null;
  const m = Number(mm);
  const y = Number(yyyy);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m < 1 || m > 12) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

function CapacityCard({
  history,
  hasHistory,
}: {
  history: Array<{ month: string; values: Record<SourceKey, number> }>;
  hasHistory: boolean;
}) {
  // Default: Last 24 months
  const [rangeDays, setRangeDays] = useState(730);
  const [fromIso, setFromIso] = useState("");
  const [toIso, setToIso] = useState("");

  // mimic RTM card: view selector exists (we keep Monthly only, but UI matches)
  const [viewAs, setViewAs] = useState<"monthly">("monthly");

  // RTM-like series toggles
  const [showUnitsSeries, setShowUnitsSeries] = useState<boolean>(true);
  const [showPrevYearSeries, setShowPrevYearSeries] = useState<boolean>(false);
  const [showYoYSeries, setShowYoYSeries] = useState<boolean>(false);
  const [showMoMSeries, setShowMoMSeries] = useState<boolean>(false);
  const [showControlLines, setShowControlLines] = useState<boolean>(true);

  // Build monthly total series from history (same file capacity.csv)
  const series = useMemo(() => {
    const rows = (history || [])
      .map((r) => {
        const iso = monthKeyToISOStart(r.month);
        if (!iso) return null;
        const total = sumSources(r.values as any, SOURCES);
        return { iso, total, mk: r.month };
      })
      .filter((x): x is { iso: string; total: number; mk: string } => !!x)
      .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

    const lookup = new Map(rows.map((r) => [r.iso, r.total] as const));

    // helper to get previous month iso (YYYY-MM-01)
    const prevMonthISO = (iso: string) => {
      const y = Number(iso.slice(0, 4));
      const m = Number(iso.slice(5, 7));
      const d = new Date(Date.UTC(y, m - 2, 1));
      return d.toISOString().slice(0, 10);
    };

    const prevYearSameMonthISO = (iso: string) => {
      const y = Number(iso.slice(0, 4));
      const m = Number(iso.slice(5, 7));
      const d = new Date(Date.UTC(y - 1, m - 1, 1));
      return d.toISOString().slice(0, 10);
    };

    return rows.map((r) => {
      const pyIso = prevYearSameMonthISO(r.iso);
      const pmIso = prevMonthISO(r.iso);

      const py = lookup.get(pyIso) ?? null;
      const pm = lookup.get(pmIso) ?? null;

      return {
        iso: r.iso,
        label: formatDDMMYYYYFromISO(r.iso),
        units: r.total,
        prev_year_units: py,
        yoy_pct: py != null ? growthPct(r.total, py) : null,
        mom_pct: pm != null ? growthPct(r.total, pm) : null,
      } as CapacityCardPoint;
    });
  }, [history]);

  const hasData = hasHistory && series.length > 0;

  // default from/to based on range
  useEffect(() => {
    if (!hasData) return;
    const lastIso = series[series.length - 1].iso;
    if (!toIso) setToIso(lastIso);
    if (!fromIso) setFromIso(isoMinusDays(lastIso, clamp(rangeDays, 30, 3650)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, series]);

  const filtered = useMemo(() => {
    if (!hasData) return [];
    const lastIso = series[series.length - 1].iso;
    const effectiveTo = toIso || lastIso;
    const effectiveFrom = fromIso || isoMinusDays(lastIso, clamp(rangeDays, 30, 3650));
    const f = effectiveFrom <= effectiveTo ? effectiveFrom : effectiveTo;
    const t = effectiveFrom <= effectiveTo ? effectiveTo : effectiveFrom;
    return series.filter((p) => p.iso >= f && p.iso <= t);
  }, [hasData, series, fromIso, toIso, rangeDays]);

  const controlStatsLeft = useMemo(() => {
    if (!showControlLines) return null;
    if (!filtered.length) return null;

    const values: number[] = [];
    if (showUnitsSeries) for (const p of filtered) values.push(p.units);
    else if (showPrevYearSeries)
      for (const p of filtered) if (p.prev_year_units != null) values.push(p.prev_year_units);

    if (values.length < 2) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
    const sd = Math.sqrt(variance);
    return { mean, sd, p1: mean + sd, p2: mean + 2 * sd, m1: mean - sd, m2: mean - 2 * sd };
  }, [showControlLines, filtered, showUnitsSeries, showPrevYearSeries]);

  const controlStatsYoY = useMemo(() => {
    if (!showControlLines) return null;
    if (!filtered.length) return null;
    if (!showYoYSeries) return null;

    const values: number[] = [];
    for (const p of filtered) if (p.yoy_pct != null) values.push(p.yoy_pct);
    if (values.length < 2) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
    const sd = Math.sqrt(variance);
    return { mean, sd, p1: mean + sd, p2: mean + 2 * sd, m1: mean - sd, m2: mean - 2 * sd };
  }, [showControlLines, filtered, showYoYSeries]);

  const chartData = useMemo(() => {
    return filtered.map((p) => ({
      ...p,
      __mean_units: controlStatsLeft ? controlStatsLeft.mean : null,
      __p1_units: controlStatsLeft ? controlStatsLeft.p1 : null,
      __p2_units: controlStatsLeft ? controlStatsLeft.p2 : null,
      __m1_units: controlStatsLeft ? controlStatsLeft.m1 : null,
      __m2_units: controlStatsLeft ? controlStatsLeft.m2 : null,

      __mean_yoy: controlStatsYoY ? controlStatsYoY.mean : null,
      __p1_yoy: controlStatsYoY ? controlStatsYoY.p1 : null,
      __p2_yoy: controlStatsYoY ? controlStatsYoY.p2 : null,
      __m1_yoy: controlStatsYoY ? controlStatsYoY.m1 : null,
      __m2_yoy: controlStatsYoY ? controlStatsYoY.m2 : null,
    }));
  }, [filtered, controlStatsLeft, controlStatsYoY]);

  const anyTotalsShown = showUnitsSeries || showPrevYearSeries || (showControlLines && !!controlStatsLeft);
  const anyPctShown = showYoYSeries || showMoMSeries || (showControlLines && !!controlStatsYoY);

  const leftAxisDomain = useMemo(() => {
    if (!chartData.length) return undefined;
    const vals: Array<number | null> = [];
    if (showUnitsSeries) vals.push(...chartData.map((d) => d.units));
    if (showPrevYearSeries) vals.push(...chartData.map((d) => d.prev_year_units));
    if (showControlLines) {
      vals.push(...chartData.map((d) => d.__mean_units ?? null));
      vals.push(...chartData.map((d) => d.__p1_units ?? null));
      vals.push(...chartData.map((d) => d.__p2_units ?? null));
      vals.push(...chartData.map((d) => d.__m1_units ?? null));
      vals.push(...chartData.map((d) => d.__m2_units ?? null));
    }
    return computeDomain(vals, 0.05, 0.5);
  }, [chartData, showUnitsSeries, showPrevYearSeries, showControlLines]);

  const rightAxisDomain = useMemo(() => {
    if (!chartData.length) return undefined;
    const vals: Array<number | null> = [];
    if (showYoYSeries) vals.push(...chartData.map((d) => d.yoy_pct));
    if (showMoMSeries) vals.push(...chartData.map((d) => d.mom_pct));
    if (showControlLines) {
      vals.push(...chartData.map((d) => d.__mean_yoy ?? null));
      vals.push(...chartData.map((d) => d.__p1_yoy ?? null));
      vals.push(...chartData.map((d) => d.__p2_yoy ?? null));
      vals.push(...chartData.map((d) => d.__m1_yoy ?? null));
      vals.push(...chartData.map((d) => d.__m2_yoy ?? null));
    }
    return computeDomain(vals, 0.05, 1);
  }, [chartData, showYoYSeries, showMoMSeries, showControlLines]);

  const fmtValue = (x: number | null | undefined) => {
    const n = asFiniteNumber(x);
    if (n == null) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n.toFixed(2)));
  };

  const fmtPct = (x: number | null | undefined) => {
    const n = asFiniteNumber(x);
    if (n == null) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${Number(n.toFixed(2)).toFixed(2)}%`;
  };

  return (
    <div className="mt-6 grid grid-cols-1 gap-4">
      <Card
        title="Capacity"
        right={
          hasData ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Range</span>
              <select
                value={rangeDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRangeDays(v);
                  if (series.length) {
                    const lastIso = series[series.length - 1].iso;
                    setToIso(lastIso);
                    setFromIso(isoMinusDays(lastIso, clamp(v, 30, 3650)));
                  }
                }}
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
              >
                <option value={60}>Last 60 days</option>
                <option value={120}>Last 120 days</option>
                <option value={365}>Last 12 months</option>
                <option value={730}>Last 24 months</option>
                <option value={1825}>Last 5 years</option>
                <option value={3650}>Last 10 years</option>
              </select>
            </div>
          ) : null
        }
      >
        {!hasData ? (
          <div className="text-sm text-slate-600">
            Capacity chart will appear once <span className="font-mono">/data/capacity.csv</span> loads.
          </div>
        ) : (
          <>
            {/* Controls (RTM-like layout) */}
            <div className="mb-3 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="flex-1">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-slate-600">From</div>
                      <input
                        type="date"
                        value={fromIso}
                        onChange={(e) => setFromIso(e.target.value)}
                        className="mt-1 w-full min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                      />
                      <div className="mt-1 text-[12px] font-medium text-slate-600 tabular-nums">
                        {fromIso ? formatDDMMYYFromISO(fromIso) : ""}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-slate-600">To</div>
                      <input
                        type="date"
                        value={toIso}
                        onChange={(e) => setToIso(e.target.value)}
                        className="mt-1 w-full min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                      />
                      <div className="mt-1 text-[12px] font-medium text-slate-600 tabular-nums">
                        {toIso ? formatDDMMYYFromISO(toIso) : ""}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-xs font-medium text-slate-600">View as</div>
                    <select
                      value={viewAs}
                      onChange={(e) => setViewAs(e.target.value as any)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <option value="monthly">Monthly (Installed Capacity)</option>
                    </select>
                  </div>
                </div>

                <div className="lg:w-[360px] lg:shrink-0">
                  <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-700">Series toggles</div>
                      <label className="flex items-center gap-2 text-[12px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={showControlLines}
                          onChange={(e) => setShowControlLines(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="font-medium">Show Control Lines</span>
                      </label>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showUnitsSeries}
                          onChange={(e) => setShowUnitsSeries(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="font-medium">Total Current</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showPrevYearSeries}
                          onChange={(e) => setShowPrevYearSeries(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="font-medium">Total (previous year)</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showYoYSeries}
                          onChange={(e) => setShowYoYSeries(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="font-medium">YoY %</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showMoMSeries}
                          onChange={(e) => setShowMoMSeries(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="font-medium">MoM %</span>
                      </label>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowUnitsSeries(false);
                          setShowPrevYearSeries(false);
                          setShowMoMSeries(false);
                          setShowYoYSeries(true);
                        }}
                        className="rounded-lg bg-slate-900 px-2 py-1 text-[12px] font-semibold text-white hover:bg-slate-800"
                      >
                        YoY% only
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowUnitsSeries(true);
                          setShowPrevYearSeries(true);
                          setShowMoMSeries(false);
                          setShowYoYSeries(false);
                        }}
                        className="rounded-lg bg-white px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                      >
                        Totals only
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-500">
                    Capacity series is monthly (from capacity.csv). YoY compares same month last year; MoM compares prior month.
                  </div>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="h-[380px] sm:h-[460px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 42, bottom: 12, left: 42 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={24} />

                  {anyTotalsShown ? (
                    <YAxis
                      yAxisId="left"
                      width={92}
                      tickMargin={10}
                      domain={leftAxisDomain ?? ["auto", "auto"]}
                      padding={{ top: 10, bottom: 10 }}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => {
                        const n = asFiniteNumber(v);
                        if (n == null) return "—";
                        return new Intl.NumberFormat("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }).format(Number(n.toFixed(2)));
                      }}
                    />
                  ) : null}

                  {anyPctShown ? (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      width={84}
                      tickMargin={10}
                      domain={rightAxisDomain ?? ["auto", "auto"]}
                      padding={{ top: 10, bottom: 10 }}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => {
                        const n = asFiniteNumber(v);
                        return n == null ? "—" : `${Number(n.toFixed(2)).toFixed(2)}%`;
                      }}
                    />
                  ) : null}

                  <Tooltip
                    wrapperStyle={{ outline: "none" }}
                    formatter={(v: any, name: any, item: any) => {
                      const key = (item && (item.dataKey as string)) || (name as string);
                      const num = asFiniteNumber(v);

                      if (key === "units") return [fmtValue(num ?? null), "Total Current (GW)"];
                      if (key === "prev_year_units") return [fmtValue(num ?? null), "Total (previous year) (GW)"];
                      if (key === "yoy_pct") return [fmtPct(num ?? null), "YoY %"];
                      if (key === "mom_pct") return [fmtPct(num ?? null), "MoM %"];

                      if (key === "__mean_units") return [fmtValue(num ?? null), "Mean"];
                      if (key === "__p1_units") return [fmtValue(num ?? null), "+1σ"];
                      if (key === "__p2_units") return [fmtValue(num ?? null), "+2σ"];
                      if (key === "__m1_units") return [fmtValue(num ?? null), "-1σ"];
                      if (key === "__m2_units") return [fmtValue(num ?? null), "-2σ"];

                      if (key === "__mean_yoy") return [fmtPct(num ?? null), "Mean (YoY%)"];
                      if (key === "__p1_yoy") return [fmtPct(num ?? null), "+1σ (YoY%)"];
                      if (key === "__p2_yoy") return [fmtPct(num ?? null), "+2σ (YoY%)"];
                      if (key === "__m1_yoy") return [fmtPct(num ?? null), "-1σ (YoY%)"];
                      if (key === "__m2_yoy") return [fmtPct(num ?? null), "-2σ (YoY%)"];

                      return [v, String(name)];
                    }}
                    labelFormatter={(l: any) => `Label: ${l}`}
                  />

                  <Legend />

                  {showUnitsSeries ? (
                    <Line yAxisId="left" type="monotone" dataKey="units" name="Current" dot={false} strokeWidth={2} stroke="#dc2626" />
                  ) : null}

                  {showPrevYearSeries ? (
                    <Line yAxisId="left" type="monotone" dataKey="prev_year_units" name="Previous year" dot={false} strokeWidth={2} stroke="#6b7280" connectNulls />
                  ) : null}

                  {showYoYSeries ? (
                    <Line yAxisId="right" type="monotone" dataKey="yoy_pct" name="YoY %" dot={false} strokeWidth={2} stroke="#16a34a" connectNulls />
                  ) : null}

                  {showMoMSeries ? (
                    <Line yAxisId="right" type="monotone" dataKey="mom_pct" name="MoM %" dot={false} strokeWidth={2} stroke="#dc2626" connectNulls />
                  ) : null}

                  {showControlLines && controlStatsLeft ? (
                    <>
                      <Line yAxisId="left" type="monotone" dataKey="__mean_units" name="Mean" dot={false} strokeWidth={2} stroke="#000000" connectNulls />
                      <Line yAxisId="left" type="monotone" dataKey="__p1_units" name="+1σ" dot={false} strokeWidth={2} stroke="#2563eb" strokeDasharray="6 4" connectNulls />
                      <Line yAxisId="left" type="monotone" dataKey="__p2_units" name="+2σ" dot={false} strokeWidth={2} stroke="#4f46e5" strokeDasharray="6 4" connectNulls />
                      <Line yAxisId="left" type="monotone" dataKey="__m1_units" name="-1σ" dot={false} strokeWidth={2} stroke="#f97316" strokeDasharray="6 4" connectNulls />
                      <Line yAxisId="left" type="monotone" dataKey="__m2_units" name="-2σ" dot={false} strokeWidth={2} stroke="#eab308" strokeDasharray="6 4" connectNulls />
                    </>
                  ) : null}

                  {showControlLines && controlStatsYoY ? (
                    <>
                      <Line yAxisId="right" type="monotone" dataKey="__mean_yoy" name="Mean (YoY%)" dot={false} strokeWidth={2} stroke="#000000" connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="__p1_yoy" name="+1σ (YoY%)" dot={false} strokeWidth={2} stroke="#2563eb" strokeDasharray="6 4" connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="__p2_yoy" name="+2σ (YoY%)" dot={false} strokeWidth={2} stroke="#4f46e5" strokeDasharray="6 4" connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="__m1_yoy" name="-1σ (YoY%)" dot={false} strokeWidth={2} stroke="#f97316" strokeDasharray="6 4" connectNulls />
                      <Line yAxisId="right" type="monotone" dataKey="__m2_yoy" name="-2σ (YoY%)" dot={false} strokeWidth={2} stroke="#eab308" strokeDasharray="6 4" connectNulls />
                    </>
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Plotted series: Total Installed Capacity (GW) = sum of all sources in capacity.csv for each month.
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function RatedCapacity() {
  // ----------------------------
  // Rated Capacity (top card)
  // ----------------------------
  const INSTALLED_KEY = "ratedCapacity_installed";
  const PLF_KEY = "ratedCapacity_plf";

  const [installed, setInstalled] = useState<Record<SourceKey, number>>(() => {
    const base = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<SourceKey, number>;
    try {
      const raw = localStorage.getItem(INSTALLED_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const s of SOURCES) base[s] = safeNum(obj?.[s]);
      }
    } catch {}
    return base;
  });

  const [plf, setPlf] = useState<Record<SourceKey, number>>(() => {
    const base = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<SourceKey, number>;
    try {
      const raw = localStorage.getItem(PLF_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const s of SOURCES) base[s] = safeNum(obj?.[s]);
      }
    } catch {}
    return base;
  });

  const [capacityCsvMissing, setCapacityCsvMissing] = useState(false);
  const [capacityCsvMsg, setCapacityCsvMsg] = useState<string | null>(null);

  /**
   * ✅ NEW: Initialize "installed" from LATEST month row in /data/capacity.csv
   * Only if localStorage installed is all zeros (i.e., user hasn't set it yet).
   */
  useEffect(() => {
    let cancelled = false;

    async function loadInstalledFromLatestCapacityCSV() {
      try {
        const { text } = await fetchTextWithFallback(["/data/capacity.csv"]);
        const { header, rows } = parseCSVSimple(text);
        if (!header.length || !rows.length) throw new Error("Empty CSV");

        const normHeaders = header.map(normalizeHeader);

        const monthIdx = normHeaders.findIndex(
          (h) => h === "month" || h === "date" || h === "capacity (gw)" || h === "capacity(gw)"
        );
        if (monthIdx === -1) throw new Error("Missing Month/Date column");

        const sourceIdx: Record<SourceKey, number> = {} as any;
        for (const s of SOURCES) {
          const want = normalizeHeader(s);
          sourceIdx[s] = normHeaders.findIndex((h) => h === want);
        }

        type ParsedRow = { month: string; values: Record<SourceKey, number> };
        const parsed: ParsedRow[] = [];

        for (const row of rows) {
          const mkRaw = row[monthIdx] ?? "";
          const mk = normalizeMonth(mkRaw);
          if (!mk) continue;

          const values: Record<SourceKey, number> = {} as any;
          for (const s of SOURCES) {
            const idx = sourceIdx[s];
            values[s] = idx >= 0 ? safeNum(row[idx]) : 0;
          }
          parsed.push({ month: mk, values });
        }

        parsed.sort((a, b) => compareMonthKey(a.month, b.month));
        const latest = parsed.length ? parsed[parsed.length - 1] : null;
        if (!latest) throw new Error("No valid month rows found");

        const next = { ...installed };
        let any = false;
        for (const s of SOURCES) {
          const v = safeNum(latest.values[s]);
          if (Number.isFinite(v)) {
            next[s] = v;
            any = true;
          }
        }

        if (!cancelled && any) {
          setInstalled(next);
          setCapacityCsvMissing(false);
          setCapacityCsvMsg(null);
        }
      } catch {
        if (!cancelled) {
          setCapacityCsvMissing(true);
          setCapacityCsvMsg("capacity.csv not loaded – enter values manually.");
        }
      }
    }

    const hasNonZeroLocal = Object.values(installed).some((v) => Number(v) !== 0);
    if (!hasNonZeroLocal) loadInstalledFromLatestCapacityCSV();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(INSTALLED_KEY, JSON.stringify(installed));
    } catch {}
  }, [installed]);

  useEffect(() => {
    try {
      localStorage.setItem(PLF_KEY, JSON.stringify(plf));
    } catch {}
  }, [plf]);

  const installedTotal = useMemo(() => {
    return sumSources(installed as unknown as Record<string, number>, SOURCES);
  }, [installed]);

  const ratedBySource = useMemo(() => {
    const out: Record<SourceKey, number> = {} as any;
    for (const s of SOURCES) {
      out[s] = round2(safeNum(installed[s]) * (safeNum(plf[s]) / 100));
    }
    return out;
  }, [installed, plf]);

  const ratedTotal = useMemo(() => {
    return sumSources(ratedBySource as unknown as Record<string, number>, SOURCES);
  }, [ratedBySource]);

  // ----------------------------
  // Historical Capacity
  // ----------------------------
  type MonthRow = { month: string; values: Record<SourceKey, number> };

  const [history, setHistory] = useState<MonthRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoadedFrom, setHistoryLoadedFrom] = useState<string | null>(null);

  const monthOptions = useMemo(() => {
    const opts = history.map((r) => r.month).filter(Boolean);
    const uniq = Array.from(new Set(opts));
    return uniq.slice().sort(compareMonthKey);
  }, [history]);

  const latestMonth = useMemo(() => {
    if (!monthOptions.length) return null;
    return monthOptions[monthOptions.length - 1];
  }, [monthOptions]);

  const defaultStartMonth = useMemo(() => {
    if (!latestMonth) return null;
    const candidate = minusMonths(latestMonth, 12);
    return clampMonthKeyToOptions(candidate, monthOptions);
  }, [latestMonth, monthOptions]);

  const [startMonth, setStartMonth] = useState<string>("");
  const [endMonth, setEndMonth] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        setHistoryError(null);

        const { path, text } = await fetchTextWithFallback(["/data/capacity.csv"]);

        const { header, rows } = parseCSVSimple(text);
        if (!header.length || !rows.length) throw new Error("Empty CSV");

        const normHeaders = header.map(normalizeHeader);

        const monthIdx = normHeaders.findIndex(
          (h) => h === "month" || h === "date" || h === "capacity (gw)" || h === "capacity(gw)"
        );
        if (monthIdx === -1) throw new Error(`Missing Month/Date column`);

        const sourceIdx: Record<SourceKey, number> = {} as any;
        for (const s of SOURCES) {
          const want = normalizeHeader(s);
          const idx = normHeaders.findIndex((h) => h === want);
          sourceIdx[s] = idx;
        }

        const parsed: MonthRow[] = [];
        for (const row of rows) {
          const mkRaw = row[monthIdx] ?? "";
          const mk = normalizeMonth(mkRaw);
          if (!mk) continue;

          const values: Record<SourceKey, number> = {} as any;
          for (const s of SOURCES) {
            const idx = sourceIdx[s];
            values[s] = idx >= 0 ? safeNum(row[idx]) : 0;
          }
          parsed.push({ month: mk, values });
        }

        parsed.sort((a, b) => compareMonthKey(a.month, b.month));

        if (!cancelled) {
          setHistory(parsed);
          setHistoryLoadedFrom(path);
          setHistoryError(null);

          if (!parsed.length) {
            setHistoryError(
              `Loaded ${path} but found 0 valid rows. Ensure Month/Date values are MM/YYYY, MM/YY, DD/MM/YY, or DD/MM/YYYY.`
            );
          }
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
          setHistoryLoadedFrom(null);
          setHistoryError(
            "capacity.csv not loaded – ensure /public/data/capacity.csv exists with Month/Date + source columns."
          );
        }
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!monthOptions.length) return;

    const end = latestMonth || monthOptions[monthOptions.length - 1];
    const start =
      defaultStartMonth ||
      monthOptions[Math.max(0, monthOptions.length - 13)] ||
      monthOptions[0];

    setEndMonth((prev) => (prev ? clampMonthKeyToOptions(prev, monthOptions) : end));
    setStartMonth((prev) => (prev ? clampMonthKeyToOptions(prev, monthOptions) : start));
  }, [monthOptions, latestMonth, defaultStartMonth]);

  useEffect(() => {
    if (!startMonth || !endMonth) return;
    if (compareMonthKey(startMonth, endMonth) > 0) {
      setStartMonth(endMonth);
    }
  }, [startMonth, endMonth]);

  const startRow = useMemo(() => {
    if (!startMonth) return null;
    const matches = history.filter((r) => r.month === startMonth);
    if (!matches.length) return null;
    return matches[matches.length - 1];
  }, [history, startMonth]);

  const endRow = useMemo(() => {
    if (!endMonth) return null;
    const matches = history.filter((r) => r.month === endMonth);
    if (!matches.length) return null;
    return matches[matches.length - 1];
  }, [history, endMonth]);

  const startTotals = useMemo(() => {
    const vals = startRow?.values;
    if (!vals) return null;
    return { per: vals, total: sumSources(vals as any, SOURCES) };
  }, [startRow]);

  const endTotals = useMemo(() => {
    const vals = endRow?.values;
    if (!vals) return null;
    return { per: vals, total: sumSources(vals as any, SOURCES) };
  }, [endRow]);

  const netAdditions = useMemo(() => {
    const out: Record<SourceKey, number> = {} as any;
    for (const s of SOURCES) {
      const a = startTotals?.per?.[s];
      const b = endTotals?.per?.[s];
      if (a == null || b == null) out[s] = 0;
      else out[s] = round2(b - a);
    }
    const total = startTotals && endTotals ? round2(endTotals.total - startTotals.total) : 0;
    return { per: out, total };
  }, [startTotals, endTotals]);

  const minMonthInput = useMemo(() => {
    if (!monthOptions.length) return "";
    return monthKeyToInputValue(monthOptions[0]);
  }, [monthOptions]);

  const maxMonthInput = useMemo(() => {
    if (!monthOptions.length) return "";
    return monthKeyToInputValue(monthOptions[monthOptions.length - 1]);
  }, [monthOptions]);

  const startMonthInputValue = useMemo(() => monthKeyToInputValue(startMonth), [startMonth]);
  const endMonthInputValue = useMemo(() => monthKeyToInputValue(endMonth), [endMonth]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-1 gap-6">
          {/* ===========================
              Rated Capacity (existing)
              =========================== */}
          <Card title="Rated Capacity" right={<div className="text-xs text-slate-500">GW</div>}>
            {capacityCsvMissing && capacityCsvMsg ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {capacityCsvMsg}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
              <table className="w-full border-collapse bg-white text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-700">
                      <span className="font-bold text-slate-900">Capacity (GW)</span>
                    </th>
                    {SOURCES.map((s) => (
                      <th key={s} className="px-3 py-2 text-xs font-semibold text-slate-700 text-right">
                        {s}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-xs font-semibold text-slate-700 text-right">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">
                      Capacity as on current date
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={installed[s]}
                          onChange={(e) => {
                            const v = safeNum(e.target.value);
                            setInstalled((prev) => ({ ...prev, [s]: v }));
                          }}
                          className={numberInputClass()}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {fmt2(installedTotal)}
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">PLF %</td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          max={100}
                          value={plf[s]}
                          onChange={(e) => {
                            const v = safeNum(e.target.value);
                            setPlf((prev) => ({ ...prev, [s]: v }));
                          }}
                          className={numberInputClass()}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-500">
                      —
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">Rated Capacity</td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                        {fmt2(ratedBySource[s])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {fmt2(ratedTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Rated Capacity (GW) = Installed Capacity × (PLF / 100). Values are editable and saved locally in your browser.
            </div>
          </Card>

          {/* ===========================
              Historical Capacity
              =========================== */}
          <Card title="Historical Capacity" right={<div className="text-xs text-slate-500">GW</div>}>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-600">Start Month/Year</div>
                <input
                  type="month"
                  value={startMonthInputValue}
                  min={minMonthInput}
                  max={endMonthInputValue || maxMonthInput}
                  onChange={(e) => {
                    const mk = inputValueToMonthKey(e.target.value);
                    const clamped = mk ? clampMonthKeyToOptions(mk, monthOptions) : "";
                    if (!clamped) return;
                    setStartMonth(clamped);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-600">End Month/Year</div>
                <input
                  type="month"
                  value={endMonthInputValue}
                  min={startMonthInputValue || minMonthInput}
                  max={maxMonthInput}
                  onChange={(e) => {
                    const mk = inputValueToMonthKey(e.target.value);
                    const clamped = mk ? clampMonthKeyToOptions(mk, monthOptions) : "";
                    if (!clamped) return;
                    setEndMonth(clamped);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            </div>

            {historyError ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {historyError}
              </div>
            ) : historyLoadedFrom ? (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Loaded from: <span className="font-semibold">{historyLoadedFrom}</span>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
              <table className="w-full table-fixed border-collapse bg-white text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-[170px] px-2 py-2 text-xs font-semibold text-slate-700">
                      <span className="font-bold text-slate-900">Capacity (GW)</span>
                    </th>
                    {SOURCES.map((s) => (
                      <th
                        key={s}
                        className="px-2 py-2 text-xs font-semibold text-slate-700 text-right whitespace-normal break-words"
                      >
                        {s}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-xs font-semibold text-slate-700 text-right">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold text-slate-900">
                      Capacity as on Start Date ({startMonth || "—"})
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-2 py-2 text-right tabular-nums text-slate-900">
                        {startTotals ? fmt2(startTotals.per[s]) : "—"}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {startTotals ? fmt2(startTotals.total) : "—"}
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold text-slate-900">
                      Capacity as on End Date ({endMonth || "—"})
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-2 py-2 text-right tabular-nums text-slate-900">
                        {endTotals ? fmt2(endTotals.per[s]) : "—"}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {endTotals ? fmt2(endTotals.total) : "—"}
                    </td>
                  </tr>

                  <tr className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold text-slate-900">Net Addition (GW)</td>
                    {SOURCES.map((s) => {
                      const v = netAdditions.per[s];
                      const cls = netColorClass(v);
                      const sign = v > 0 ? "+" : "";
                      return (
                        <td key={s} className={`px-2 py-2 text-right font-semibold tabular-nums ${cls}`}>
                          {startTotals && endTotals ? `${sign}${fmt2(v)}` : "—"}
                        </td>
                      );
                    })}
                    <td
                      className={`px-2 py-2 text-right font-semibold tabular-nums ${
                        startTotals && endTotals ? netColorClass(netAdditions.total) : "text-slate-700"
                      }`}
                    >
                      {startTotals && endTotals
                        ? `${netAdditions.total > 0 ? "+" : ""}${fmt2(netAdditions.total)}`
                        : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Net Addition (GW) = Capacity at End Date − Capacity at Start Date. Data sourced from monthly capacity.csv.
            </div>
          </Card>

          {/* ===========================
              Capacity (NEW) — RTM-like card below Historical Capacity
              =========================== */}
          <CapacityCard history={history} hasHistory={history.length > 0 && !historyError} />
        </div>
      </div>
    </div>
  );
}
