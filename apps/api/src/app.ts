import express from "express";
import { healthRouter } from "./routes/health.routes";
import { demoRouter } from "./routes/demo.route";
import { requireApiKey } from "./middleware/api-key.middleware";
// import { createRateLimitMiddleware } from "./middleware/rate-limit.middleware";
// import { InMemoryRateLimitStore, defaultPolicy } from "../../../packages/rate-limiter/src";
// import { defaultPolicy } from "../../../packages/rate-limiter/src";
import type { RateLimitStore } from "../../../packages/rate-limiter/src";
import { InMemoryRateLimitStore, defaultPolicy } from "../../../packages/rate-limiter/src";
import { createRateLimitMiddleware } from "./middleware/rate-limit.middleware";

export function createApp(apiKeys: ReadonlyMap<string, string>= new Map(), store: RateLimitStore = new InMemoryRateLimitStore()){
    const app= express()

    app.use(express.json())
    app.use("/health", healthRouter)
    app.use("/demo", requireApiKey(apiKeys), createRateLimitMiddleware(store, defaultPolicy) , demoRouter)

    return app
}