import type { RateLimitPolicy } from "../policies/default-policy";
import type { ConsumeResult } from "../algorithm/token-bucket";


export interface RateLimitDecision extends ConsumeResult {
  capacity: number;
}

export interface RateLimitStore {
  consume(
    clientId: string,
    policy: RateLimitPolicy,
    cost?: number,
  ): Promise<RateLimitDecision>;
}
