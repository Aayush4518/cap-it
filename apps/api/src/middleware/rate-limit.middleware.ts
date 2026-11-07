import type { RequestHandler } from "express"
import type { RateLimitStore, RateLimitPolicy } from "../../../../packages/rate-limiter/src"
import { rateLimitDecisions, rateLimitStoreDuration } from "../metrics"
import { performance } from "node:perf_hooks"


export function createRateLimitMiddleware(store: RateLimitStore, policy: RateLimitPolicy): RequestHandler {
    return async (req, res, next) => {
        const clientId: unknown = res.locals.clientId

        if (typeof clientId !== "string" || clientId.trim().length === 0) {
            res.status(401).json({ error: "unauthorized" })
            return
        }
        const startedAt = performance.now()
        const decision = await store.consume(clientId, policy)
        rateLimitStoreDuration
            .labels(policy.id)
            .observe((performance.now() - startedAt) / 1000)

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