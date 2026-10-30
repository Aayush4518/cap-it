import { TokenBucket, type ConsumeResult } from "../algorithm/token-bucket";
import type { RateLimitPolicy } from "../policies/default-policy";

export interface RateLimitDecision extends ConsumeResult{
    capacity: number

}

export class InMemoryRateLimitStore{
    private readonly buckets= new Map<string, Map<string, TokenBucket>>()

    consume(
        clientId: string, 
        policy: RateLimitPolicy,
        cost =1, 

    ): RateLimitDecision{
        if(clientId.trim().length === 0){
            throw new Error("clientId must not be empty")
        }
        let policyBuckets= this.buckets.get(policy.id)

        if(!policyBuckets){
            policyBuckets = new Map<string, TokenBucket>()

        }
        let bucket = policyBuckets.get(clientId)

        if(!bucket){
            bucket = new TokenBucket({
                capacity: policy.capacity,
                refillRatePerSecond: policy.refillRatePerSecond
            })
            policyBuckets.set(clientId, bucket)
        }
        return {
            ...bucket.consume(cost),
            capacity: policy.capacity,
        }
    }
}