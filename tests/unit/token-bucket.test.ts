import {describe, expect, it} from "vitest"
import { TokenBucket } from "../../packages/rate-limiter/src"


describe("TokenBucket", ()=>{
    it("start full by default and consumes tokens", ()=>{
        const bucket= new TokenBucket({
            capacity:2,
            refillRatePerSecond:2,
            now:()=>0
        })
        expect(bucket.consume()).toEqual({
            allowed: true,
            remainingTokens:1,
            retryAfterMs:0
        })
    })

    it("rejects when there are no tokens and estimate the wait", ()=>{
        const bucket= new TokenBucket({
            capacity:1,
            refillRatePerSecond: 2,
            initialTokens: 0,
            now:()=>0,
        })

        expect(bucket.consume()).toEqual({
            allowed: false,
            remainingTokens:0,
            retryAfterMs: 500
        })
    })

    it("refills based on elapsed time",()=>{
        let currentTime= 0
        const bucket= new TokenBucket({
            capacity: 1,
            refillRatePerSecond: 1,
            initialTokens: 0,
            now:()=> currentTime
        })
        currentTime = 500

        expect(bucket.consume(0.5)).toEqual({
            allowed : true,
            remainingTokens: 0,
            retryAfterMs: 0
        })
    })

    it("rejects a cost larger than capacity", ()=>{
        const bucket= new TokenBucket({
            capacity: 1,
            refillRatePerSecond: 1,
            now:()=>0,
        })

        expect(()=> bucket.consume(2)).toThrow("Cost cannot exceed bucket capacity",)
    })
})