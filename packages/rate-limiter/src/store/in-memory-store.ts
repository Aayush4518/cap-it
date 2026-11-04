import { TokenBucket } from "../algorithm/token-bucket";
import type { RateLimitPolicy } from "../policies/default-policy";
import type { RateLimitDecision, RateLimitStore } from "./rate-limit-store";

export class InMemoryRateLimitStore implements RateLimitStore {
    private readonly buckets= new Map<string, Map<string, TokenBucket>>()
    constructor(private readonly now: () => number = Date.now) {}

    async consume(
        clientId: string, 
        policy: RateLimitPolicy,
        cost =1, 

    ): Promise<RateLimitDecision> {
        if(clientId.trim().length === 0){
            throw new Error("clientId must not be empty")
        }
        let policyBuckets= this.buckets.get(policy.id)

        if(!policyBuckets){
            policyBuckets = new Map<string, TokenBucket>()
            this.buckets.set(policy.id, policyBuckets);

        }
        let bucket = policyBuckets.get(clientId)

        if(!bucket){
            bucket = new TokenBucket({
                capacity: policy.capacity,
                refillRatePerSecond: policy.refillRatePerSecond,
                now: this.now
            })
            policyBuckets.set(clientId, bucket)
        }
        return {
            ...bucket.consume(cost),
            capacity: policy.capacity,
        }
    }
}
