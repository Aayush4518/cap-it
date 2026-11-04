-- KEYS[1]: bucket hash key
-- ARGV[1]: capacity
-- ARGV[2]: refill rate, in tokens per second
-- ARGV[3]: request cost


local key= KEYS[1]
local capacity= tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

if not capacity or capacity <=0 then
    return redis.error_reply("capacity must be greater than 0")
end

if not refillRate or refillRate <= 0 then
    return redis.error_reply("refill rate must be greater than 0")
end

if not cost or cost <= 0 or cost > capacity then 
    return redis.error_reply("cost must be greater than 0 and at most capacity")
end

-- using redis server time so api instances share the same time

local time = redis.call("TIME")
local nowMs = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)

local state = redis.call("HMGET", key, "tokens", "lastRefillAtMs")
local tokens = tonumber(state[1]) or capacity
local lastRefillAtMs = tonumber(state[2]) or nowMs

-- refill based on elapsed time

local elapsedMs = math.max(0, nowMs - lastRefillAtMs)
tokens = math.min(capacity, tokens + (elapsedMs/1000) * refillRate)
lastRefillAtMs = math.max(lastRefillAtMs, nowMs)

local allowed = 0
local retryAfterMs = 0

if tokens>=cost then 
    tokens = tokens - cost
    allowed = 1
else 
    retryAfterMs = math.ceil(((cost - tokens)/refillRate)*1000)
end

redis.call(
    "HSET", key, "tokens", tokens, 
    "lastRefillAtMs", lastRefillAtMs
)

local ttlMs = math.max(1, math.ceil((capacity/refillRate) * 1000))
redis.call("PEXPIRE", key, ttlMs)

return {allowed, tostring(tokens), retryAfterMs}
