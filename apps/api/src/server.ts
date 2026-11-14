import { createApp } from "./app";
import { readFile } from "node:fs/promises";
import { RedisRateLimitStore } from "../../../packages/rate-limiter/src/store/redis-store";
import { createClient } from "redis";
import { resolve } from "node:path";
import { loadRuntimeConfig, RuntimeConfigError } from "./config";


async function startServer() {
    const config = loadRuntimeConfig();

    const redis = createClient({
        url: config.redisUrl,
    });
    redis.on("error", (error) => console.error("Redis connection error", { errorName: error.name }));

    // npm runs this workspace script from apps/api.
    const scriptPath = resolve(
        process.cwd(),
        "../../packages/rate-limiter/src/store/redis/token-bucket.lua",
    );
    const script = await readFile(scriptPath, "utf8");

    await redis.connect();

    const app = createApp(
        new Map([[config.apiKey, "local-client"]]),
        new RedisRateLimitStore(redis, script),
        {
            instanceId: config.instanceId,
            getStoreConnectionStatus: () => redis.isReady ? "connected" : "disconnected",
            frontendOrigins: config.frontendOrigins,
            ...(config.prometheusUrl ? { prometheusUrl: config.prometheusUrl } : {}),
            ...(config.metricsBearerToken ? { metricsBearerToken: config.metricsBearerToken } : {}),
        },
    );

    const server = app.listen(config.port, "0.0.0.0", () => {
        console.log(`API instance ${config.instanceId} listening on port ${config.port}`);
    });

    let shuttingDown = false;
    function shutdown(signal: string) {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`${signal} received; shutting down.`);

        server.close(async (error) => {
            if (error) {
                console.error("HTTP server shutdown error", { errorName: error.name });
                process.exitCode = 1;
            }
            try {
                await redis.close();
            } catch (redisError) {
                console.error("Redis shutdown error", {
                    errorName: redisError instanceof Error ? redisError.name : "UnknownError",
                });
                process.exitCode = 1;
            }
        });
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch((error) => {
    if (error instanceof RuntimeConfigError) {
        console.error("API configuration error:", error.message);
    } else {
        console.error("Failed to start API server:", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
    }
    process.exitCode = 1;
});



