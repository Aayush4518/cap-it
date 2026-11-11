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

type SampleBaseline = {
  total: number;
  allowed: number;
  rejected: number;
  durationTotalMs: number;
  storeCount: number;
};

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

const recentSamples: TrendPoint[] = [];

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

function changeSince(current: number, previous: number) {
  return current >= previous ? current - previous : current;
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

function sampleSeries(
  current: InstanceView[],
  previous: Map<string, SampleBaseline>,
): { baseline: Map<string, SampleBaseline>; allowed: number; rejected: number; averageStoreMs: number | null } {
  let allowed = 0;
  let rejected = 0;
  let durationDelta = 0;
  let storeCountDelta = 0;
  const baseline = new Map<string, SampleBaseline>();

  for (const instance of current) {
    const summary = instance.summary;
    if (!summary) continue;
    const currentValues = {
      total: summary.requests.total,
      allowed: summary.requests.allowed,
      rejected: summary.requests.rejected,
      durationTotalMs: summary.store.durationTotalMs,
      storeCount: summary.store.count,
    };
    const prior = previous.get(instance.key);
    if (prior) {
      allowed += changeSince(currentValues.allowed, prior.allowed);
      rejected += changeSince(currentValues.rejected, prior.rejected);
      durationDelta += changeSince(currentValues.durationTotalMs, prior.durationTotalMs);
      storeCountDelta += changeSince(currentValues.storeCount, prior.storeCount);
    }
    baseline.set(instance.key, currentValues);
  }

  return {
    baseline,
    allowed,
    rejected,
    averageStoreMs: storeCountDelta > 0 ? durationDelta / storeCountDelta : null,
  };
}

function toLine(values: number[], width: number, height: number, maximum: number) {
  if (values.length < 2) return "";
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - (value / maximum) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function TrafficChart({ samples }: { samples: TrendPoint[] }) {
  if (samples.length < 2 || samples.every((sample) => sample.allowed + sample.rejected === 0)) {
    return (
      <div className="chart-empty-state">
        <strong>{samples.length < 2 ? "Collecting request samples" : "No rate-limit decisions in this period"}</strong>
        <p>Traffic is sampled every five seconds while this dashboard is open.</p>
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
        {[0, 1, 2, 3].map((line) => {
          const y = 12 + line * 39;
          return <line className="chart-gridline" key={line} x1="42" x2="690" y1={y} y2={y} />;
        })}
        <g transform="translate(46 14)">
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
      <svg viewBox="0 0 280 118" preserveAspectRatio="none" role="img" aria-label="Average rate-limit store latency over time">
        {[0, 1, 2].map((line) => <line className="chart-gridline" key={line} x1="0" x2="280" y1={8 + line * 48} y2={8 + line * 48} />)}
        <g transform="translate(8 9)"><path className="traffic-line traffic-line-latency" d={path} /></g>
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
  const [samples, setSamples] = useState<TrendPoint[]>(recentSamples);
  const previous = useState(() => new Map<string, SampleBaseline>())[0];
  const previousAt = useState(() => ({ value: 0 }))[0];

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const results = await Promise.all(instanceEndpoints.map(async (endpoint, index): Promise<InstanceView> => {
      try {
        const response = await fetch(endpoint.endpoint, { cache: "no-store" });
        if (!response.ok) return { ...initialInstances[index]!, state: "unavailable", summary: null };
        const body: unknown = await response.json();
        if (!isDashboardSummary(body)) return { ...initialInstances[index]!, state: "unavailable", summary: null };
        return { key: endpoint.key, label: endpoint.label, port: endpoint.port, state: "online", summary: body };
      } catch {
        return { ...initialInstances[index]!, state: "offline", summary: null };
      }
    }));

    const now = Date.now();
    const complete = results.every((instance) => instance.summary !== null);
    const deltas = sampleSeries(results, previous);
    if (complete && previousAt.value > 0) {
      const elapsedSeconds = Math.max(1, (now - previousAt.value) / 1000);
      const rate = (deltas.allowed + deltas.rejected) / elapsedSeconds;
      setRequestsPerSecond(rate);
      const point: TrendPoint = {
        at: now,
        allowed: deltas.allowed,
        rejected: deltas.rejected,
        averageStoreMs: deltas.averageStoreMs,
      };
      recentSamples.push(point);
      const cutoff = now - 24 * 60 * 60_000;
      while (recentSamples.length > 0 && recentSamples[0]!.at < cutoff) recentSamples.shift();
      setSamples([...recentSamples]);
    } else if (!complete) {
      setRequestsPerSecond(null);
    }
    previous.clear();
    for (const [key, value] of deltas.baseline) previous.set(key, value);
    previousAt.value = complete ? now : 0;

    setInstances(results);
    setLastChecked(new Date(now));
    setIsRefreshing(false);
  }, [previous, previousAt]);

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
  const metricNote = summaries.length === 0
    ? "Waiting for API data"
    : allInstancesOnline
      ? "Since API processes started"
      : `Partial data · ${summaries.length} of ${instanceEndpoints.length} instances reporting`;

  const metricCards = [
    { label: "Total requests", value: summaries.length ? formatCount(totalRequests) : "—", tone: "neutral" },
    { label: "Allowed", value: summaries.length ? formatCount(allowed) : "—", tone: "green" },
    { label: "Rejected", value: summaries.length ? formatCount(rejected) : "—", tone: "orange" },
    { label: "Requests / sec", value: formatRate(requestsPerSecond), tone: "neutral" },
    { label: "Avg. store latency", value: formatLatency(averageStoreMs), tone: "neutral" },
    { label: "p95 store latency", value: formatLatency(p95StoreMs), tone: "neutral" },
  ];

  return (
    <div className="overview-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">SYSTEM STATUS</span>
          <h1>Overview</h1>
          <p className="page-subtitle">A live view of the rate limiter and its connected services.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={() => void refresh()} disabled={isRefreshing}>
          <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
          {isRefreshing ? "Checking…" : "Refresh"}
        </button>
      </div>

      <section className="metric-grid" aria-label="Rate-limit metrics">
        {metricCards.map(({ label, value, tone }) => (
          <article className="metric-panel" key={label}>
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
              <p>Rate-limit decisions per 5-second interval</p>
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
              <p>Recent rate-limit store operations</p>
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
