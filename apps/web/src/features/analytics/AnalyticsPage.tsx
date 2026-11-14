import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../shared/api";

type Range = "5m" | "15m" | "1h" | "24h";
type TrafficPoint = { at: number; allowedPerSecond: number; rejectedPerSecond: number };
type RequestLatencyPoint = { at: number; averageMs: number | null; p95Ms: number | null };
type StoreLatencyPoint = { at: number; averageStoreMs: number | null; p95StoreMs: number | null; storeErrorsPerSecond: number };
type Analytics = { range: Range; capturedAt: string; traffic: TrafficPoint[]; requestLatency: RequestLatencyPoint[]; storeLatency: StoreLatencyPoint[]; httpStatuses: { status: number; requests: number }[] };

const ranges: Range[] = ["5m", "15m", "1h", "24h"];
const analyticsEndpoints = [apiUrl("api1", "/dashboard/analytics"), apiUrl("api2", "/dashboard/analytics")];

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

function formatLatencyTick(value: number) {
  if (value === 0) return "0";
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ms`;
}

function formatAxisNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function linePath(values: number[], width: number, height: number, maximum: number) {
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

function areaPath(values: number[], width: number, height: number, maximum: number) {
  const line = linePath(values, width, height, maximum);
  return line ? `${line} L${width},${height} L0,${height} Z` : "";
}

function ChartYAxis({ maximum, formatValue }: { maximum: number; formatValue: (value: number) => string }) {
  return [0, 1, 2, 3].map((line) => {
    const y = 17 + line * (128 / 3);
    return <g key={line}>
      <line className="chart-gridline" x1="50" x2="700" y1={y} y2={y} />
      <text className="chart-axis-label" x="44" y={y + 3} textAnchor="end" aria-hidden="true">{formatValue(maximum * (1 - line / 3))}</text>
    </g>;
  });
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
          {displayData && displayData.traffic.length > 1 ? (() => {
            const points = displayData.traffic;
            const allowedValues = points.map((point) => point.allowedPerSecond);
            const rejectedValues = points.map((point) => point.rejectedPerSecond);
            const maximum = Math.max(0.1, ...points.map((point) => Math.max(point.allowedPerSecond, point.rejectedPerSecond)));
            return <div className="analytics-chart-wrap">
              <div className="chart-legend"><span><i className="legend-allowed" />Allowed</span><span><i className="legend-rejected" />Rejected</span></div>
              <svg className="analytics-chart" viewBox="0 0 700 170" preserveAspectRatio="none" role="img" aria-label="Allowed and rejected decisions per second">
                <defs>
                  <linearGradient id="analytics-traffic-allowed" x1="0" y1="0" x2="0" y2="1"><stop className="analytics-stop-green" offset="0%" stopOpacity="0.25" /><stop className="analytics-stop-green" offset="100%" stopOpacity="0" /></linearGradient>
                  <linearGradient id="analytics-traffic-rejected" x1="0" y1="0" x2="0" y2="1"><stop className="analytics-stop-rejected" offset="0%" stopOpacity="0.24" /><stop className="analytics-stop-rejected" offset="100%" stopOpacity="0" /></linearGradient>
                </defs>
                <ChartYAxis maximum={maximum} formatValue={formatAxisNumber} />
                <g transform="translate(52 17)">
                  <path className="analytics-area" d={areaPath(allowedValues, 644, 128, maximum)} fill="url(#analytics-traffic-allowed)" />
                  <path className="analytics-area" d={areaPath(rejectedValues, 644, 128, maximum)} fill="url(#analytics-traffic-rejected)" />
                  <path className="traffic-line traffic-line-allowed" d={linePath(allowedValues, 644, 128, maximum)} />
                  <path className="traffic-line traffic-line-rejected" d={linePath(rejectedValues, 644, 128, maximum)} />
                </g>
              </svg>
              <div className="chart-time-labels"><span>{displayTime(points[0]!.at)}</span><span>{displayTime(points.at(-1)!.at)}</span></div>
            </div>;
          })() : <div className="analytics-empty">{isLoading ? "Loading Prometheus samples…" : "No decision samples were collected in this range."}</div>}
        </section>

        <section className="panel analytics-panel latency-analytics-panel" aria-labelledby="analytics-latency-title">
          <div className="panel-heading"><div><h2 id="analytics-latency-title">API response latency</h2><p>Mean and p95 across application HTTP responses</p></div></div>
          {displayData && displayData.requestLatency.filter((point) => point.averageMs !== null || point.p95Ms !== null).length > 1 ? (() => {
            const points = displayData.requestLatency.filter((point) => point.averageMs !== null || point.p95Ms !== null);
            const max = Math.max(0.1, ...points.flatMap((point) => [point.averageMs ?? 0, point.p95Ms ?? 0]));
            return <div className="analytics-chart-wrap">
              <div className="chart-legend"><span><i className="legend-allowed" />Mean</span><span><i className="legend-latency-p95" />p95</span></div>
              <svg className="analytics-chart" viewBox="0 0 700 170" preserveAspectRatio="none" role="img" aria-label="Mean and p95 API response latency">
                <defs>
                  <linearGradient id="analytics-api-mean" x1="0" y1="0" x2="0" y2="1"><stop className="analytics-stop-green" offset="0%" stopOpacity="0.22" /><stop className="analytics-stop-green" offset="100%" stopOpacity="0" /></linearGradient>
                  <linearGradient id="analytics-api-p95" x1="0" y1="0" x2="0" y2="1"><stop className="analytics-stop-rejected" offset="0%" stopOpacity="0.2" /><stop className="analytics-stop-rejected" offset="100%" stopOpacity="0" /></linearGradient>
                </defs>
                <ChartYAxis maximum={max} formatValue={formatLatencyTick} />
                <g transform="translate(52 17)">
                  <path className="analytics-area" d={areaPath(points.map((point) => point.averageMs ?? 0), 644, 128, max)} fill="url(#analytics-api-mean)" />
                  <path className="analytics-area" d={areaPath(points.map((point) => point.p95Ms ?? 0), 644, 128, max)} fill="url(#analytics-api-p95)" />
                  <path className="traffic-line traffic-line-allowed" d={linePath(points.map((point) => point.averageMs ?? 0), 644, 128, max)} />
                  <path className="traffic-line traffic-line-p95" d={linePath(points.map((point) => point.p95Ms ?? 0), 644, 128, max)} />
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
                <defs>
                  <linearGradient id="analytics-store-mean" x1="0" y1="0" x2="0" y2="1"><stop className="analytics-stop-green" offset="0%" stopOpacity="0.22" /><stop className="analytics-stop-green" offset="100%" stopOpacity="0" /></linearGradient>
                  <linearGradient id="analytics-store-p95" x1="0" y1="0" x2="0" y2="1"><stop className="analytics-stop-rejected" offset="0%" stopOpacity="0.2" /><stop className="analytics-stop-rejected" offset="100%" stopOpacity="0" /></linearGradient>
                </defs>
                <ChartYAxis maximum={max} formatValue={formatLatencyTick} />
                <g transform="translate(52 17)">
                  <path className="analytics-area" d={areaPath(points.map((point) => point.averageStoreMs ?? 0), 644, 128, max)} fill="url(#analytics-store-mean)" />
                  <path className="analytics-area" d={areaPath(points.map((point) => point.p95StoreMs ?? 0), 644, 128, max)} fill="url(#analytics-store-p95)" />
                  <path className="traffic-line traffic-line-allowed" d={linePath(points.map((point) => point.averageStoreMs ?? 0), 644, 128, max)} />
                  <path className="traffic-line traffic-line-p95" d={linePath(points.map((point) => point.p95StoreMs ?? 0), 644, 128, max)} />
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
