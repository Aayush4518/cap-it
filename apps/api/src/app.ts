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
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { register } from "@prometheus-io/client";
import { getDashboardMetrics, httpRequestDuration, httpRequests } from "./metrics";
import { getDashboardAnalytics } from "./dashboard-analytics";
import { performance } from "node:perf_hooks";

type StoreConnectionStatus = "connected" | "disconnected" | "unknown";

interface DashboardOptions {
    instanceId?: string;
    getStoreConnectionStatus?: () => StoreConnectionStatus;
    prometheusUrl?: string;
}

export function createApp(
    apiKeys: ReadonlyMap<string, string> = new Map(),
    store: RateLimitStore = new InMemoryRateLimitStore(),
    dashboardOptions: DashboardOptions = {},
) {
    const app= express()

    app.use(requestIdMiddleware)

    app.use((req, res, next) => {
        const isOperationalRequest = req.path !== "/metrics"
            && req.path !== "/health"
            && !req.path.startsWith("/dashboard/");
        if (isOperationalRequest) {
            const knownMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
            const method = knownMethods.includes(req.method) ? req.method : "OTHER";
            const startedAt = performance.now();
            res.once("finish", () => {
                const status = String(res.statusCode);
                httpRequests.labels(method, status).inc();
                httpRequestDuration.labels(method, status).observe((performance.now() - startedAt) / 1000);
            });
        }
        next();
    });

    app.use(express.json())
    app.use("/health", healthRouter, requestIdMiddleware)
    app.use("/demo", requireApiKey(apiKeys), createRateLimitMiddleware(store, defaultPolicy) , demoRouter)
    app.get("/metrics", async(_req, res)=>{
        res.set("Content-Type", register.contentType)
        res.send(await register.metrics())
    })
    app.get("/dashboard/overview", async (_req, res) => {
        const metrics = await getDashboardMetrics(defaultPolicy.id);
        res.set("Cache-Control", "no-store");
        res.json({
            capturedAt: new Date().toISOString(),
            instance: { id: dashboardOptions.instanceId ?? process.env.INSTANCE_ID ?? "api" },
            redisStatus: dashboardOptions.getStoreConnectionStatus?.() ?? "unknown",
            policy: defaultPolicy,
            ...metrics,
        });
    });
    app.get("/dashboard/analytics", async (req, res) => {
        const selectedRange = typeof req.query.range === "string" ? req.query.range : "5m";
        try {
            const analytics = await getDashboardAnalytics(
                selectedRange,
                dashboardOptions.prometheusUrl ?? process.env.PROMETHEUS_URL ?? "http://localhost:9090",
                defaultPolicy.id,
            );
            if (!analytics) {
                res.status(400).json({ error: "invalid_analytics_range" });
                return;
            }
            res.set("Cache-Control", "no-store");
            res.json(analytics);
        } catch {
            res.status(503).json({ error: "analytics_unavailable", message: "Prometheus metrics are temporarily unavailable." });
        }
    });
    app.use(errorMiddleware)

    return app
}
