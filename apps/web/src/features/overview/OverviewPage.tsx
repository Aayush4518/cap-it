import { useCallback, useEffect, useState } from "react";

type RedisStatus = "connected" | "disconnected" | "unknown";
type DashboardSummary = {
  capturedAt: string;
  instance: { id: string };
  redisStatus: RedisStatus;
  policy: { id: string; capacity: number; refillRatePerSecond: number };
  requests: { total: number; allowed: number; rejected: number };
  store: {
    count: number;
    durationTotalMs: number;
    averageMs: number | null;
    p95Ms: number | null;
    p95Buckets: { upperBoundMs: number; cumulativeCount: number }[];
    errors: number;
  };
};

type InstanceView = {
  key: string;
  label: string;
  port: string;
  state: "checking" | "online" | "offline" | "unavailable";
  summary: DashboardSummary | null;
};

type TrendPoint = {
  at: number;
  allowed: number;
  rejected: number;
  averageStoreMs: number | null;
};

type OverviewAnalytics = {
  range: string;
  traffic: { at: number; allowedPerSecond: number; rejectedPerSecond: number }[];
  storeLatency: { at: number; averageStoreMs: number | null }[];
};

type MetricIconName = "requests" | "allowed" | "rejected" | "rate" | "average" | "p95";

function MetricIcon({ name }: { name: MetricIconName }) {
  const common = {
    width: 19,
    height: 19,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "requests":
      return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></svg>;
    case "allowed":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></svg>;
    case "rejected":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>;
    case "rate":
      return <svg {...common}><path d="M3 12h4l2.5-6 4.5 12 2.5-6H21" /></svg>;
    case "average":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "p95":
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
  }
}

const instanceEndpoints = [
  { key: "api1", label: "API instance 1", port: ":3000", endpoint: "/api/api1/dashboard/overview" },
  { key: "api2", label: "API instance 2", port: ":3002", endpoint: "/api/api2/dashboard/overview" },
] as const;

const timeRanges = [
  { label: "5m", duration: 5 * 60_000 },
  { label: "15m", duration: 15 * 60_000 },
  { label: "1h", duration: 60 * 60_000 },
  { label: "24h", duration: 24 * 60 * 60_000 },
] as const;

const initialInstances: InstanceView[] = instanceEndpoints.map((instance) => ({
  key: instance.key,
  label: instance.label,
  port: instance.port,
  state: "checking",
  summary: null,
}));

const analyticsEndpoints = ["/api/api1/dashboard/analytics", "/api/api2/dashboard/analytics"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDashboardSummary(value: unknown): value is DashboardSummary {
  if (!isRecord(value) || !isRecord(value.instance) || !isRecord(value.policy) || !isRecord(value.requests) || !isRecord(value.store)) return false;
  const store = value.store;
  return typeof value.capturedAt === "string"
    && typeof value.instance.id === "string"
    && (value.redisStatus === "connected" || value.redisStatus === "disconnected" || value.redisStatus === "unknown")
    && typeof value.policy.id === "string"
    && isFiniteNumber(value.policy.capacity)
    && isFiniteNumber(value.policy.refillRatePerSecond)
    && isFiniteNumber(value.requests.total)
    && isFiniteNumber(value.requests.allowed)
    && isFiniteNumber(value.requests.rejected)
    && isFiniteNumber(store.count)
    && isFiniteNumber(store.durationTotalMs)
    && (store.averageMs === null || isFiniteNumber(store.averageMs))
    && (store.p95Ms === null || isFiniteNumber(store.p95Ms))
    && Array.isArray(store.p95Buckets)
    && store.p95Buckets.every((bucket) => isRecord(bucket) && isFiniteNumber(bucket.upperBoundMs) && isFiniteNumber(bucket.cumulativeCount))
    && isFiniteNumber(store.errors);
}

function aggregateP95(summaries: DashboardSummary[]) {
  const firstBuckets = summaries[0]?.store.p95Buckets;
  if (!firstBuckets?.length) return null;
  const count = summaries.reduce((total, summary) => total + summary.store.count, 0);
  if (count === 0) return null;
  const target = count * 0.95;
  let lowerBound = 0;
  let lowerCount = 0;
  for (let index = 0; index < firstBuckets.length; index += 1) {
    const bucket = firstBuckets[index]!;
    const cumulativeCount = summaries.reduce((total, summary) => total + (summary.store.p95Buckets[index]?.cumulativeCount ?? 0), 0);
    if (cumulativeCount >= target) {
      const countInBucket = cumulativeCount - lowerCount;
      const fraction = countInBucket === 0 ? 1 : (target - lowerCount) / countInBucket;
      return lowerBound + (bucket.upperBoundMs - lowerBound) * fraction;
    }
    lowerBound = bucket.upperBoundMs;
    lowerCount = cumulativeCount;
  }
  return null;
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
}

function formatLatency(value: number | null) {
  if (value === null) return "—";
  if (value < 0.1) return `${value.toFixed(2)} ms`;
  return `${value.toFixed(1)} ms`;
}

function formatAxisValue(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function isOverviewAnalytics(value: unknown, range: string): value is OverviewAnalytics {
  return isRecord(value)
    && value.range === range
    && Array.isArray(value.traffic)
    && value.traffic.every((point) => isRecord(point)
      && isFiniteNumber(point.at)
      && isFiniteNumber(point.allowedPerSecond)
      && isFiniteNumber(point.rejectedPerSecond))
    && Array.isArray(value.storeLatency)
    && value.storeLatency.every((point) => isRecord(point)
      && isFiniteNumber(point.at)
      && (point.averageStoreMs === null || isFiniteNumber(point.averageStoreMs)));
}

async function fetchTrend(range: string): Promise<TrendPoint[] | null> {
  for (const endpoint of analyticsEndpoints) {
    try {
      const response = await fetch(`${endpoint}?range=${range}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isOverviewAnalytics(payload, range)) continue;

      const traffic = new Map(payload.traffic.map((point) => [point.at, point]));
      const storeLatency = new Map(payload.storeLatency.map((point) => [point.at, point.averageStoreMs]));
      const timestamps = [...new Set([...traffic.keys(), ...storeLatency.keys()])].sort((left, right) => left - right);
      return timestamps.map((at) => {
        const trafficPoint = traffic.get(at);
        return {
          at,
          allowed: trafficPoint?.allowedPerSecond ?? 0,
          rejected: trafficPoint?.rejectedPerSecond ?? 0,
          averageStoreMs: storeLatency.get(at) ?? null,
        };
      });
    } catch {
      // Try the second API instance, which reads the same Prometheus history.
    }
  }
  return null;
}

function toLine(values: number[], width: number, height: number, maximum: number) {
  if (values.length < 2) return "";
  const step = width / (values.length - 1);
  const points = values.map((value, index) => ({
    x: index * step,
    y: height - (value / maximum) * height,
  }));
  const slopes = points.slice(0, -1).map((point, index) => points[index + 1]!.y - point.y);
  const tangents = Array(points.length).fill(0) as number[];
  tangents[0] = slopes[0]!;
  tangents[tangents.length - 1] = slopes[slopes.length - 1]!;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = slopes[index - 1]!;
    const next = slopes[index]!;
    // Zero the tangent at a peak or valley to keep the curve from overshooting samples.
    tangents[index] = previous * next <= 0 ? 0 : (2 * previous * next) / (previous + next);
  }

  let path = `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    path += ` C${(start.x + step / 3).toFixed(1)},${(start.y + tangents[index]! / 3).toFixed(1)}`;
    path += ` ${(end.x - step / 3).toFixed(1)},${(end.y - tangents[index + 1]! / 3).toFixed(1)}`;
    path += ` ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
  }
  return path;
}

function toArea(values: number[], width: number, height: number, maximum: number) {
  const line = toLine(values, width, height, maximum);
  return line ? `${line} L${width},${height} L0,${height} Z` : "";
}

function TrafficChart({ samples }: { samples: TrendPoint[] }) {
  if (samples.length < 2 || samples.every((sample) => sample.allowed + sample.rejected === 0)) {
    return (
      <div className="chart-empty-state">
        <strong>{samples.length < 2 ? "Collecting request samples" : "No rate-limit decisions in this period"}</strong>
        <p>Traffic history comes from Prometheus and includes requests sent from other tabs.</p>
      </div>
    );
  }

  const plotSamples = samples.length > 120
    ? Array.from({ length: 120 }, (_, index) => samples[Math.round(index * (samples.length - 1) / 119)]!)
    : samples;
  const maximum = Math.max(1, ...plotSamples.map((sample) => Math.max(sample.allowed, sample.rejected)));
  const allowedPath = toLine(plotSamples.map((sample) => sample.allowed), 640, 118, maximum);
  const rejectedPath = toLine(plotSamples.map((sample) => sample.rejected), 640, 118, maximum);
  const start = new Date(plotSamples[0]!.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const end = new Date(plotSamples.at(-1)!.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="traffic-chart">
      <div className="chart-legend"><span><i className="legend-allowed" />Allowed</span><span><i className="legend-rejected" />Rejected</span></div>
      <svg viewBox="0 0 700 158" preserveAspectRatio="none" role="img" aria-label="Allowed and rejected rate-limit decisions over time">
        <defs>
          <linearGradient id="traffic-allowed-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop className="area-stop-green" offset="0%" stopOpacity="0.25" />
            <stop className="area-stop-green" offset="100%" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="traffic-rejected-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop className="area-stop-rejected" offset="0%" stopOpacity="0.24" />
            <stop className="area-stop-rejected" offset="100%" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = 14 + line * (118 / 3);
          return <g key={line}>
            <line className="chart-gridline" x1="42" x2="690" y1={y} y2={y} />
            <text className="chart-axis-label" x="36" y={y + 3} textAnchor="end" aria-hidden="true">{formatAxisValue(maximum * (1 - line / 3))}</text>
          </g>;
        })}
        <g transform="translate(46 14)">
          <path className="traffic-area" d={toArea(plotSamples.map((sample) => sample.allowed), 640, 118, maximum)} fill="url(#traffic-allowed-gradient)" />
          <path className="traffic-area" d={toArea(plotSamples.map((sample) => sample.rejected), 640, 118, maximum)} fill="url(#traffic-rejected-gradient)" />
          <path className="traffic-line traffic-line-allowed" d={allowedPath} />
          <path className="traffic-line traffic-line-rejected" d={rejectedPath} />
        </g>
      </svg>
      <div className="chart-time-labels"><span>{start}</span><span>Now</span><span>{end}</span></div>
    </div>
  );
}

function LatencyChart({ samples }: { samples: TrendPoint[] }) {
  const latencySamples = samples.filter((sample) => sample.averageStoreMs !== null);
  if (latencySamples.length < 2) {
    return (
      <div className="chart-empty-state compact-empty-state">
        <strong>{latencySamples.length === 0 ? "Waiting for store operations" : "Collecting latency samples"}</strong>
        <p>Interval average latency appears after new requests reach the rate limiter.</p>
      </div>
    );
  }

  const plotSamples = latencySamples.length > 80
    ? Array.from({ length: 80 }, (_, index) => latencySamples[Math.round(index * (latencySamples.length - 1) / 79)]!)
    : latencySamples;
  const values = plotSamples.map((sample) => sample.averageStoreMs ?? 0);
  const maximum = Math.max(0.1, ...values);
  const path = toLine(values, 260, 100, maximum);

  return (
    <div className="latency-chart">
      <svg viewBox="0 0 320 118" preserveAspectRatio="none" role="img" aria-label="Average rate-limit store latency over time">
        <defs>
          <linearGradient id="latency-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop className="area-stop-green" offset="0%" stopOpacity="0.24" />
            <stop className="area-stop-green" offset="100%" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((line) => {
          const y = 9 + line * 50;
          return <g key={line}>
            <line className="chart-gridline" x1="45" x2="312" y1={y} y2={y} />
            <text className="chart-axis-label" x="39" y={y + 3} textAnchor="end" aria-hidden="true">{line === 2 ? "0" : formatLatency(maximum * (1 - line / 2))}</text>
          </g>;
        })}
        <g transform="translate(48 9)">
          <path className="latency-area" d={toArea(values, 260, 100, maximum)} fill="url(#latency-gradient)" />
          <path className="traffic-line traffic-line-latency" d={path} />
        </g>
      </svg>
      <div className="chart-time-labels"><span>{new Date(plotSamples[0]!.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>Now</span></div>
    </div>
  );
}

function OverviewPage() {
  const [instances, setInstances] = useState(initialInstances);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [requestsPerSecond, setRequestsPerSecond] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<(typeof timeRanges)[number]["label"]>("5m");
  const [samples, setSamples] = useState<TrendPoint[]>([]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const [results, trend] = await Promise.all([
      Promise.all(instanceEndpoints.map(async (endpoint, index): Promise<InstanceView> => {
        try {
          const response = await fetch(endpoint.endpoint, { cache: "no-store" });
          if (!response.ok) return { ...initialInstances[index]!, state: "unavailable", summary: null };
          const body: unknown = await response.json();
          if (!isDashboardSummary(body)) return { ...initialInstances[index]!, state: "unavailable", summary: null };
          return { key: endpoint.key, label: endpoint.label, port: endpoint.port, state: "online", summary: body };
        } catch {
          return { ...initialInstances[index]!, state: "offline", summary: null };
        }
      })),
      fetchTrend(selectedRange),
    ]);

    const now = Date.now();
    setSamples(trend ?? []);
    const latestTrend = trend?.at(-1);
    setRequestsPerSecond(latestTrend ? latestTrend.allowed + latestTrend.rejected : null);

    setInstances(results);
    setLastChecked(new Date(now));
    setIsRefreshing(false);
  }, [selectedRange]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const rangeDuration = timeRanges.find((range) => range.label === selectedRange)!.duration;
  const selectedSamples = samples.filter((sample) => sample.at >= Date.now() - rangeDuration);
  const summaries = instances.flatMap((instance) => instance.summary ? [instance.summary] : []);
  const allInstancesOnline = summaries.length === instanceEndpoints.length;
  const sum = (selector: (summary: DashboardSummary) => number) => summaries.reduce((total, summary) => total + selector(summary), 0);
  const totalRequests = sum((summary) => summary.requests.total);
  const allowed = sum((summary) => summary.requests.allowed);
  const rejected = sum((summary) => summary.requests.rejected);
  const storeCount = sum((summary) => summary.store.count);
  const storeDuration = sum((summary) => summary.store.durationTotalMs);
  const averageStoreMs = storeCount > 0 ? storeDuration / storeCount : null;
  const p95StoreMs = aggregateP95(summaries);
  const storeErrors = sum((summary) => summary.store.errors);
  const policy = summaries[0]?.policy ?? null;
  const redisStatus: RedisStatus = !allInstancesOnline
    ? "unknown"
    : summaries.some((summary) => summary.redisStatus === "disconnected")
      ? "disconnected"
      : summaries.every((summary) => summary.redisStatus === "connected")
        ? "connected"
        : "unknown";
  const redisLabel = redisStatus === "connected" ? "Connected" : redisStatus === "disconnected" ? "Disconnected" : "Unknown";
  const liveLabel = allInstancesOnline
    ? redisStatus === "connected" ? "Live" : redisStatus === "disconnected" ? "Store offline" : "Checking"
    : summaries.length === 0 ? "Offline" : "Partial";
  const liveTone = liveLabel === "Live" ? "live" : liveLabel === "Offline" ? "offline" : "degraded";
  const metricNote = summaries.length === 0
    ? "Waiting for API data"
    : allInstancesOnline
      ? "Since API processes started"
      : `Partial data · ${summaries.length} of ${instanceEndpoints.length} instances reporting`;

  const metricCards: { label: string; value: string; tone: "neutral" | "green" | "orange"; icon: MetricIconName }[] = [
    { label: "Total requests", value: summaries.length ? formatCount(totalRequests) : "—", tone: "neutral", icon: "requests" },
    { label: "Allowed", value: summaries.length ? formatCount(allowed) : "—", tone: "green", icon: "allowed" },
    { label: "Rejected", value: summaries.length ? formatCount(rejected) : "—", tone: "orange", icon: "rejected" },
    { label: "Requests / sec", value: formatRate(requestsPerSecond), tone: "neutral", icon: "rate" },
    { label: "Avg. store latency", value: formatLatency(averageStoreMs), tone: "neutral", icon: "average" },
    { label: "p95 store latency", value: formatLatency(p95StoreMs), tone: "neutral", icon: "p95" },
  ];

  return (
    <div className="overview-page overview-dashboard">
      <div className="page-heading">
        <div>
          <span className="overview-eyebrow">System status</span>
          <h1>Overview</h1>
          <p className="page-subtitle">A live view of the rate limiter and its connected services.</p>
        </div>
        <div className="overview-heading-actions">
          <span className={`live-indicator live-indicator-${liveTone}`}><i />{liveLabel}</span>
          <button className="button-secondary refresh-button" type="button" onClick={() => void refresh()} disabled={isRefreshing}>
            <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
            {isRefreshing ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      <section className="metric-grid" aria-label="Rate-limit metrics">
        {metricCards.map(({ label, value, tone, icon }) => (
          <article className={`metric-panel metric-panel-${tone}`} key={label}>
            <MetricIcon name={icon} />
            <div className="metric-label">{label}</div>
            <div className={`metric-value tone-${tone}`}>{value}</div>
          </article>
        ))}
      </section>
      <div className="data-note" role="status">{metricNote}{lastChecked && <> · Updated {lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>}</div>

      <div className="overview-grid">
        <section className="panel chart-panel" aria-labelledby="traffic-title">
          <div className="panel-heading">
            <div>
              <h2 id="traffic-title">Request traffic</h2>
              <p>Allowed and rejected requests per second</p>
            </div>
            <div className="range-picker" aria-label="Traffic chart time range">
              {timeRanges.map(({ label }) => (
                <button className={selectedRange === label ? "is-selected" : ""} key={label} type="button" aria-pressed={selectedRange === label} onClick={() => setSelectedRange(label)}>{label}</button>
              ))}
            </div>
          </div>
          <TrafficChart samples={selectedSamples} />
        </section>

        <section className="panel chart-panel latency-panel" aria-labelledby="latency-title">
          <div className="panel-heading">
            <div>
              <h2 id="latency-title">Store latency</h2>
              <p>Recent average rate-limit store latency</p>
            </div>
            <span className="panel-period">Avg. {formatLatency(averageStoreMs)}</span>
          </div>
          <LatencyChart samples={selectedSamples} />
        </section>
      </div>

      <div className="overview-grid lower-grid">
        <section className="panel instances-panel" aria-labelledby="instances-title">
          <div className="panel-heading">
            <div>
              <h2 id="instances-title">API instances</h2>
              <p>Dashboard data refreshes every five seconds</p>
            </div>
            {lastChecked && <span className="last-checked">Updated {lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
          <div className="instance-list">
            {instances.map(({ key, label, port, state, summary }) => (
              <div className="instance-row" key={key}>
                <div className="instance-identity">
                  <span className="instance-symbol" aria-hidden="true">↗</span>
                  <div><strong>{label}</strong><span>{port} · {summary ? `${formatCount(summary.requests.total)} requests` : state === "checking" ? "Checking connection" : state === "unavailable" ? "Dashboard data unavailable" : "No response"}</span></div>
                </div>
                <span className={`health-pill health-${state}`}><span className="status-dot" />{state === "checking" ? "Checking" : state === "online" ? "Healthy" : state === "unavailable" ? "Unavailable" : "Offline"}</span>
              </div>
            ))}
            <div className="instance-row redis-row">
              <div className="instance-identity">
                <span className="instance-symbol redis-symbol" aria-hidden="true">R</span>
                <div><strong>Redis store</strong><span>Shared rate-limit store</span></div>
              </div>
              <span className={`health-pill health-${redisStatus === "connected" ? "online" : redisStatus === "disconnected" ? "offline" : "unknown"}`}><span className="status-dot" />{redisLabel}</span>
            </div>
          </div>
          {storeErrors > 0 && <p className="store-error-note">{formatCount(storeErrors)} store {storeErrors === 1 ? "error" : "errors"} since the API processes started.</p>}
        </section>

        <section className="panel policy-panel" aria-labelledby="policy-title">
          <div className="panel-heading">
            <div>
              <h2 id="policy-title">Active policy</h2>
              <p>Reported by the API</p>
            </div>
            {policy && <span className="policy-id">{policy.id}</span>}
          </div>
          {policy ? <div className="policy-values">
            <div><span>Bucket capacity</span><strong>{policy.capacity} <small>tokens</small></strong></div>
            <div><span>Refill rate</span><strong>{policy.refillRatePerSecond} <small>tokens / sec</small></strong></div>
          </div> : <div className="policy-empty">Policy details appear when an API instance is available.</div>}
          <div className="policy-footnote">p95 is combined across the available API instances.</div>
        </section>
      </div>
    </div>
  );
}

export default OverviewPage;
