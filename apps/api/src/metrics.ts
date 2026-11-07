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