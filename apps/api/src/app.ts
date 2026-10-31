import express from "express";
import { healthRouter } from "./routes/health.routes";
import { demoRouter } from "./routes/demo.route";
import { requireApiKey } from "./middleware/api-key.middleware";

export function createApp(apiKeys: ReadonlyMap<string, string>= new Map()){
    const app= express()

    app.use(express.json())
    app.use("/health", healthRouter)
    app.use("/demo", requireApiKey(apiKeys), demoRouter)

    return app
}