import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type Mode = "price" | "ptb";
type WindowDays = 7 | 14 | 30 | 45;

function parseISOKey(s: string) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : s;
}

// Accepts DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, DD-MM-YY, ISO YYYY-MM-DD
function parseInputDate(s: unknown) {
  if (typeof s !== "string") return null;
  const t = s.trim();

  let m: RegExpMatchArray | null;

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime())) return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = 2000 + Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime())) return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime())) return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = 2000 + Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime())) return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
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

function formatDDMMYYYY(iso: string) {
  if (!iso || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return null;
  return n * 100;
}

function growthPct(curr: number, prev: number) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

/** Minimal CSV parse:
 * - Reads header
 * - Uses valueColumnKey to locate the value column
 * - date in col0
 */
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
    dates: string[]; // ISO sorted
    cols: string[];  // stock names
    values: Map<string, Map<string, number>>; // stock -> (date -> val)
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

/** XLSX loader:
 * - Sheet 1 => Prices
 * - Sheet 2 => PriceToBook
 * - Each sheet: rows = dates, columns = stocks (first row header)
 */
async function loadStockXlsx(url: string): Promise<StockSheets> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stock file HTTP ${res.status}`);

  const buf = await res.arrayBuffer();
  const XLSX = await import("xlsx");

  const wb = XLSX.read(buf, { type: "array" });
  const sheetNames = wb.SheetNames || [];

  const s1 = sheetNames[0];
  const s2 = sheetNames[1];

  const out = buildEmptySheets();

  function parseSheet(sheetName: string | undefined) {
    if (!sheetName) return { dates: [] as string[], cols: [] as string[], values: new Map<string, Map<string, number>>(), latestDate: null as string | null };

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

  const p = parseSheet(s1);
  const b = parseSheet(s2);

  out.prices = p;
  out.ptb = b;

  return out;
}

/** Rolling average for STOCKS:
 * - Uses last N available dates <= anchor that have values (skips holidays/weekends)
 */
function rollingAvgStocks(series: Map<string, number>, anchor: string, n: number) {
  const dates = Array.from(series.keys()).filter((d) => d <= anchor).sort();
  if (!dates.length) return null;

  const last = dates.slice(Math.max(0, dates.length - n));
  if (!last.length) return null;

  const vals = last.map((d) => series.get(d)!).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg;
}

/** Rolling average for RTM:
 * - Calendar days window ending at anchor
 * - Uses actual RTM values on those dates
 */
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

export default function RTMVsStocksDailyCard(props: {
  rtmCsvUrl: string;
  stockFileUrl: string;
  rtmValueColumnKey: string;
}) {
  const { rtmCsvUrl, stockFileUrl, rtmValueColumnKey } = props;

  const [rtmMap, setRtmMap] = useState<Map<string, number>>(new Map());
  const [stockSheets, setStockSheets] = useState<StockSheets>(buildEmptySheets());
  const [mode, setMode] = useState<Mode>("price");
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [showYoY, setShowYoY] = useState(true);

  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Load RTM CSV
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

        // Default selected stock(s): first 2 (if available)
        const cols = stocks.prices.cols.length ? stocks.prices.cols : stocks.ptb.cols;
        setSelectedStocks(cols.slice(0, Math.min(2, cols.length)));

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

  // Anchor/end date = latest available date from ACTIVE stock sheet
  const anchorDate = activeSheet.latestDate;

  // Build chart points: show a small trailing range (last 180 calendar days) ending at anchor
  const chartData = useMemo(() => {
    if (!anchorDate) return [];
    if (!rtmMap.size) return [];

    const points: any[] = [];
    const showDays = 180;
    const start = isoMinusDays(anchorDate, showDays - 1);

    let cur = start;
    while (cur <= anchorDate) {
      const rtm = rollingAvgRtm(rtmMap, cur, windowDays);

      const row: any = {
        label: formatDDMMYYYY(cur),
        __iso: cur,
        rtm
      };

      // Stocks: last N available trading days ending on cur
      for (const s of selectedStocks) {
        const series = activeSheet.values.get(s);
        if (!series) continue;
        row[s] = rollingAvgStocks(series, cur, windowDays);
      }

      // YoY (each series compared to anchor shifted by 365 days)
      if (showYoY) {
        const py = isoMinusDays(cur, 365);

        const rtmPY = rollingAvgRtm(rtmMap, py, windowDays);
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
  }, [anchorDate, rtmMap, activeSheet, selectedStocks, windowDays, showYoY]);

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
                {/* Controls (kept compact, same Tailwind style family as existing UI) */}
                <div className="mb-3 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="flex-1">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={showYoY}
                            onChange={(e) => setShowYoY(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="font-medium">Show YoY %</span>
                        </label>

                        <div className="text-xs text-slate-500">
                          Stock rolling uses last {windowDays} available trading days. RTM rolling uses calendar days.
                        </div>
                      </div>
                    </div>

                    {/* Stock multi-select */}
                    <div className="lg:w-[360px] lg:shrink-0">
                      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                        <div className="text-xs font-semibold text-slate-700">Stocks</div>
                        <div className="mt-2 max-h-[160px] overflow-auto rounded-xl ring-1 ring-slate-200 bg-white">
                          {stockUniverse.length ? (
                            <div className="p-2 grid grid-cols-1 gap-2 text-[12px] text-slate-700">
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
                            onClick={() => setSelectedStocks(stockUniverse.slice(0, Math.min(2, stockUniverse.length)))}
                            className="rounded-lg bg-slate-900 px-2 py-1 text-[12px] font-semibold text-white hover:bg-slate-800"
                          >
                            Pick top 2
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedStocks(stockUniverse.slice(0, Math.min(5, stockUniverse.length)))}
                            className="rounded-lg bg-white px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                          >
                            Pick top 5
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

                {/* Chart */}
                <div className="h-[380px] sm:h-[460px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 12, right: 42, bottom: 12, left: 42 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={24} />

                      {/* Left axis: RTM Rs/Unit */}
                      <YAxis
                        yAxisId="left"
                        width={92}
                        tickMargin={10}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => fmtRtm(asFiniteNumber(v))}
                      />

                      {/* Right axis: stocks (price or P/B) */}
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        width={92}
                        tickMargin={10}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => fmtNum(asFiniteNumber(v))}
                      />

                      <Tooltip
                        wrapperStyle={{ outline: "none" }}
                        formatter={(v: any, name: any, item: any) => {
                          const key = (item && (item.dataKey as string)) || (name as string);

                          const num = asFiniteNumber(v);

                          if (key === "rtm") return [`${fmtRtm(num)} Rs/Unit`, "RTM (rolling avg)"];
                          if (key === "rtm_yoy") return [fmtPct(num), "RTM YoY %"];

                          if (key.endsWith("_yoy")) {
                            const base = key.replace(/_yoy$/, "");
                            return [fmtPct(num), `${base} YoY %`];
                          }

                          // Stock series
                          if (selectedStocks.includes(key)) {
                            return [fmtNum(num), mode === "price" ? `${key} (Price)` : `${key} (P/B)`];
                          }

                          return [v, String(name)];
                        }}
                        labelFormatter={(l: any) => `Label: ${l}`}
                      />

                      <Legend />

                      {/* RTM line */}
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="rtm"
                        name="RTM (Rs/Unit)"
                        dot={false}
                        strokeWidth={2}
                        stroke="#dc2626"
                        connectNulls
                      />

                      {/* Stock lines */}
                      {selectedStocks.map((s) => (
                        <Line
                          key={s}
                          yAxisId="right"
                          type="monotone"
                          dataKey={s}
                          name={mode === "price" ? `${s} (Price)` : `${s} (P/B)`}
                          dot={false}
                          strokeWidth={2}
                          stroke="#2563eb"
                          connectNulls
                        />
                      ))}

                      {/* YoY lines (optional) */}
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
                  Anchor date is the latest date available in the selected stock sheet. Stocks skip non-trading days automatically; RTM uses calendar days.
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
