import { useCallback, useEffect, useState } from "react";
import { apiAddress, apiUrl } from "../../shared/api";

type RedisStatus = "connected" | "disconnected" | "unknown";
type DashboardSummary = {
  capturedAt: string;
  instance: { id: string };
  redisStatus: RedisStatus;
  requests: { total: number; allowed: number; rejected: number };
  store: { count: number; averageMs: number | null; p95Ms: number | null };
};
type InstanceState = "checking" | "online" | "degraded" | "offline" | "unavailable";
type Instance = {
  key: string;
  label: string;
  port: string;
  state: InstanceState;
  redisStatus: RedisStatus;
  summary: DashboardSummary | null;
  checkedAt: Date | null;
};

const endpoints = [
  { key: "api1", label: "API instance 1", port: apiAddress("api1"), healthEndpoint: apiUrl("api1", "/health"), dashboardEndpoint: apiUrl("api1", "/dashboard/overview") },
  { key: "api2", label: "API instance 2", port: apiAddress("api2"), healthEndpoint: apiUrl("api2", "/health"), dashboardEndpoint: apiUrl("api2", "/dashboard/overview") },
] as const;

const initialInstances: Instance[] = endpoints.map((endpoint) => ({
  key: endpoint.key,
  label: endpoint.label,
  port: endpoint.port,
  state: "checking",
  redisStatus: "unknown",
  summary: null,
  checkedAt: null,
}));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSummary(value: unknown): value is DashboardSummary {
  if (!isObject(value) || !isObject(value.instance) || !isObject(value.requests) || !isObject(value.store)) return false;
  return typeof value.capturedAt === "string"
    && typeof value.instance.id === "string"
    && (value.redisStatus === "connected" || value.redisStatus === "disconnected" || value.redisStatus === "unknown")
    && isNumber(value.requests.total) && isNumber(value.requests.allowed) && isNumber(value.requests.rejected)
    && isNumber(value.store.count)
    && (value.store.averageMs === null || isNumber(value.store.averageMs))
    && (value.store.p95Ms === null || isNumber(value.store.p95Ms));
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatLatency(value: number | null) {
  if (value === null) return "—";
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

async function requestJson(endpoint: string): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* Empty or non-JSON response. */ }
  return { ok: response.ok, body };
}

function InstancesPage() {
  const [instances, setInstances] = useState(initialInstances);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const next = await Promise.all(endpoints.map(async (endpoint, index): Promise<Instance> => {
      const [health, dashboard] = await Promise.allSettled([
        requestJson(endpoint.healthEndpoint),
        requestJson(endpoint.dashboardEndpoint),
      ]);
      const healthOk = health.status === "fulfilled" && health.value.ok
        && isObject(health.value.body) && health.value.body.status === "ok";
      const summary = dashboard.status === "fulfilled" && dashboard.value.ok && isSummary(dashboard.value.body)
        ? dashboard.value.body
        : null;
      const noResponse = health.status === "rejected" && dashboard.status === "rejected";
      const state: InstanceState = noResponse
        ? "offline"
        : !healthOk && summary
          ? "degraded"
          : !summary
            ? healthOk ? "unavailable" : "offline"
            : "online";
      const redisStatus = summary?.redisStatus ?? "unknown";
      return {
        ...initialInstances[index]!,
        state,
        redisStatus,
        summary,
        checkedAt: new Date(),
      };
    }));
    setInstances(next);
    setLastRefresh(new Date());
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const healthyCount = instances.filter((instance) => instance.state === "online").length;
  const redisConnections = instances.filter((instance) => instance.redisStatus === "connected").length;

  return (
    <div className="overview-page instances-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">SERVICE HEALTH</span>
          <h1>Instances</h1>
          <p className="page-subtitle">Health and rate-limit store status for the configured Cap-It API instances.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={() => void refresh()} disabled={isRefreshing}>
          <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
          {isRefreshing ? "Checking…" : "Refresh"}
        </button>
      </div>

      <section className="instance-overview-strip" aria-label="Instance summary">
        <div><span>Healthy API instances</span><strong>{healthyCount} / {instances.length}</strong></div>
        <div><span>Redis connections</span><strong>{redisConnections} / {instances.length}</strong></div>
        <div><span>Last checked</span><strong>{lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</strong></div>
      </section>

      <div className="instance-cards">
        {instances.map(({ key, label, port, state, redisStatus, summary, checkedAt }) => (
          <article className="panel instance-detail-card" key={key}>
            <div className="instance-card-heading">
              <div className="instance-card-title"><span className="instance-symbol" aria-hidden="true">↗</span><div><h2>{label}</h2><span>localhost{port}</span></div></div>
              <span className={`health-pill health-${state === "online" ? "online" : state === "checking" ? "checking" : state === "degraded" ? "unavailable" : "offline"}`}><span className="status-dot" />{state === "online" ? "Healthy" : state === "checking" ? "Checking" : state === "degraded" ? "Degraded" : state === "unavailable" ? "Data unavailable" : "Offline"}</span>
            </div>

            <div className="instance-resource-list">
              <div className="instance-resource-row"><span>Redis store</span><span className={`inline-status inline-status-${redisStatus}`}><i />{redisStatus === "connected" ? "Connected" : redisStatus === "disconnected" ? "Disconnected" : "Unknown"}</span></div>
              <div className="instance-resource-row"><span>Rate-limit decisions</span><strong>{summary ? formatCount(summary.requests.total) : "—"}</strong></div>
              <div className="instance-resource-row"><span>Allowed / rejected</span><strong>{summary ? `${formatCount(summary.requests.allowed)} / ${formatCount(summary.requests.rejected)}` : "—"}</strong></div>
              <div className="instance-resource-row"><span>Mean store latency</span><strong>{summary ? formatLatency(summary.store.averageMs) : "—"}</strong></div>
              <div className="instance-resource-row"><span>Store p95 latency</span><strong>{summary ? formatLatency(summary.store.p95Ms) : "—"}</strong></div>
            </div>
            <div className="instance-card-footnote">
              <span>{summary ? `Instance ID · ${summary.instance.id}` : state === "offline" ? "Health endpoint did not respond" : "Dashboard metrics unavailable"}</span>
              {checkedAt && <span>Checked {checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
            </div>
          </article>
        ))}
      </div>

      <section className="instance-data-note" aria-label="Available instance telemetry">
        <span className="section-kicker">CURRENT TELEMETRY</span>
        <p>Request decision counts are cumulative since each API process started. This setup reports API health, Redis connectivity, and store latency; CPU and memory usage are not collected by the current metrics configuration.</p>
      </section>
    </div>
  );
}

export default InstancesPage;
