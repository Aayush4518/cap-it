import {Counter} from "@prometheus-io/client"
import { Histogram } from "@prometheus-io/client"

export const rateLimitDecisions = new Counter({
    name: "capit_rate_limit_decisions_total",
    help: "Total rate-limit decisions, grouped by policy and outcome.",
    labelNames: ["policy", "decision"] as const
})

export const rateLimitStoreDuration = new Histogram({
  name: "capit_rate_limit_store_duration_seconds",
  help: "Duration of rate-limit store operations in seconds.",
  labelNames: ["policy"] as const,
})

export const rateLimitStoreErrors = new Counter({
  name: "capit_rate_limit_store_errors_total",
  help: "Total rate-limit store operation failures, grouped by policy",
  labelNames: ["policy"] as const,
})

type MetricSample = {
  value: number;
  labels: Record<string, string | number>;
  metricName?: string;
};

export async function getDashboardMetrics(policyId: string) {
  const [decisionMetric, durationMetric, errorMetric] = await Promise.all([
    rateLimitDecisions.get(),
    rateLimitStoreDuration.get(),
    rateLimitStoreErrors.get(),
  ]);

  const decisions = decisionMetric.values as MetricSample[];
  const durations = durationMetric.values as MetricSample[];
  const errors = errorMetric.values as MetricSample[];
  const decisionCount = (decision: "allowed" | "rejected") => decisions
    .filter((sample) => sample.labels.policy === policyId && sample.labels.decision === decision)
    .reduce((total, sample) => total + sample.value, 0);

  const allowed = decisionCount("allowed");
  const rejected = decisionCount("rejected");
  const policyDurations = durations.filter((sample) => sample.labels.policy === policyId);
  const durationTotalSeconds = policyDurations
    .filter((sample) => sample.metricName?.endsWith("_sum"))
    .reduce((total, sample) => total + sample.value, 0);
  const durationCount = policyDurations
    .filter((sample) => sample.metricName?.endsWith("_count"))
    .reduce((total, sample) => total + sample.value, 0);
  const buckets = policyDurations
    .filter((sample) => sample.metricName?.endsWith("_bucket"))
    .map((sample) => ({
      upperBound: Number(sample.labels.le),
      count: sample.value,
    }))
    .filter((bucket) => Number.isFinite(bucket.upperBound))
    .sort((left, right) => left.upperBound - right.upperBound);

  let p95Seconds: number | null = null;
  if (durationCount > 0) {
    const target = durationCount * 0.95;
    let lowerBound = 0;
    let lowerCount = 0;
    for (const bucket of buckets) {
      if (bucket.count >= target) {
        const countInBucket = bucket.count - lowerCount;
        const fraction = countInBucket === 0 ? 1 : (target - lowerCount) / countInBucket;
        p95Seconds = lowerBound + (bucket.upperBound - lowerBound) * fraction;
        break;
      }
      lowerBound = bucket.upperBound;
      lowerCount = bucket.count;
    }
  }

  return {
    requests: { total: allowed + rejected, allowed, rejected },
    store: {
      count: durationCount,
      durationTotalMs: durationTotalSeconds * 1000,
      averageMs: durationCount > 0 ? (durationTotalSeconds / durationCount) * 1000 : null,
      p95Ms: p95Seconds === null ? null : p95Seconds * 1000,
      p95Buckets: buckets.map((bucket) => ({ upperBoundMs: bucket.upperBound * 1000, cumulativeCount: bucket.count })),
      errors: errors
        .filter((sample) => sample.labels.policy === policyId)
        .reduce((total, sample) => total + sample.value, 0),
    },
  };
}
