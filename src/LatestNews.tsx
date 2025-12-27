import React, { useEffect, useMemo, useState } from "react";

type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAtISO: string; // ISO string
  snippet: string;
};

const CACHE_KEY = "latestNews_cache_v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_FROM = "2021-01-01";

const POWER_TERMS = [
  "power",
  "electricity",
  "grid",
  "demand",
  "supply",
  "peak demand",
  "renewable",
  "solar",
  "wind",
  "coal",
  "plf",
  "transmission",
  "discom",
  "tariff",
  "energy",
];

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDDMMYYYY(isoOrDate: string) {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function clampText(s: string, max = 180) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

function isRelevant(item: NewsItem) {
  const hay = safeLower(`${item.title} ${item.snippet} ${item.source}`);
  const mentionsIndia = hay.includes("india") || hay.includes("indian");
  const mentionsPower = POWER_TERMS.some((t) => hay.includes(t));
  return mentionsIndia && mentionsPower;
}

function getEnvNewsApiKey(): string | null {
  // Supports different build setups without breaking compilation
  // - Vite: import.meta.env.VITE_NEWS_API_KEY or import.meta.env.NEWS_API_KEY
  // - CRA: process.env.REACT_APP_NEWS_API_KEY
  // - Next: process.env.NEXT_PUBLIC_NEWS_API_KEY
  try {
    const im: any = (import.meta as any);
    const key1 = im?.env?.NEWS_API_KEY;
    const key2 = im?.env?.VITE_NEWS_API_KEY;
    if (typeof key1 === "string" && key1.trim()) return key1.trim();
    if (typeof key2 === "string" && key2.trim()) return key2.trim();
  } catch {
    // ignore
  }

  try {
    // eslint-disable-next-line no-undef
    const p: any = typeof process !== "undefined" ? (process as any) : null;
    const k =
      p?.env?.NEWS_API_KEY ||
      p?.env?.REACT_APP_NEWS_API_KEY ||
      p?.env?.NEXT_PUBLIC_NEWS_API_KEY;
    if (typeof k === "string" && k.trim()) return k.trim();
  } catch {
    // ignore
  }

  return null;
}

function loadCache(): { ts: number; items: NewsItem[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.ts !== "number" || !Array.isArray(obj.items)) return null;
    return obj;
  } catch {
    return null;
  }
}

function saveCache(items: NewsItem[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
  } catch {
    // ignore
  }
}

async function fetchViaNewsAPI(fromISO: string, toISO: string): Promise<NewsItem[]> {
  const apiKey = getEnvNewsApiKey();
  if (!apiKey) throw new Error("NEWS_API_KEY missing");

  // Query using OR keywords + India emphasis
  const q = [
    `"India"`,
    `("power sector" OR electricity OR "power demand" OR "power supply" OR "peak demand" OR grid OR discom OR transmission OR "renewable energy")`,
  ].join(" AND ");

  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", q);
  url.searchParams.set("from", fromISO);
  url.searchParams.set("to", toISO);
  url.searchParams.set("language", "en");
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
  const json = await res.json();

  const articles = Array.isArray(json?.articles) ? json.articles : [];
  const items: NewsItem[] = articles
    .map((a: any, idx: number) => {
      const title = String(a?.title || "").trim();
      const url = String(a?.url || "").trim();
      const source = String(a?.source?.name || "Unknown").trim();
      const publishedAtISO = String(a?.publishedAt || "").trim();
      const snippet = String(a?.description || a?.content || "").trim();

      if (!title || !url || !publishedAtISO) return null;

      return {
        id: `newsapi_${publishedAtISO}_${idx}`,
        title,
        url,
        source,
        publishedAtISO,
        snippet: clampText(snippet, 200),
      } as NewsItem;
    })
    .filter(Boolean) as NewsItem[];

  return items;
}

async function fetchViaGoogleNewsRSS(): Promise<NewsItem[]> {
  // Google News RSS query
  // We fetch RSS through Jina AI proxy to avoid CORS issues in the browser.
  const rssUrl =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(
      `(India power sector OR India electricity OR India power demand OR India power supply OR India peak demand OR India renewable energy OR India grid)`
    ) +
    "&hl=en-IN&gl=IN&ceid=IN:en";

  const proxyUrl = `https://r.jina.ai/http://` + rssUrl.replace(/^https?:\/\//, "");

  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const text = await res.text();

  // Parse XML (RSS)
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");

  const entries = Array.from(xml.getElementsByTagName("item"));
  const items: NewsItem[] = entries
    .map((item, idx) => {
      const title = item.getElementsByTagName("title")[0]?.textContent?.trim() || "";
      const link = item.getElementsByTagName("link")[0]?.textContent?.trim() || "";
      const pubDate = item.getElementsByTagName("pubDate")[0]?.textContent?.trim() || "";
      const source = item.getElementsByTagName("source")[0]?.textContent?.trim() || "Google News";

      // Description is often HTML
      const descRaw = item.getElementsByTagName("description")[0]?.textContent || "";
      const desc = descRaw.replace(/<[^>]+>/g, "").trim();

      const publishedAtISO = pubDate ? new Date(pubDate).toISOString() : "";
      if (!title || !link || !publishedAtISO) return null;

      return {
        id: `rss_${publishedAtISO}_${idx}`,
        title,
        url: link,
        source,
        publishedAtISO,
        snippet: clampText(desc, 200),
      } as NewsItem;
    })
    .filter(Boolean) as NewsItem[];

  return items;
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

function ExternalIcon() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-600">
      ↗
    </span>
  );
}

export default function LatestNews() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filter controls
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(todayISODate());

  const effectiveFrom = from || DEFAULT_FROM;
  const effectiveTo = to || todayISODate();

  const filtered = useMemo(() => {
    const fromT = new Date(effectiveFrom + "T00:00:00Z").getTime();
    const toT = new Date(effectiveTo + "T23:59:59Z").getTime();

    return items
      .filter((x) => {
        const t = new Date(x.publishedAtISO).getTime();
        return Number.isFinite(t) && t >= fromT && t <= toT;
      })
      .sort((a, b) => (a.publishedAtISO < b.publishedAtISO ? 1 : -1));
  }, [items, effectiveFrom, effectiveTo]);

  async function loadNews(force = false) {
    setLoading(true);
    setErr(null);

    try {
      if (!force) {
        const cache = loadCache();
        if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
          setItems(cache.items);
          setLoading(false);
          return;
        }
      }

      const fromISO = DEFAULT_FROM;
      const toISO = todayISODate();

      let fetched: NewsItem[] = [];

      // Primary: NewsAPI
      try {
        fetched = await fetchViaNewsAPI(fromISO, toISO);
      } catch {
        // Fallback: RSS
        fetched = await fetchViaGoogleNewsRSS();
      }

      // Post-filter relevance
      const relevant = fetched.filter(isRelevant);

      // Limit 100 max (and ensure newest first)
      relevant.sort((a, b) => (a.publishedAtISO < b.publishedAtISO ? 1 : -1));
      const limited = relevant.slice(0, 100);

      setItems(limited);
      saveCache(limited);
    } catch {
      setErr("Unable to load news – please try again later");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Fetch fresh data on tab load (but cache 1 hr)
    loadNews(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-2xl font-semibold text-slate-900">Latest News</div>
            <div className="mt-1 text-sm text-slate-600">
              Real-time news and reports focused on the Indian power sector.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => loadNews(true)}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Filter card */}
        <div className="mt-6">
          <Card
            title="Filter"
            right={
              <button
                onClick={() => {
                  setFrom(DEFAULT_FROM);
                  setTo(todayISODate());
                }}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Reset
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
              <div>
                <div className="text-xs font-medium text-slate-600">Start date</div>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-600">End date</div>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div className="text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-900">{filtered.length}</span>{" "}
                articles
              </div>
            </div>
          </Card>
        </div>

        {/* Error */}
        {err ? (
          <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-rose-800 ring-1 ring-rose-200">
            <div className="font-semibold">{err}</div>
            <button
              onClick={() => loadNews(true)}
              className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        ) : null}

        {/* Content */}
        <div className="mt-6">
          {loading && !items.length ? (
            <div className="text-sm text-slate-600">Loading news…</div>
          ) : null}

          {!loading && !err && filtered.length === 0 ? (
            <div className="text-sm text-slate-600">No articles found for this range.</div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((a) => (
              <div
                key={a.id}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base font-semibold text-slate-900 hover:underline"
                  >
                    {a.title}
                  </a>
                  <a href={a.url} target="_blank" rel="noreferrer" title="Open">
                    <ExternalIcon />
                  </a>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span className="font-medium">{a.source}</span>
                  <span>•</span>
                  <span>{formatDDMMYYYY(a.publishedAtISO)}</span>
                </div>

                <div className="mt-3 text-sm text-slate-700">{a.snippet}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Note on caching (kept minimal, no UI restructure elsewhere) */}
        <div className="mt-6 text-xs text-slate-500">
          Cached for up to 1 hour to reduce API calls. Refresh to fetch latest.
        </div>
      </div>
    </div>
  );
}
