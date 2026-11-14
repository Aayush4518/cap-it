import express from "express";
import cors from "cors";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
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
    frontendOrigins?: readonly string[];
    metricsBearerToken?: string;
}

function matchesBearerToken(header: string | undefined, expectedToken: string): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const actual = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(expectedToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createApp(
    apiKeys: ReadonlyMap<string, string> = new Map(),
    store: RateLimitStore = new InMemoryRateLimitStore(),
    dashboardOptions: DashboardOptions = {},
) {
    const app = express();
    const envOrigins = process.env.FRONTEND_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
    const configuredOrigins = dashboardOptions.frontendOrigins
        ?? (envOrigins.length > 0 ? envOrigins
            : process.env.NODE_ENV === "production" ? []
                : ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]);
    const allowedOrigins = new Set(configuredOrigins);

    app.disable("x-powered-by");
    app.use(requestIdMiddleware);
    app.use(helmet());
    app.use(cors({
        origin(origin, callback) {
            if (!origin) {
                callback(null, false);
                return;
            }
            if (allowedOrigins.has(origin)) {
                callback(null, true);
                return;
            }
            callback(Object.assign(new Error("Origin is not allowed by CORS."), { code: "cors_origin_not_allowed" }));
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        // The cors package reflects requested headers only for an allowed origin,
        // which supports the Playground's user-defined headers without a wildcard.
        exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "Retry-After", "X-Request-Id"],
        credentials: false,
        optionsSuccessStatus: 204,
    }));

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

    app.use(express.json({ limit: "32kb" }));
    app.use("/health", healthRouter, requestIdMiddleware)
    app.use("/demo", requireApiKey(apiKeys), createRateLimitMiddleware(store, defaultPolicy) , demoRouter)
    app.get("/metrics", async (req, res, next) => {
        const expectedToken = dashboardOptions.metricsBearerToken ?? process.env.METRICS_BEARER_TOKEN;
        if (expectedToken && !matchesBearerToken(req.get("authorization"), expectedToken)) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }
        try {
            res.set("Content-Type", register.contentType);
            res.send(await register.metrics());
        } catch (error) {
            next(error);
        }
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
    app.use(errorMiddleware);

    return app
}
