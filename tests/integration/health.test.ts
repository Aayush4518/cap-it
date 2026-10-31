import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../apps/api/src/app";

describe("GET /health", ()=>{
    it("returns a healthy 200 status", async()=>{
        const response = await request(createApp()).get("/health")

        expect(response.status).toBe(200)
        expect(response.body).toEqual({status: "ok"})       //deep equality
    })
})

describe('GET /demo', () => {
    it("returns a healthy 200 status", async()=>{
        const apiKeys= new Map([["test-key", "client-a"]])
        const response = await request(createApp(apiKeys))
        .get("/demo")
        .set("x-api-key", "test-key")

        expect(response.status).toBe(200)
        expect(response.body).toEqual({endpoint: "demo", message: "Request accepted"})
    })
})

describe('GET /demo', ()=>{
    it("return 401 unauthorized without api key", async()=>{
        const response = await (request(createApp()).get("/demo"))
        expect(response.status).toBe(401)
        expect(response.body).toEqual({error: "unauthorized"})
    })
})
