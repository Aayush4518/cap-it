type RangeKey = "5m" | "15m" | "1h" | "24h";

const ranges: Record<RangeKey, { durationMs: number; stepSeconds: number; rateWindow: string; increaseWindow: string }> = {
  "5m": { durationMs: 5 * 60_000, stepSeconds: 5, rateWindow: "30s", increaseWindow: "5m" },
  "15m": { durationMs: 15 * 60_000, stepSeconds: 15, rateWindow: "1m", increaseWindow: "15m" },
  "1h": { durationMs: 60 * 60_000, stepSeconds: 60, rateWindow: "2m", increaseWindow: "1h" },
  "24h": { durationMs: 24 * 60 * 60_000, stepSeconds: 300, rateWindow: "5m", increaseWindow: "24h" },
};

type PrometheusSeries = {
  metric: Record<string, string>;
  values?: [number | string, string][];
  value?: [number | string, string];
};

type PrometheusResponse = {
  status: string;
  data?: { resultType?: string; result?: PrometheusSeries[] };
};

function isRangeKey(value: string): value is RangeKey {
  return Object.hasOwn(ranges, value);
}

async function queryPrometheus(baseUrl: string, query: string, range: { start: number; end: number; stepSeconds: number }) {
  const url = new URL("/api/v1/query_range", baseUrl);
  url.search = new URLSearchParams({
    query,
    start: String(range.start),
    end: String(range.end),
    step: `${range.stepSeconds}s`,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("Prometheus range query failed");
  const payload = await response.json() as PrometheusResponse;
  if (payload.status !== "success" || !Array.isArray(payload.data?.result)) throw new Error("Invalid Prometheus range response");
  return payload.data.result;
}

async function queryPrometheusInstant(baseUrl: string, query: string) {
  const url = new URL("/api/v1/query", baseUrl);
  url.search = new URLSearchParams({ query }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("Prometheus instant query failed");
  const payload = await response.json() as PrometheusResponse;
  if (payload.status !== "success" || !Array.isArray(payload.data?.result)) throw new Error("Invalid Prometheus instant response");
  return payload.data.result;
}

function readRangeSeries(series: PrometheusSeries[]) {
  return series.flatMap((item) => (item.values ?? []).flatMap(([timestamp, rawValue]) => {
    const at = Number(timestamp) * 1000;
    const value = Number(rawValue);
    return Number.isFinite(at) && Number.isFinite(value) ? [{ at, value }] : [];
  }));
}

export async function getDashboardAnalytics(rangeKey: string, prometheusUrl: string, policyId: string) {
  if (!isRangeKey(rangeKey)) return null;
  const selected = ranges[rangeKey];
  const end = Date.now();
  const window = { start: (end - selected.durationMs) / 1000, end: end / 1000, stepSeconds: selected.stepSeconds };
  const policySelector = `{policy="${policyId}"}`;
  const rangeSelector = `[${selected.rateWindow}]`;
  const queries = {
    decisions: `sum by (decision) (rate(capit_rate_limit_decisions_total${policySelector}${rangeSelector}))`,
    averageStoreMs: `(sum(rate(capit_rate_limit_store_duration_seconds_sum${policySelector}${rangeSelector})) / sum(rate(capit_rate_limit_store_duration_seconds_count${policySelector}${rangeSelector}))) * 1000`,
    p95StoreMs: `histogram_quantile(0.95, sum by (le) (rate(capit_rate_limit_store_duration_seconds_bucket${policySelector}${rangeSelector}))) * 1000`,
    storeErrors: `sum(rate(capit_rate_limit_store_errors_total${policySelector}${rangeSelector}))`,
    averageRequestMs: `(sum(rate(capit_http_request_duration_seconds_sum${rangeSelector})) / sum(rate(capit_http_request_duration_seconds_count${rangeSelector}))) * 1000`,
    p95RequestMs: `histogram_quantile(0.95, sum by (le) (rate(capit_http_request_duration_seconds_bucket${rangeSelector}))) * 1000`,
  };
  const [decisionSeries, averageStoreSeries, p95StoreSeries, errorSeries, averageRequestSeries, p95RequestSeries, statusSeries] = await Promise.all([
    queryPrometheus(prometheusUrl, queries.decisions, window),
    queryPrometheus(prometheusUrl, queries.averageStoreMs, window),
    queryPrometheus(prometheusUrl, queries.p95StoreMs, window),
    queryPrometheus(prometheusUrl, queries.storeErrors, window),
    queryPrometheus(prometheusUrl, queries.averageRequestMs, window),
    queryPrometheus(prometheusUrl, queries.p95RequestMs, window),
    queryPrometheusInstant(prometheusUrl, `sum by (status) (increase(capit_http_requests_total[${selected.increaseWindow}]))`),
  ]);

  const decisionsByTime = new Map<number, { allowedPerSecond: number; rejectedPerSecond: number }>();
  for (const item of decisionSeries) {
    const kind = item.metric.decision;
    if (kind !== "allowed" && kind !== "rejected") continue;
    for (const point of readRangeSeries([item])) {
      const current = decisionsByTime.get(point.at) ?? { allowedPerSecond: 0, rejectedPerSecond: 0 };
      if (kind === "allowed") current.allowedPerSecond = point.value;
      else current.rejectedPerSecond = point.value;
      decisionsByTime.set(point.at, current);
    }
  }

  const storeAverages = new Map(readRangeSeries(averageStoreSeries).map((point) => [point.at, point.value]));
  const storeP95s = new Map(readRangeSeries(p95StoreSeries).map((point) => [point.at, point.value]));
  const errors = new Map(readRangeSeries(errorSeries).map((point) => [point.at, point.value]));
  const requestAverages = new Map(readRangeSeries(averageRequestSeries).map((point) => [point.at, point.value]));
  const requestP95s = new Map(readRangeSeries(p95RequestSeries).map((point) => [point.at, point.value]));
  const traffic = [...decisionsByTime.keys()].sort((left, right) => left - right).map((at) => ({
    at,
    ...(decisionsByTime.get(at) ?? { allowedPerSecond: 0, rejectedPerSecond: 0 }),
  }));
  const storeLatency = [...new Set([...storeAverages.keys(), ...storeP95s.keys(), ...errors.keys()])].sort((left, right) => left - right).map((at) => ({
    at,
    averageStoreMs: storeAverages.get(at) ?? null,
    p95StoreMs: storeP95s.get(at) ?? null,
    storeErrorsPerSecond: errors.get(at) ?? 0,
  }));
  const requestLatency = [...new Set([...requestAverages.keys(), ...requestP95s.keys()])].sort((left, right) => left - right).map((at) => ({
    at,
    averageMs: requestAverages.get(at) ?? null,
    p95Ms: requestP95s.get(at) ?? null,
  }));
  const httpStatuses = statusSeries.flatMap((item) => {
    const status = Number(item.metric.status);
    const requests = Number(item.value?.[1]);
    return Number.isInteger(status) && Number.isFinite(requests) ? [{ status, requests: Math.max(0, requests) }] : [];
  }).sort((left, right) => left.status - right.status);

  return { range: rangeKey, capturedAt: new Date(end).toISOString(), traffic, requestLatency, storeLatency, httpStatuses };
}
