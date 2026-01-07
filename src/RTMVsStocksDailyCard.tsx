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
  ReferenceLine
} from "recharts";

type Mode = "price" | "ptb";
type WindowDays = 7 | 14 | 30 | 45;

function parseISOKey(s: string) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : s;
}

function excelSerialToISO(n: number) {
  if (!Number.isFinite(n)) return null;
  const ms = Math.round(n * 86400000);
  const base = Date.UTC(1899, 11, 30);
  const d = new Date(base + ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Accepts:
 * - Excel Date objects
 * - Excel serial numbers
 * - DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, DD-MM-YY
 * - ISO YYYY-MM-DD
 *
 * ✅ FIX: Date objects from XLSX must NOT use toISOString() because timezone conversion
 * can shift the day back (IST -> UTC). We extract local calendar YYYY-MM-DD instead.
 */
function parseInputDate(s: unknown) {
  if (s instanceof Date && !Number.isNaN(s.getTime())) {
    const yyyy = s.getFullYear();
    const mm = String(s.getMonth() + 1).padStart(2, "0");
    const dd = String(s.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof s === "number" && Number.isFinite(s)) {
    if (s > 20000 && s < 80000) return excelSerialToISO(s);
  }

  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;

  let m: RegExpMatchArray | null;

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime()))
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = 2000 + Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime()))
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime()))
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = 2000 + Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime()))
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return parseISOKey(t);
  return null;
}

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

function isoMinusMonths(anchorIso: string, months: number) {
  const d = new Date(anchorIso + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetMonthIndex = m - months;
  const targetDate = new Date(Date.UTC(y, targetMonthIndex, 1));
  const lastDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);

  const out = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), clampedDay));
  return out.toISOString().slice(0, 10);
}

function isoStartOfYear(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  const y = d.getUTCFullYear();
  return new Date(Date.UTC(y, 0, 1)).toISOString().slice(0, 10);
}

function formatDDMMYYYY(iso: string) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function formatDDMMYY(iso: string) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function growthPct(curr: number, prev: number) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function normalizeKey(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/–/g, "-")
    .replace(/—/g, "-");
}

function parseRtmCsv(text: string, valueColumnKey: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return new Map<string, number>();

  const header = lines[0].split(",").map((h) => normalizeKey(h));
  const want = normalizeKey(valueColumnKey);
  const valueIdx = header.indexOf(want) >= 0 ? header.indexOf(want) : 1;

  const m = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < 2) continue;

    const d = parseInputDate(cols[0]);
    const v = asFiniteNumber(String(cols[valueIdx] ?? cols[1] ?? "").replace(/,/g, ""));
    if (!d || v == null) continue;
    m.set(d, v);
  }
  return m;
}

type StockSheets = {
  prices: {
    dates: string[];
    cols: string[];
    values: Map<string, Map<string, number>>;
    latestDate: string | null;
  };
  ptb: {
    dates: string[];
    cols: string[];
    values: Map<string, Map<string, number>>;
    latestDate: string | null;
  };
};

function buildEmptySheets(): StockSheets {
  return {
    prices: { dates: [], cols: [], values: new Map(), latestDate: null },
    ptb: { dates: [], cols: [], values: new Map(), latestDate: null }
  };
}

async function loadStockXlsx(url: string): Promise<StockSheets> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stock file HTTP ${res.status}`);

  const buf = await res.arrayBuffer();
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetNames = wb.SheetNames || [];

  const s1 = sheetNames[0];
  const s2 = sheetNames[1];

  const out = buildEmptySheets();

  function parseSheet(sheetName: string | undefined) {
    if (!sheetName)
      return { dates: [] as string[], cols: [] as string[], values: new Map(), latestDate: null as string | null };

    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!aoa || aoa.length < 2) return { dates: [], cols: [], values: new Map(), latestDate: null };

    const header = (aoa[0] || []).map((x) => String(x ?? "").trim());
    const cols = header.slice(1).filter(Boolean);

    const values = new Map<string, Map<string, number>>();
    for (const c of cols) values.set(c, new Map());

    const dates: string[] = [];

    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const d = parseInputDate(row[0]);
      if (!d) continue;

      let any = false;
      for (let ci = 0; ci < cols.length; ci++) {
        const colName = cols[ci];
        const v = asFiniteNumber(row[ci + 1]);
        if (v == null) continue;
        values.get(colName)!.set(d, v);
        any = true;
      }
      if (any) dates.push(d);
    }

    dates.sort();
    const latestDate = dates.length ? dates[dates.length - 1] : null;
    return { dates, cols, values, latestDate };
  }

  out.prices = parseSheet(s1);
  out.ptb = parseSheet(s2);
  return out;
}

function rollingAvgStocks(series: Map<string, number>, anchor: string, n: number) {
  const dates = Array.from(series.keys()).filter((d) => d <= anchor).sort();
  if (!dates.length) return null;

  const last = dates.slice(Math.max(0, dates.length - n));
  if (!last.length) return null;

  const vals = last.map((d) => series.get(d)!).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;

  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function rollingAvgRtm(series: Map<string, number>, anchor: string, n: number) {
  const start = isoMinusDays(anchor, n - 1);
  let cur = start;
  let sum = 0;
  let count = 0;

  while (cur <= anchor) {
    const v = series.get(cur);
    if (v != null) {
      sum += v;
      count += 1;
    }
    cur = isoPlusDays(cur, 1);
  }

  if (!count) return null;
  return sum / count;
}

function Card({
  title,
  right,
  children
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

const STOCK_COLORS = [
  "#2563eb", // blue
  "#9333ea", // purple
  "#0f766e", // teal
  "#f59e0b", // amber
  "#ef4444", // red
  "#16a34a", // green
  "#db2777", // pink
  "#475569" // slate
];
function getStockColor(i: number) {
  return STOCK_COLORS[i % STOCK_COLORS.length];
}

type RangePreset = "1m" | "3m" | "6m" | "12m" | "24m" | "36m" | "ytd" | "all";

export default function RTMVsStocksDailyCard(props: {
  rtmCsvUrl: string;
  stockFileUrl: string;
  rtmValueColumnKey: string;
}) {
  const { rtmCsvUrl, stockFileUrl, rtmValueColumnKey } = props;

  const [rtmMap, setRtmMap] = useState<Map<string, number>>(new Map());
  const [stockSheets, setStockSheets] = useState<StockSheets>(buildEmptySheets());

  const [mode, setMode] = useState<Mode>("price");
  const [windowDays, setWindowDays] = useState<WindowDays>(45);

  // toggles
  const [showYoY, setShowYoY] = useState(false);
  const [showRtmControlLines, setShowRtmControlLines] = useState(false);

  // lag control
  const [lagDays, setLagDays] = useState<number>(0);

  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // range preset + inputs
  const [preset, setPreset] = useState<RangePreset>("24m");
  const [fromInput, setFromInput] = useState<string>("");
  const [toInput, setToInput] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading("Loading RTM + Stocks...");
        setErr(null);

        const rtmRes = await fetch(`${encodeURI(rtmCsvUrl)}?v=${Date.now()}`);
        if (!rtmRes.ok) throw new Error(`RTM HTTP ${rtmRes.status}`);
        const rtmText = await rtmRes.text();
        const rtm = parseRtmCsv(rtmText, rtmValueColumnKey);

        const stocks = await loadStockXlsx(`${encodeURI(stockFileUrl)}?v=${Date.now()}`);

        if (cancelled) return;

        setRtmMap(rtm);
        setStockSheets(stocks);

        const cols = stocks.prices.cols.length ? stocks.prices.cols : stocks.ptb.cols;
        setSelectedStocks(cols.slice(0, Math.min(1, cols.length)));

        setLoading(null);
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load RTM/Stock data.");
          setLoading(null);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [rtmCsvUrl, stockFileUrl, rtmValueColumnKey]);

  const activeSheet = mode === "price" ? stockSheets.prices : stockSheets.ptb;
  const stockUniverse = activeSheet.cols;

  const anchorDate = activeSheet.latestDate;

  useEffect(() => {
    if (!anchorDate) return;

    const toIso = anchorDate;

    let fromIso = isoMinusMonths(anchorDate, 24);
    if (preset === "1m") fromIso = isoMinusMonths(anchorDate, 1);
    if (preset === "3m") fromIso = isoMinusMonths(anchorDate, 3);
    if (preset === "6m") fromIso = isoMinusMonths(anchorDate, 6);
    if (preset === "12m") fromIso = isoMinusMonths(anchorDate, 12);
    if (preset === "24m") fromIso = isoMinusMonths(anchorDate, 24);
    if (preset === "36m") fromIso = isoMinusMonths(anchorDate, 36);
    if (preset === "ytd") fromIso = isoStartOfYear(anchorDate);

    if (preset === "all") {
      const earliest = activeSheet.dates.length ? activeSheet.dates[0] : isoMinusMonths(anchorDate, 36);
      fromIso = earliest;
    }

    setToInput(formatDDMMYY(toIso));
    setFromInput(formatDDMMYY(fromIso));
  }, [anchorDate, preset, activeSheet.dates]);

  const range = useMemo(() => {
    if (!anchorDate) return { fromIso: null as string | null, toIso: null as string | null };

    const parsedTo = parseInputDate(toInput);
    const parsedFrom = parseInputDate(fromInput);

    const safeTo = parsedTo && parsedTo <= anchorDate ? parsedTo : anchorDate;

    const safeFrom = parsedFrom && parsedFrom <= safeTo ? parsedFrom : isoMinusMonths(anchorDate, 24);

    return { fromIso: safeFrom, toIso: safeTo };
  }, [anchorDate, fromInput, toInput]);

  const lagClamped = Math.max(0, Math.min(365, Math.floor(Number(lagDays) || 0)));

  const rtmAnchor = useMemo(() => {
    if (!range.toIso) return null;
    return isoMinusDays(range.toIso, lagClamped);
  }, [range.toIso, lagClamped]);

  const chartData = useMemo(() => {
    if (!range.fromIso || !range.toIso) return [];
    if (!rtmMap.size) return [];

    const points: any[] = [];
    let cur = range.fromIso;

    while (cur <= range.toIso) {
      const rtmDate = lagClamped ? isoMinusDays(cur, lagClamped) : cur;
      const rtm = rollingAvgRtm(rtmMap, rtmDate, windowDays);

      const row: any = {
        label: formatDDMMYYYY(cur),
        __iso: cur,
        rtm,
        __rtmIso: rtmDate
      };

      for (const s of selectedStocks) {
        const series = activeSheet.values.get(s);
        if (!series) continue;
        row[s] = rollingAvgStocks(series, cur, windowDays);
      }

      if (showYoY) {
        const py = isoMinusDays(cur, 365);
        const rtmPYDate = lagClamped ? isoMinusDays(py, lagClamped) : py;

        const rtmPY = rollingAvgRtm(rtmMap, rtmPYDate, windowDays);
        row.rtm_yoy = rtm != null && rtmPY != null ? growthPct(rtm, rtmPY) : null;

        for (const s of selectedStocks) {
          const series = activeSheet.values.get(s);
          if (!series) continue;
          const v = row[s] as number | null;
          const vPY = rollingAvgStocks(series, py, windowDays);
          row[`${s}_yoy`] = v != null && vPY != null ? growthPct(v, vPY) : null;
        }
      }

      points.push(row);
      cur = isoPlusDays(cur, 1);
    }

    return points;
  }, [range, rtmMap, activeSheet, selectedStocks, windowDays, showYoY, lagClamped]);

  // compute y-axis domains with "no-zero compression" + gentle padding
  const domains = useMemo(() => {
    const padPct = 0.06;

    const rtmVals = chartData
      .map((r) => asFiniteNumber(r?.rtm))
      .filter((x): x is number => x != null && Number.isFinite(x));

    const stockVals: number[] = [];
    for (const r of chartData) {
      for (const s of selectedStocks) {
        const v = asFiniteNumber(r?.[s]);
        if (v != null) stockVals.push(v);
      }
    }

    const calc = (vals: number[]) => {
      if (!vals.length) return { min: 0, max: 1 };
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      if (min === max) {
        const bump = Math.abs(min || 1) * 0.05;
        return { min: min - bump, max: max + bump };
      }
      const range = max - min;
      const pad = range * padPct;
      return { min: min - pad, max: max + pad };
    };

    return {
      rtm: calc(rtmVals),
      stocks: calc(stockVals)
    };
  }, [chartData, selectedStocks]);

  const rtmControl = useMemo(() => {
    const vals = chartData
      .map((r) => asFiniteNumber(r?.rtm))
      .filter((x): x is number => x != null && Number.isFinite(x));
    if (!vals.length) return null;

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.length > 1 ? vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (vals.length - 1) : 0;
    const sd = Math.sqrt(Math.max(0, variance));

    return { mean, sd, p1: mean + sd, p2: mean + 2 * sd, m1: mean - sd, m2: mean - 2 * sd };
  }, [chartData]);

  const quickStats = useMemo(() => {
    if (!chartData.length) return null;
    const last = chartData[chartData.length - 1];

    const rtm = asFiniteNumber(last?.rtm);
    const stocks: Record<string, number | null> = {};
    for (const s of selectedStocks) stocks[s] = asFiniteNumber(last?.[s]);

    const rtmYoY = asFiniteNumber(last?.rtm_yoy);
    const stocksYoY: Record<string, number | null> = {};
    for (const s of selectedStocks) stocksYoY[s] = asFiniteNumber(last?.[`${s}_yoy`]);

    return {
      displayDate: last?.label ?? "—",
      rtmDate: last?.__rtmIso ? formatDDMMYYYY(last.__rtmIso) : "—",
      rtm,
      stocks,
      rtmYoY,
      stocksYoY
    };
  }, [chartData, selectedStocks]);

  const fmtRtm = (x: number | null | undefined) => {
    if (x == null || Number.isNaN(x)) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(x);
  };

  const fmtNum = (x: number | null | undefined) => {
    if (x == null || Number.isNaN(x)) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(x);
  };

  const fmtPct = (x: number | null | undefined) => {
    if (x == null || Number.isNaN(x)) return "—";
    const sign = x > 0 ? "+" : "";
    return `${sign}${x.toFixed(2)}%`;
  };

  const titleRight = anchorDate ? (
    <div className="flex items-center gap-2 text-xs text-slate-600">
      <span className="text-slate-500">Anchor</span>
      <span className="font-semibold tabular-nums">{formatDDMMYYYY(anchorDate)}</span>
    </div>
  ) : null;

  // Control lines more visible
  const CONTROL_STROKE_WIDTH = 3.6;
  const CONTROL_DASH = "0"; // solid

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mt-6 grid grid-cols-1 gap-4">
          <Card title="RTM Vs Stocks (Daily Card)" right={titleRight}>
            {loading ? (
              <div className="text-sm text-slate-600">{loading}</div>
            ) : err ? (
              <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{err}</div>
            ) : !anchorDate ? (
              <div className="text-sm text-slate-600">No stock data found (check stock.xlsx sheets & date column).</div>
            ) : (
              <>
                <div className="mb-3 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="flex-1">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <div className="text-xs font-medium text-slate-600">Metric</div>
                          <select
                            value={windowDays}
                            onChange={(e) => setWindowDays(Number(e.target.value) as WindowDays)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          >
                            <option value={7}>Last 7 Days Rolling (AVG)</option>
                            <option value={14}>Last 14 Days Rolling (AVG)</option>
                            <option value={30}>Last 30 Days Rolling (AVG)</option>
                            <option value={45}>Last 45 Days Rolling (AVG)</option>
                          </select>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-600">Compare on</div>
                          <div className="mt-1 flex overflow-hidden rounded-xl ring-1 ring-slate-200">
                            <button
                              type="button"
                              onClick={() => setMode("price")}
                              className={`flex-1 px-3 py-2 text-sm font-semibold ${
                                mode === "price" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              Stock Price
                            </button>
                            <button
                              type="button"
                              onClick={() => setMode("ptb")}
                              className={`flex-1 px-3 py-2 text-sm font-semibold ${
                                mode === "ptb" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              Price-to-Book
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-600">Lag (days)</div>
                          <input
                            type="number"
                            min={0}
                            max={365}
                            step={1}
                            value={lagClamped}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const n = Math.floor(Number(raw));
                              if (!Number.isFinite(n)) {
                                setLagDays(0);
                                return;
                              }
                              setLagDays(Math.max(0, Math.min(365, n)));
                            }}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                          <div className="mt-1 text-[11px] text-slate-500">
                            RTM anchors to{" "}
                            <span className="font-semibold">{range.toIso ? formatDDMMYYYY(rtmAnchor || range.toIso) : "—"}</span> (To − {lagClamped}d). Stocks
                            anchor to To date.
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-1">
                          <div className="text-xs font-medium text-slate-600">Preset range</div>
                          <select
                            value={preset}
                            onChange={(e) => setPreset(e.target.value as RangePreset)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          >
                            <option value="1m">1 month</option>
                            <option value="3m">3 months</option>
                            <option value="6m">6 months</option>
                            <option value="12m">12 months</option>
                            <option value="24m">24 months</option>
                            <option value="36m">36 months</option>
                            <option value="ytd">YTD</option>
                            <option value="all">All time</option>
                          </select>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-600">From (DD/MM/YY)</div>
                          <input
                            value={fromInput}
                            onChange={(e) => setFromInput(e.target.value)}
                            placeholder="DD/MM/YY"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                        </div>

                        <div>
                          <div className="text-xs font-medium text-slate-600">To (DD/MM/YY)</div>
                          <input
                            value={toInput}
                            onChange={(e) => setToInput(e.target.value)}
                            placeholder="DD/MM/YY"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={showYoY}
                            onChange={(e) => setShowYoY(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="font-medium">Show YoY %</span>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={showRtmControlLines}
                            onChange={(e) => setShowRtmControlLines(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="font-medium">Show RTM control lines (Mean, ±1σ, ±2σ)</span>
                        </label>

                        <div className="text-xs text-slate-500">
                          Stocks rolling uses last {windowDays} available trading days. RTM rolling uses calendar days, lagged by {lagClamped} days.
                        </div>
                      </div>

                      {quickStats ? (
                        <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                          <div className="text-xs font-semibold text-slate-700">Quick stats (latest in range)</div>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div className="text-sm text-slate-700">
                              <span className="text-slate-500">Chart date:</span>{" "}
                              <span className="font-semibold">{quickStats.displayDate}</span>
                              <div className="text-[11px] text-slate-500">
                                RTM computed at: <span className="font-semibold">{quickStats.rtmDate}</span>
                              </div>
                            </div>

                            <div className="text-sm text-slate-700">
                              <span className="text-slate-500">RTM (rolling):</span>{" "}
                              <span className="font-semibold">{fmtRtm(quickStats.rtm)}</span>
                              {showYoY ? (
                                <div className="text-[11px] text-slate-500">
                                  YoY: <span className="font-semibold">{fmtPct(quickStats.rtmYoY)}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="text-sm text-slate-700">
                              <span className="text-slate-500">Stocks (rolling):</span>
                              <div className="mt-1 space-y-1">
                                {selectedStocks.map((s) => (
                                  <div key={s} className="flex items-center justify-between gap-2">
                                    <span className="truncate">{s}</span>
                                    <span className="font-semibold tabular-nums">{fmtNum(quickStats.stocks[s])}</span>
                                  </div>
                                ))}
                              </div>
                              {showYoY ? (
                                <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                                  {selectedStocks.map((s) => (
                                    <div key={`${s}-yoy`} className="flex items-center justify-between gap-2">
                                      <span className="truncate">{s} YoY</span>
                                      <span className="font-semibold tabular-nums">{fmtPct(quickStats.stocksYoY[s])}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="lg:w-[360px] lg:shrink-0">
                      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                        <div className="text-xs font-semibold text-slate-700">Stocks</div>
                        <div className="mt-2 max-h-[220px] overflow-auto rounded-xl bg-white ring-1 ring-slate-200">
                          {stockUniverse.length ? (
                            <div className="grid grid-cols-1 gap-2 p-2 text-[12px] text-slate-700">
                              {stockUniverse.map((s) => {
                                const checked = selectedStocks.includes(s);
                                return (
                                  <label key={s} className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setSelectedStocks((prev) => {
                                          if (on) return Array.from(new Set([...prev, s]));
                                          return prev.filter((x) => x !== s);
                                        });
                                      }}
                                      className="h-4 w-4 rounded border-slate-300"
                                    />
                                    <span className="font-medium">{s}</span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-3 text-sm text-slate-600">No columns found in active sheet.</div>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedStocks(stockUniverse.slice(0, Math.min(1, stockUniverse.length)))}
                            className="rounded-lg bg-slate-900 px-2 py-1 text-[12px] font-semibold text-white hover:bg-slate-800"
                          >
                            Pick top 1
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedStocks(stockUniverse.slice(0, Math.min(2, stockUniverse.length)))}
                            className="rounded-lg bg-white px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                          >
                            Pick top 2
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedStocks([])}
                            className="rounded-lg bg-white px-2 py-1 text-[12px] font-semibold text-rose-700 ring-1 ring-slate-200 hover:bg-slate-50"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-[380px] sm:h-[480px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 12, right: 42, bottom: 12, left: 42 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={24} />

                      <YAxis
                        yAxisId="left"
                        width={92}
                        tickMargin={10}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => fmtRtm(asFiniteNumber(v))}
                        domain={[domains.rtm.min, domains.rtm.max]}
                      />

                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        width={92}
                        tickMargin={10}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => fmtNum(asFiniteNumber(v))}
                        domain={[domains.stocks.min, domains.stocks.max]}
                      />

                      <Tooltip
                        wrapperStyle={{ outline: "none" }}
                        formatter={(v: any, name: any, item: any) => {
                          const key = (item && (item.dataKey as string)) || (name as string);
                          const num = asFiniteNumber(v);

                          if (key === "rtm") return [`${fmtRtm(num)} Rs/Unit`, `RTM (rolling avg, lag ${lagClamped}d)`];
                          if (key === "rtm_yoy") return [fmtPct(num), "RTM YoY %"];

                          if (key.endsWith("_yoy")) {
                            const base = key.replace(/_yoy$/, "");
                            return [fmtPct(num), `${base} YoY %`];
                          }

                          if (selectedStocks.includes(key)) {
                            return [fmtNum(num), mode === "price" ? `${key} (Price)` : `${key} (P/B)`];
                          }

                          return [v, String(name)];
                        }}
                        labelFormatter={(l: any) => `Date: ${l}`}
                      />

                      <Legend />

                      {showRtmControlLines && rtmControl ? (
                        <>
                          <ReferenceLine
                            yAxisId="left"
                            y={rtmControl.mean}
                            stroke="#000000"
                            strokeWidth={CONTROL_STROKE_WIDTH}
                            strokeDasharray={CONTROL_DASH}
                            ifOverflow="extendDomain"
                            label={{
                              value: `Mean (${fmtRtm(rtmControl.mean)})`,
                              position: "insideTopLeft",
                              fontSize: 11,
                              fill: "#000000"
                            }}
                          />
                          <ReferenceLine
                            yAxisId="left"
                            y={rtmControl.p1}
                            stroke="#f97316"
                            strokeWidth={CONTROL_STROKE_WIDTH}
                            strokeDasharray={CONTROL_DASH}
                            ifOverflow="extendDomain"
                            label={{
                              value: `+1σ (${fmtRtm(rtmControl.p1)})`,
                              position: "insideTopLeft",
                              fontSize: 11,
                              fill: "#f97316"
                            }}
                          />
                          <ReferenceLine
                            yAxisId="left"
                            y={rtmControl.p2}
                            stroke="#16a34a"
                            strokeWidth={CONTROL_STROKE_WIDTH}
                            strokeDasharray={CONTROL_DASH}
                            ifOverflow="extendDomain"
                            label={{
                              value: `+2σ (${fmtRtm(rtmControl.p2)})`,
                              position: "insideTopLeft",
                              fontSize: 11,
                              fill: "#16a34a"
                            }}
                          />
                          <ReferenceLine
                            yAxisId="left"
                            y={rtmControl.m1}
                            stroke="#b45309"
                            strokeWidth={CONTROL_STROKE_WIDTH}
                            strokeDasharray={CONTROL_DASH}
                            ifOverflow="extendDomain"
                            label={{
                              value: `-1σ (${fmtRtm(rtmControl.m1)})`,
                              position: "insideBottomLeft",
                              fontSize: 11,
                              fill: "#b45309"
                            }}
                          />
                          <ReferenceLine
                            yAxisId="left"
                            y={rtmControl.m2}
                            stroke="#7c3aed"
                            strokeWidth={CONTROL_STROKE_WIDTH}
                            strokeDasharray={CONTROL_DASH}
                            ifOverflow="extendDomain"
                            label={{
                              value: `-2σ (${fmtRtm(rtmControl.m2)})`,
                              position: "insideBottomLeft",
                              fontSize: 11,
                              fill: "#7c3aed"
                            }}
                          />
                        </>
                      ) : null}

                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="rtm"
                        name={`RTM (Rs/Unit)${lagClamped ? ` (lag ${lagClamped}d)` : ""}`}
                        dot={false}
                        strokeWidth={2}
                        stroke="#dc2626"
                        connectNulls
                      />

                      {selectedStocks.map((s, i) => (
                        <Line
                          key={s}
                          yAxisId="right"
                          type="monotone"
                          dataKey={s}
                          name={mode === "price" ? `${s} (Price)` : `${s} (P/B)`}
                          dot={false}
                          strokeWidth={2}
                          stroke={getStockColor(i)}
                          connectNulls
                        />
                      ))}

                      {showYoY ? (
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="rtm_yoy"
                          name="RTM YoY %"
                          dot={false}
                          strokeWidth={2}
                          stroke="#16a34a"
                          connectNulls
                        />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 text-[11px] text-slate-500">
                  Stocks are computed on chart date range ending at{" "}
                  <span className="font-semibold">{range.toIso ? formatDDMMYYYY(range.toIso) : "—"}</span>. RTM is computed
                  using a lagged anchor (To − {lagClamped}d) ending at{" "}
                  <span className="font-semibold">{rtmAnchor ? formatDDMMYYYY(rtmAnchor) : "—"}</span>.
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
