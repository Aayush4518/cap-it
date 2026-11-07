import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "redis"
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisRateLimitStore } from "../../packages/rate-limiter/src/store/redis-store";

const clientA = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" })
const clientB = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" })

let storeA: RedisRateLimitStore
let storeB: RedisRateLimitStore

const clientId = randomUUID()

const policy = {
    id: `integration-${randomUUID()}`,
    capacity: 2,
    refillRatePerSecond: 0.001,

}

describe("RedisRateLimitStore", () => {
    beforeAll(async () => {
        clientA.on("error", console.error)
        clientB.on("error", console.error)

        const script = await readFile(resolve(process.cwd(), "packages/rate-limiter/src/store/redis/token-bucket.lua"), "utf8")

        await Promise.all([clientA.connect(), clientB.connect()])

        storeA = new RedisRateLimitStore(clientA, script)
        storeB = new RedisRateLimitStore(clientB, script)


    })

    afterAll(async () => {
        await Promise.all([clientA.close(), clientB.close()])
    })

    it("shares a client's bucket across Redis connections", async () => {
        expect((await storeA.consume(clientId, policy)).allowed).toBe(true)
        expect((await storeA.consume(clientId, policy)).allowed).toBe(true)
        const thirdRequest = await storeB.consume(clientId, policy);

        expect(thirdRequest.allowed).toBe(false);
        expect(thirdRequest.retryAfterMs).toBeGreaterThan(0);
    })
})