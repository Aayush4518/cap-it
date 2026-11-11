import { useCallback, useEffect, useState } from "react";

type HealthState = "checking" | "online" | "offline";
type Instance = {
  id: string;
  label: string;
  endpoint: string;
  state: HealthState;
};

const initialInstances: Instance[] = [
  { id: "api1", label: "API instance 1", endpoint: "/api/api1/health", state: "checking" },
  { id: "api2", label: "API instance 2", endpoint: "/api/api2/health", state: "checking" },
];

const overviewMetrics = [
  { label: "Total requests", tone: "neutral" },
  { label: "Allowed", tone: "green" },
  { label: "Rejected", tone: "orange" },
  { label: "Requests / sec", tone: "neutral" },
  { label: "Average latency", tone: "neutral" },
  { label: "p95 latency", tone: "neutral" },
] as const;

function OverviewPage() {
  const [instances, setInstances] = useState(initialInstances);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refreshHealth = useCallback(async () => {
    setIsRefreshing(true);
    const results = await Promise.all(
      initialInstances.map(async (instance) => {
        try {
          const response = await fetch(instance.endpoint, { cache: "no-store" });
          if (!response.ok) throw new Error(`Health check returned ${response.status}`);
          const body: unknown = await response.json();
          if (typeof body !== "object" || body === null || !("status" in body) || body.status !== "ok") {
            throw new Error("Unexpected health response");
          }
          return { ...instance, state: "online" as const };
        } catch {
          return { ...instance, state: "offline" as const };
        }
      }),
    );
    setInstances(results);
    setLastChecked(new Date());
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

  return (
    <div className="overview-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">SYSTEM STATUS</span>
          <h1>Overview</h1>
          <p className="page-subtitle">A live view of your rate limiter and its connected services.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={() => void refreshHealth()} disabled={isRefreshing}>
          <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
          {isRefreshing ? "Checking…" : "Refresh status"}
        </button>
      </div>

      <section className="metric-grid" aria-label="Request metrics">
        {overviewMetrics.map(({ label, tone }) => (
          <article className="metric-panel" key={label}>
            <div className="metric-label">{label}</div>
            <div className={`metric-value tone-${tone}`} aria-label="Unavailable">—</div>
          </article>
        ))}
      </section>
      <p className="data-note">Request totals and latency charts need a dashboard summary endpoint.</p>

      <div className="overview-grid">
        <section className="panel chart-panel" aria-labelledby="traffic-title">
          <div className="panel-heading">
            <div>
              <h2 id="traffic-title">Request traffic</h2>
              <p>Allowed and rejected requests over time</p>
            </div>
            <span className="panel-period">Last 15 minutes</span>
          </div>
          <div className="chart-empty-state">
            <strong>Waiting for traffic data</strong>
            <p>The API currently exposes scrape metrics, but no dashboard summary endpoint.</p>
          </div>
        </section>

        <section className="panel chart-panel latency-panel" aria-labelledby="latency-title">
          <div className="panel-heading">
            <div>
              <h2 id="latency-title">Store latency</h2>
              <p>Rate-limit store operation duration</p>
            </div>
          </div>
          <div className="chart-empty-state compact-empty-state">
            <strong>Waiting for latency data</strong>
            <p>Store timings aren’t available as a dashboard summary yet.</p>
          </div>
        </section>
      </div>

      <div className="overview-grid lower-grid">
        <section className="panel instances-panel" aria-labelledby="instances-title">
          <div className="panel-heading">
            <div>
              <h2 id="instances-title">API instances</h2>
              <p>Health checks refresh every 15 seconds</p>
            </div>
            {lastChecked && <span className="last-checked">Updated {lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
          <div className="instance-list">
            {instances.map(({ id, label, state }) => (
              <div className="instance-row" key={id}>
                <div className="instance-identity">
                  <span className="instance-symbol" aria-hidden="true">↗</span>
                  <div><strong>{label}</strong><span>{id}</span></div>
                </div>
                <span className={`health-pill health-${state}`}>
                  <span className="status-dot" />{state === "checking" ? "Checking" : state === "online" ? "Healthy" : "Offline"}
                </span>
              </div>
            ))}
            <div className="instance-row redis-row">
              <div className="instance-identity">
                <span className="instance-symbol redis-symbol" aria-hidden="true">R</span>
                <div><strong>Redis</strong><span>Shared rate-limit store</span></div>
              </div>
              <span className="health-pill health-unknown"><span className="status-dot" />Not reported</span>
            </div>
          </div>
        </section>

        <section className="panel policy-panel" aria-labelledby="policy-title">
          <div className="panel-heading">
            <div>
              <h2 id="policy-title">Demo policy</h2>
              <p>Repository default values</p>
            </div>
            <span className="policy-id">demo</span>
          </div>
          <div className="policy-values">
            <div><span>Bucket capacity</span><strong>3 <small>tokens</small></strong></div>
            <div><span>Refill rate</span><strong>1 <small>token / sec</small></strong></div>
          </div>
          <div className="policy-footnote">Matches the current demo policy source; dynamic policy discovery is not exposed by the API.</div>
        </section>
      </div>
    </div>
  );
}

export default OverviewPage;
