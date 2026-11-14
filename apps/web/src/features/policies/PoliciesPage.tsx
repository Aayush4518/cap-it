import { useCallback, useEffect, useMemo, useState } from "react";

type Policy = { id: string; capacity: number; refillRatePerSecond: number };
type PolicyReport = {
  instanceId: string;
  label: string;
  port: string;
  state: "checking" | "online" | "offline" | "unavailable";
  policy: Policy | null;
};

const sources = [
  { instanceId: "api1", label: "API instance 1", port: ":3000", endpoint: "/api/api1/dashboard/overview" },
  { instanceId: "api2", label: "API instance 2", port: ":3002", endpoint: "/api/api2/dashboard/overview" },
] as const;

const initialReports: PolicyReport[] = sources.map(({ instanceId, label, port }) => ({
  instanceId, label, port, state: "checking", policy: null,
}));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPolicy(value: unknown): value is Policy {
  return isObject(value)
    && typeof value.id === "string"
    && typeof value.capacity === "number" && Number.isFinite(value.capacity)
    && typeof value.refillRatePerSecond === "number" && Number.isFinite(value.refillRatePerSecond);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function PoliciesPage() {
  const [reports, setReports] = useState(initialReports);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const nextReports = await Promise.all(sources.map(async (source, index): Promise<PolicyReport> => {
      try {
        const response = await fetch(source.endpoint, { cache: "no-store" });
        if (!response.ok) return { ...initialReports[index]!, state: "unavailable", policy: null };
        const payload: unknown = await response.json();
        if (!isObject(payload) || !isPolicy(payload.policy)) {
          return { ...initialReports[index]!, state: "unavailable", policy: null };
        }
        return { ...initialReports[index]!, state: "online", policy: payload.policy };
      } catch {
        return { ...initialReports[index]!, state: "offline", policy: null };
      }
    }));
    setReports(nextReports);
    setLastUpdated(new Date());
    setHasLoaded(true);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const policies = useMemo(() => {
    const groups = new Map<string, { policy: Policy; instances: string[] }>();
    for (const report of reports) {
      if (!report.policy) continue;
      const key = `${report.policy.id}:${report.policy.capacity}:${report.policy.refillRatePerSecond}`;
      const group = groups.get(key) ?? { policy: report.policy, instances: [] };
      group.instances.push(report.label);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [reports]);

  const onlineCount = reports.filter((report) => report.state === "online").length;
  const hasMismatch = policies.some((group) => policies.some((other) =>
    other.policy.id === group.policy.id
      && (other.policy.capacity !== group.policy.capacity || other.policy.refillRatePerSecond !== group.policy.refillRatePerSecond),
  ));

  return (
    <div className="overview-page policies-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">RATE LIMIT CONFIGURATION</span>
          <h1>Policies</h1>
          <p className="page-subtitle">Inspect the bucket rules currently applied by each API instance.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={() => void refresh()} disabled={isRefreshing}>
          <span className={isRefreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">↻</span>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <section className="policy-mode-banner" aria-label="Policy management availability">
        <span className="policy-mode-icon" aria-hidden="true">i</span>
        <div>
          <strong>Read only</strong>
          <p>Policies are defined in the API code. This backend has no create or edit endpoint, so changes must currently be made in <code>packages/rate-limiter/src/policies/default-policy.ts</code>.</p>
        </div>
      </section>

      {hasMismatch && <p className="policy-mismatch" role="status">The API instances report different values for the same policy ID. Review their configuration before sending production traffic.</p>}

      <div className="policy-summary-row">
        <div><span>Configured policies</span><strong>{hasLoaded ? policies.length : "—"}</strong></div>
        <div><span>API instances reporting</span><strong>{hasLoaded ? `${onlineCount} / ${sources.length}` : "Checking…"}</strong></div>
        <div><span>Last refreshed</span><strong>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</strong></div>
      </div>

      <section className="panel policy-catalog-panel" aria-labelledby="policy-catalog-title">
        <div className="panel-heading">
          <div><h2 id="policy-catalog-title">Active policy configuration</h2><p>Values reported by the API dashboard endpoint</p></div>
          <span className="read-only-tag">READ ONLY</span>
        </div>

        {policies.length > 0 ? (
          <div className="policy-catalog-list">
            {policies.map(({ policy, instances }) => (
              <article className="policy-record" key={`${policy.id}-${policy.capacity}-${policy.refillRatePerSecond}`}>
                <div className="policy-record-header">
                  <div><span className="policy-id">{policy.id}</span><p>Token bucket policy</p></div>
                  <span className="policy-active-state"><span className="status-dot" />Active</span>
                </div>
                <div className="policy-detail-grid">
                  <div><span>Bucket capacity</span><strong>{formatNumber(policy.capacity)} <small>tokens</small></strong></div>
                  <div><span>Refill rate</span><strong>{formatNumber(policy.refillRatePerSecond)} <small>tokens / sec</small></strong></div>
                  <div><span>Request cost</span><strong>1 <small>token / request</small></strong></div>
                </div>
                <div className="policy-applied-to"><span>Reported by</span>{instances.map((instance) => <span className="policy-instance-chip" key={instance}>{instance}</span>)}</div>
              </article>
            ))}
          </div>
        ) : hasLoaded ? (
          <div className="policy-page-empty"><strong>No policy data available</strong><p>Start the API containers and refresh to read the active policy configuration.</p></div>
        ) : (
          <div className="policy-page-empty" role="status"><span className="loading-indicator" />Connecting to API instances…</div>
        )}
      </section>

      <section className="panel policy-instance-panel" aria-labelledby="policy-instances-title">
        <div className="panel-heading"><div><h2 id="policy-instances-title">Instance reports</h2><p>Refreshed every 15 seconds</p></div></div>
        <div className="policy-instance-list">
          {reports.map(({ instanceId, label, port, state, policy }) => (
            <div className="policy-instance-row" key={instanceId}>
              <div className="policy-instance-name"><span className="instance-symbol" aria-hidden="true">↗</span><div><strong>{label}</strong><span>{port} · {policy ? `Policy ${policy.id}` : state === "checking" ? "Checking connection" : "No policy data"}</span></div></div>
              <span className={`health-pill health-${state === "online" ? "online" : state === "checking" ? "checking" : state === "unavailable" ? "unavailable" : "offline"}`}><span className="status-dot" />{state === "online" ? "Reporting" : state === "checking" ? "Checking" : state === "unavailable" ? "Unavailable" : "Offline"}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default PoliciesPage;
