import { useCallback, useEffect, useState } from "react";

type Range = "5m" | "15m" | "1h" | "24h";
type TrafficPoint = { at: number; allowedPerSecond: number; rejectedPerSecond: number };
type RequestLatencyPoint = { at: number; averageMs: number | null; p95Ms: number | null };
type StoreLatencyPoint = { at: number; averageStoreMs: number | null; p95StoreMs: number | null; storeErrorsPerSecond: number };
type Analytics = { range: Range; capturedAt: string; traffic: TrafficPoint[]; requestLatency: RequestLatencyPoint[]; storeLatency: StoreLatencyPoint[]; httpStatuses: { status: number; requests: number }[] };

const ranges: Range[] = ["5m", "15m", "1h", "24h"];
const analyticsEndpoints = ["/api/api1/dashboard/analytics", "/api/api2/dashboard/analytics"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAnalytics(value: unknown, range: Range): value is Analytics {
  return isRecord(value)
    && value.range === range
    && typeof value.capturedAt === "string"
    && Array.isArray(value.traffic)
    && value.traffic.every((point) => isRecord(point) && finite(point.at) && finite(point.allowedPerSecond) && finite(point.rejectedPerSecond))
    && Array.isArray(value.requestLatency)
    && value.requestLatency.every((point) => isRecord(point) && finite(point.at)
      && (point.averageMs === null || finite(point.averageMs))
      && (point.p95Ms === null || finite(point.p95Ms)))
    && Array.isArray(value.storeLatency)
    && value.storeLatency.every((point) => isRecord(point) && finite(point.at)
      && (point.averageStoreMs === null || finite(point.averageStoreMs))
      && (point.p95StoreMs === null || finite(point.p95StoreMs))
      && finite(point.storeErrorsPerSecond))
    && Array.isArray(value.httpStatuses)
    && value.httpStatuses.every((point) => isRecord(point) && finite(point.status) && finite(point.requests));
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} / sec`;
}

function formatLatency(value: number | null) {
  if (value === null) return "—";
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

function linePath(values: number[], width: number, height: number, maximum: number) {
  if (values.length < 2) return "";
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - (value / maximum) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function displayTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AnalyticsPage() {
  const [range, setRange] = useState<Range>("5m");
  const [data, setData] = useState<Analytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    let lastError = "Analytics data is unavailable.";
    for (const endpoint of analyticsEndpoints) {
      try {
        const response = await fetch(`${endpoint}?range=${range}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (response.ok && isAnalytics(payload, range)) {
          setData(payload);
          setUpdatedAt(new Date());
          setIsLoading(false);
          return;
        }
        lastError = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : `Analytics endpoint returned ${response.status}.`;
      } catch {
        lastError = "Could not reach the analytics endpoint.";
      }
    }
    setData(null);
    setError(`${lastError} Make sure Prometheus and at least one API instance are running.`);
    setIsLoading(false);
  }, [range]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const totalResponses = data?.httpStatuses.reduce((total, item) => total + item.requests, 0) ?? null;
  const lastTraffic = data?.traffic.at(-1);
  const currentRate = lastTraffic ? lastTraffic.allowedPerSecond + lastTraffic.rejectedPerSecond : null;
  const latestRequestLatency = [...(data?.requestLatency ?? [])].reverse().find((point) => point.averageMs !== null || point.p95Ms !== null);
  const latestStoreLatency = [...(data?.storeLatency ?? [])].reverse().find((point) => point.averageStoreMs !== null || point.p95StoreMs !== null);
  const statuses = data?.httpStatuses ?? [];
  const statusMax = Math.max(1, ...statuses.map((item) => item.requests));
  const displayData = data?.range === range ? data : null;

  return (
    <div className="overview-page analytics-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">METRICS & TRENDS</span>
          <h1>Analytics</h1>
          <p className="page-subtitle">Historical rate-limit and store measurements collected by Prometheus.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={() => void refresh()} disabled={isLoading}>
          <span className={isLoading ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="analytics-toolbar">
        <div className="range-picker" role="group" aria-label="Analytics time range">
          {ranges.map((item) => <button type="button" key={item} className={range === item ? "is-selected" : ""} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}
        </div>
        <span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · auto refresh 15s` : "Awaiting metrics"}</span>
      </div>

      {error && <div className="analytics-error" role="alert"><strong>Metrics unavailable</strong><span>{error}</span></div>}

      <section className="analytics-summary" aria-label="Analytics summary">
        <div><span>HTTP responses · {range}</span><strong>{displayData && totalResponses !== null ? formatCount(totalResponses) : "—"}</strong></div>
        <div><span>Current decision rate</span><strong>{displayData ? formatRate(currentRate ?? null) : "—"}</strong></div>
        <div><span>API response p95</span><strong>{displayData ? formatLatency(latestRequestLatency?.p95Ms ?? null) : "—"}</strong></div>
        <div><span>Store p95 latency</span><strong>{displayData ? formatLatency(latestStoreLatency?.p95StoreMs ?? null) : "—"}</strong></div>
      </section>

      <div className="analytics-grid">
        <section className="panel analytics-panel traffic-analytics-panel" aria-labelledby="analytics-traffic-title">
          <div className="panel-heading"><div><h2 id="analytics-traffic-title">Rate-limit decisions</h2><p>Allowed and rejected requests per second</p></div></div>
          {displayData && displayData.traffic.length > 1 ? <div className="analytics-chart-wrap">
            <div className="chart-legend"><span><i className="legend-allowed" />Allowed</span><span><i className="legend-rejected" />Rejected</span></div>
            <svg className="analytics-chart" viewBox="0 0 700 170" preserveAspectRatio="none" role="img" aria-label="Allowed and rejected decisions per second">
              {[0, 1, 2, 3].map((line) => <line className="chart-gridline" key={line} x1="0" x2="700" y1={15 + line * 43} y2={15 + line * 43} />)}
              <g transform="translate(3 17)">
                <path className="traffic-line traffic-line-allowed" d={linePath(displayData.traffic.map((point) => point.allowedPerSecond), 694, 128, Math.max(0.1, ...displayData.traffic.map((point) => Math.max(point.allowedPerSecond, point.rejectedPerSecond))))} />
                <path className="traffic-line traffic-line-rejected" d={linePath(displayData.traffic.map((point) => point.rejectedPerSecond), 694, 128, Math.max(0.1, ...displayData.traffic.map((point) => Math.max(point.allowedPerSecond, point.rejectedPerSecond))))} />
              </g>
            </svg>
            <div className="chart-time-labels"><span>{displayTime(displayData.traffic[0]!.at)}</span><span>{displayTime(displayData.traffic.at(-1)!.at)}</span></div>
          </div> : <div className="analytics-empty">{isLoading ? "Loading Prometheus samples…" : "No decision samples were collected in this range."}</div>}
        </section>

        <section className="panel analytics-panel latency-analytics-panel" aria-labelledby="analytics-latency-title">
          <div className="panel-heading"><div><h2 id="analytics-latency-title">API response latency</h2><p>Mean and p95 across application HTTP responses</p></div></div>
          {displayData && displayData.requestLatency.filter((point) => point.averageMs !== null || point.p95Ms !== null).length > 1 ? (() => {
            const points = displayData.requestLatency.filter((point) => point.averageMs !== null || point.p95Ms !== null);
            const max = Math.max(0.1, ...points.flatMap((point) => [point.averageMs ?? 0, point.p95Ms ?? 0]));
            return <div className="analytics-chart-wrap">
              <div className="chart-legend"><span><i className="legend-allowed" />Mean</span><span><i className="legend-latency-p95" />p95</span></div>
              <svg className="analytics-chart" viewBox="0 0 700 170" preserveAspectRatio="none" role="img" aria-label="Mean and p95 API response latency">
                {[0, 1, 2, 3].map((line) => <line className="chart-gridline" key={line} x1="0" x2="700" y1={15 + line * 43} y2={15 + line * 43} />)}
                <g transform="translate(3 17)">
                  <path className="traffic-line traffic-line-allowed" d={linePath(points.map((point) => point.averageMs ?? 0), 694, 128, max)} />
                  <path className="traffic-line traffic-line-p95" d={linePath(points.map((point) => point.p95Ms ?? 0), 694, 128, max)} />
                </g>
              </svg>
              <div className="chart-time-labels"><span>{displayTime(points[0]!.at)}</span><span>{displayTime(points.at(-1)!.at)}</span></div>
            </div>;
          })() : <div className="analytics-empty">{isLoading ? "Loading Prometheus samples…" : "No API latency samples were collected in this range."}</div>}
        </section>

        <section className="panel analytics-panel latency-analytics-panel" aria-labelledby="analytics-store-title">
          <div className="panel-heading"><div><h2 id="analytics-store-title">Rate-limit store latency</h2><p>Mean and p95 from the aggregated Redis store histogram</p></div></div>
          {displayData && displayData.storeLatency.filter((point) => point.averageStoreMs !== null || point.p95StoreMs !== null).length > 1 ? (() => {
            const points = displayData.storeLatency.filter((point) => point.averageStoreMs !== null || point.p95StoreMs !== null);
            const max = Math.max(0.1, ...points.flatMap((point) => [point.averageStoreMs ?? 0, point.p95StoreMs ?? 0]));
            return <div className="analytics-chart-wrap">
              <div className="chart-legend"><span><i className="legend-allowed" />Mean</span><span><i className="legend-latency-p95" />p95</span></div>
              <svg className="analytics-chart" viewBox="0 0 700 170" preserveAspectRatio="none" role="img" aria-label="Mean and p95 Redis store latency">
                {[0, 1, 2, 3].map((line) => <line className="chart-gridline" key={line} x1="0" x2="700" y1={15 + line * 43} y2={15 + line * 43} />)}
                <g transform="translate(3 17)">
                  <path className="traffic-line traffic-line-allowed" d={linePath(points.map((point) => point.averageStoreMs ?? 0), 694, 128, max)} />
                  <path className="traffic-line traffic-line-p95" d={linePath(points.map((point) => point.p95StoreMs ?? 0), 694, 128, max)} />
                </g>
              </svg>
              <div className="chart-time-labels"><span>{displayTime(points[0]!.at)}</span><span>{displayTime(points.at(-1)!.at)}</span></div>
            </div>;
          })() : <div className="analytics-empty">{isLoading ? "Loading Prometheus samples…" : "No store latency samples were collected in this range."}</div>}
        </section>
      </div>

      <section className="panel analytics-panel status-distribution-panel" aria-labelledby="status-distribution-title">
        <div className="panel-heading"><div><h2 id="status-distribution-title">HTTP status distribution</h2><p>Application responses over the selected period</p></div></div>
        {displayData && statuses.length > 0 ? <div className="status-distribution-list">
          {statuses.map(({ status, requests }) => <div className="status-distribution-row" key={status}>
            <span className={`status-code status-code-${Math.floor(status / 100)}xx`}>{status}</span>
            <div className="status-bar-track"><span className={`status-bar status-bar-${Math.floor(status / 100)}xx`} style={{ width: `${(requests / statusMax) * 100}%` }} /></div>
            <strong>{formatCount(requests)}</strong>
          </div>)}
        </div> : <div className="analytics-empty">{isLoading ? "Loading Prometheus samples…" : "HTTP status metrics are not available for this period yet."}</div>}
      </section>

      <p className="analytics-footnote">Historical charts require Prometheus to be running and scraping the APIs. Rate-limit, API latency, and store measurements are aggregated across the reporting instances.</p>
    </div>
  );
}

export default AnalyticsPage;
