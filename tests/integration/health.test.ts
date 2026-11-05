import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../apps/api/src/app";
import { InMemoryRateLimitStore } from "../../packages/rate-limiter/src";

describe("GET /health", ()=>{
    it("returns a healthy 200 status", async()=>{
        const response = await request(createApp()).get("/health")

        expect(response.status).toBe(200)
        expect(response.body).toEqual({status: "ok"})       //deep equality
        expect(response.headers["x-request-id"]).toBeTruthy()
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

it("allows three demo requests, then returns 429", async()=>{
    const apiKeys = new Map([["test-key", "client-a"]])
    const store = new InMemoryRateLimitStore(()=>0)
    const app = createApp(apiKeys, store)

    for(let count = 0; count<3; count++){
        const response = await request(app)
            .get("/demo")
            .set("x-api-key", "test-key")
        expect(response.status).toBe(200)
    }

    const blocked = await request(app)
        .get("/demo")
        .set("x-api-key", "test-key")
    
        expect(blocked.status).toBe(429)
        expect(blocked.headers["ratelimit-limit"]).toBe("3")
        expect(blocked.headers["ratelimit-remaining"]).toBe("0")
        expect(blocked.headers["retry-after"]).toBe("1")
})
