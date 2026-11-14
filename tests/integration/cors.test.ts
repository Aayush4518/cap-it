import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app";
import { InMemoryRateLimitStore } from "../../packages/rate-limiter/src";

const frontendOrigins = ["https://cap-it.example.com"];

describe("API CORS and operational endpoints", () => {
  it("allows a configured frontend origin", async () => {
    const response = await request(createApp(new Map(), undefined, { frontendOrigins }))
      .get("/health")
      .set("Origin", frontendOrigins[0]!);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(frontendOrigins[0]);
    expect(response.headers.vary).toContain("Origin");
  });

  it("rejects a frontend origin that is not configured", async () => {
    const response = await request(createApp(new Map(), undefined, { frontendOrigins }))
      .get("/health")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("origin_not_allowed");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers OPTIONS preflight and advertises the required headers and methods", async () => {
    const response = await request(createApp(new Map(), undefined, { frontendOrigins }))
      .options("/demo")
      .set("Origin", frontendOrigins[0]!)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization,x-api-key,x-trace-id");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(frontendOrigins[0]);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
    expect(response.headers["access-control-allow-headers"]).toContain("x-api-key");
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
    expect(response.headers["access-control-allow-headers"]).toContain("x-trace-id");
  });

  it("exposes rate-limit headers to the configured browser origin", async () => {
    const apiKeys = new Map([["test-key", "client-a"]]);
    const app = createApp(apiKeys, new InMemoryRateLimitStore(() => 0), { frontendOrigins });
    let lastResponse;
    for (let count = 0; count < 4; count += 1) {
      lastResponse = await request(app)
        .get("/demo")
        .set("Origin", frontendOrigins[0]!)
        .set("x-api-key", "test-key");
    }

    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers["access-control-expose-headers"]).toContain("RateLimit-Limit");
    expect(lastResponse?.headers["access-control-expose-headers"]).toContain("Retry-After");
    expect(lastResponse?.headers["ratelimit-limit"]).toBe("3");
  });

  it("requires a bearer token for Prometheus metrics when configured", async () => {
    const app = createApp(new Map(), undefined, { metricsBearerToken: "metrics-secret", frontendOrigins });
    const unauthorized = await request(app).get("/metrics");
    const authorized = await request(app).get("/metrics").set("Authorization", "Bearer metrics-secret");

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.text).toContain("# HELP");
  });
});
