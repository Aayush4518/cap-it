import { describe, expect, it } from "vitest";
import { InMemoryRateLimitStore } from "../../packages/rate-limiter/src/store/in-memory-store";
import { defaultPolicy } from "../../packages/rate-limiter/src/policies/default-policy";

describe("InMemoryRateLimitStore", ()=>{
    it("shares a bucket across calls for the same client", ()=>{
        const store= new InMemoryRateLimitStore(()=> 0)

        expect(store.consume("client-a", defaultPolicy).allowed).toBe(true)
        expect(store.consume("client-a", defaultPolicy).allowed).toBe(true)
        expect(store.consume("client-a", defaultPolicy).allowed).toBe(true)

        expect(store.consume("client-a", defaultPolicy)).toMatchObject({
            allowed: false, 
            remainingTokens: 0,
            retryAfterMs: 1000,
            capacity: 3
        })
    })

    it("keeps separate buckets for different clients", ()=>{
        const store= new InMemoryRateLimitStore(()=> 0)

        store.consume("client-a", defaultPolicy)
        store.consume("client-a", defaultPolicy)
        store.consume("client-a", defaultPolicy)

        expect(store.consume("client-b", defaultPolicy).allowed).toBe(true)
    })
})