import express from "express";
import { healthRouter } from "./routes/health.routes";
import { demoRouter } from "./routes/demo.route";

export function createApp(){
    const app= express()

    app.use(express.json())
    app.use("/health", healthRouter)
    app.use("/demo", demoRouter)

    return app
}