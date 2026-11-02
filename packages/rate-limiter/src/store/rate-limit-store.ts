import { RateLimitPolicy } from "../policies/default-policy"
import { ConsumeResult } from "../algorithm/token-bucket"


export interface RateLimitDecision extends ConsumeResult{
    capacity: number
}

export interface RateLimitStore{
    consume(
        clientId: string, 
        policy: RateLimitPolicy,
        cost?: number,

    ): Promise<RateLimitDecision>
}
