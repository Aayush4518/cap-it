import { createHash } from "node:crypto";
import type { RedisClientType } from "redis";
import type { RateLimitPolicy } from "../policies/default-policy";
import type { RateLimitDecision, RateLimitStore } from "./rate-limit-store";


export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisClientType,
    private readonly script: string,
  ) {}

  async consume(
    clientId: string,
    policy: RateLimitPolicy,
    cost = 1,
  ): Promise<RateLimitDecision> {
    if (clientId.trim().length === 0) {
      throw new Error("clientId must not be empty");
    }

    if (
      !Number.isFinite(policy.capacity) ||
      policy.capacity <= 0 ||
      !Number.isFinite(policy.refillRatePerSecond) ||
      policy.refillRatePerSecond <= 0
    ) {
      throw new Error("policy capacity and refill rate must be positive finite numbers");
    }

    if (!Number.isFinite(cost) || cost <= 0 || cost > policy.capacity) {
      throw new Error("cost must be positive and cannot exceed bucket capacity");
    }

    const clientHash = createHash("sha256").update(clientId).digest("hex");
    const key = `rl:${policy.id}:${clientHash}`;

    // node-redis passes KEYS and ARGV separately to Redis EVAL.
    const reply = await this.client.eval(this.script, {
      keys: [key],
      arguments: [
        String(policy.capacity),
        String(policy.refillRatePerSecond),
        String(cost),
      ],
    });

    if (!Array.isArray(reply) || reply.length !== 3) {
      throw new Error("Redis token bucket script returned an invalid result");
    }

    const [allowedRaw, remainingRaw, retryAfterRaw] = reply;
    const allowedCode = Number(allowedRaw);
    const remainingTokens = Number(remainingRaw);
    const retryAfterMs = Number(retryAfterRaw);

    if (
      (allowedCode !== 0 && allowedCode !== 1) ||
      !Number.isFinite(remainingTokens) ||
      !Number.isFinite(retryAfterMs) ||
      remainingTokens < 0 ||
      remainingTokens > policy.capacity ||
      retryAfterMs < 0
    ) {
      throw new Error("Redis token bucket script returned invalid values");
    }

    return {
      allowed: allowedCode === 1,
      remainingTokens,
      retryAfterMs,
      capacity: policy.capacity,
    };
  }
}