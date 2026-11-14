import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/api/src/config";

const validProductionEnv: Record<string, string | undefined> = {
  NODE_ENV: "production",
  PORT: "10000",
  CAPIT_API_KEY: "api-secret",
  REDIS_URL: "rediss://redis.example:6379",
  FRONTEND_ORIGINS: "https://cap-it.vercel.app,https://cap-it.example.com",
  INSTANCE_ID: "api1",
  METRICS_BEARER_TOKEN: "metrics-secret-0123456789abcdef0",
};

describe("loadRuntimeConfig", () => {
  it.each(["CAPIT_API_KEY", "REDIS_URL", "FRONTEND_ORIGINS", "METRICS_BEARER_TOKEN"] as const)(
    "fails clearly when the required production variable %s is missing",
    (name) => {
      const env = { ...validProductionEnv };
      delete env[name];
      expect(() => loadRuntimeConfig(env)).toThrow(name);
    },
  );

  it("uses local Redis and frontend origins for development defaults", () => {
    const config = loadRuntimeConfig({ CAPIT_API_KEY: "local-key" });
    expect(config.redisUrl).toBe("redis://localhost:6379");
    expect(config.frontendOrigins).toContain("http://localhost:5173");
  });

  it("parses comma-separated exact production origins", () => {
    const config = loadRuntimeConfig(validProductionEnv);
    expect(config.frontendOrigins).toEqual(["https://cap-it.vercel.app", "https://cap-it.example.com"]);
    expect(config.port).toBe(10000);
  });

  it("rejects wildcard and path-based origins", () => {
    expect(() => loadRuntimeConfig({ ...validProductionEnv, FRONTEND_ORIGINS: "*" })).toThrow("exact http(s) origins");
    expect(() => loadRuntimeConfig({ ...validProductionEnv, FRONTEND_ORIGINS: "https://cap-it.example.com/app" })).toThrow("exact http(s) origins");
  });
});
