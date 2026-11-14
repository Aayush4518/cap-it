import { createApp } from "./app";
import { readFile } from "node:fs/promises";
import { RedisRateLimitStore } from "../../../packages/rate-limiter/src/store/redis-store";
import { createClient } from "redis";
import { resolve } from "node:path";




async function startServer() {
    const port = Number(process.env.PORT ?? 3000);
    const apiKey = process.env.CAPIT_API_KEY;

    if (!apiKey) {
        throw new Error("CAPIT_API_KEY must be set");
    }

    const redis = createClient({
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
    });
    redis.on("error", (error) => console.error("Redis error:", error));

    // npm runs this workspace script from apps/api.
    const scriptPath = resolve(
        process.cwd(),
        "../../packages/rate-limiter/src/store/redis/token-bucket.lua",
    );
    const script = await readFile(scriptPath, "utf8");

    await redis.connect();

    const app = createApp(
        new Map([[apiKey, "local-client"]]),
        new RedisRateLimitStore(redis, script),
        {
            instanceId: process.env.INSTANCE_ID ?? `api-${port}`,
            getStoreConnectionStatus: () => redis.isReady ? "connected" : "disconnected",
            prometheusUrl: process.env.PROMETHEUS_URL ?? "http://localhost:9090",
        },
    );

    const server = app.listen(port, () => {
        console.log(`API listening on port ${port}`);
    });

    let shuttingDown = false
    function shutdown(signal: string){
        if(shuttingDown) return
        shuttingDown = true

        console.log(`${signal} recieved; shutting down now`)

        server.close(async(error)=>{
            if(error){
                console.error("HTTP server shutdown error:", error)
                process.exitCode =1
            }
            await redis.close()
        })
    }

    process.on("SIGINT", ()=> shutdown("SIGINT"))
    process.on("SIGTERM", ()=>shutdown("SIGTERM"))
}

startServer().catch((error) => {
    console.error("Failed to start API server:", error);
    process.exitCode = 1;
});



