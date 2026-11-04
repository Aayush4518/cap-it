import { describe, expect, it } from "vitest";
import { InMemoryRateLimitStore } from "../../packages/rate-limiter/src/store/in-memory-store";
import { defaultPolicy } from "../../packages/rate-limiter/src/policies/default-policy";

describe("InMemoryRateLimitStore", ()=>{
    it("shares a bucket across calls for the same client", async()=>{
        const store= new InMemoryRateLimitStore(()=> 0)

        expect((await store.consume("client-a", defaultPolicy)).allowed).toBe(true)
        expect((await store.consume("client-a", defaultPolicy)).allowed).toBe(true)
        expect((await store.consume("client-a", defaultPolicy)).allowed).toBe(true)

        await expect(store.consume("client-a", defaultPolicy)).resolves.toMatchObject({
            allowed: false, 
            remainingTokens: 0,
            retryAfterMs: 1000,
            capacity: 3
        })
    })

    it("keeps separate buckets for different clients", async()=>{
        const store= new InMemoryRateLimitStore(()=> 0)

        await store.consume("client-a", defaultPolicy)
        await store.consume("client-a", defaultPolicy)
        await store.consume("client-a", defaultPolicy)

        expect((await store.consume("client-b", defaultPolicy)).allowed).toBe(true)
    })
})