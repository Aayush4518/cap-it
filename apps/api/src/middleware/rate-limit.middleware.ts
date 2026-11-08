import type { RequestHandler } from "express"
import type { RateLimitStore, RateLimitPolicy } from "../../../../packages/rate-limiter/src"
import { rateLimitDecisions, rateLimitStoreDuration, rateLimitStoreErrors } from "../metrics"
import { performance } from "node:perf_hooks"
// import { error } from "node:console"
// import { request } from "node:http"


export function createRateLimitMiddleware(store: RateLimitStore, policy: RateLimitPolicy): RequestHandler {
    return async (req, res, next) => {
        const clientId: unknown = res.locals.clientId

        if (typeof clientId !== "string" || clientId.trim().length === 0) {
            res.status(401).json({ error: "unauthorized" })
            return
        }
        const startedAt = performance.now()
        let decision: Awaited<ReturnType<RateLimitStore["consume"]>>
        try {

            decision = await store.consume(clientId, policy)
        } catch {
            rateLimitStoreErrors.labels(policy.id).inc()
            res.status(503).json({
                error: "rate_limit_store_unavailable",
                requestId: res.locals.requestId
            })
            return
        } finally {

            rateLimitStoreDuration
                .labels(policy.id)
                .observe((performance.now() - startedAt) / 1000)
        }
        rateLimitDecisions
            .labels(policy.id, decision.allowed ? "allowed" : "rejected")
            .inc()

        res.set("RateLimit-Limit", String(decision.capacity))
        res.set("RateLimit-Remaining", String(Math.floor(decision.remainingTokens)))

        if (!decision.allowed) {
            const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
            res.set("Retry-After", String(retryAfterSeconds))
            res.status(429).json({
                error: "rate_limit_exceeded",
                retryAfterMs: decision.retryAfterMs

            })
            return
        }
        next();

    }
}