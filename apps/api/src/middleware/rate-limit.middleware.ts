import type {RequestHandler} from "express"
import type { InMemoryRateLimitStore, RateLimitPolicy } from "../../../../packages/rate-limiter/src"



export function createRateLimitMiddleware(store: InMemoryRateLimitStore, policy: RateLimitPolicy): RequestHandler{
    return(req, res, next)=>{
        const clientId : unknown = res.locals.clientId

        if(typeof clientId !== "string" || clientId.trim().length=== 0){
            res.status(401).json({error: "unauthorized"})
            return
        }
        const decision = store.consume(clientId,policy)

        res.set("RateLimit-Limit", String(decision.capacity))
        res.set("RateLimit-Remaining", String(Math.floor(decision.remainingTokens)))

        if(!decision.allowed){
            const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs/1000))
            res.set("Retry-After",String(retryAfterSeconds))
            res.status(429).json({
                error: "rate_limit_exceeded",
                retryAfterMs: decision.retryAfterMs

            })
            return
        }
        next();

    }
}