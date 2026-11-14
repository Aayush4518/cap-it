export interface RuntimeConfig {
  nodeEnv: string;
  port: number;
  frontendOrigins: string[];
  redisUrl: string;
  apiKey: string;
  instanceId: string;
  prometheusUrl?: string;
  metricsBearerToken?: string;
}

export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

function configError(message: string): RuntimeConfigError {
  return new RuntimeConfigError(message);
}

const developmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function parseOrigins(value: string | undefined, isProduction: boolean): string[] {
  if (!value?.trim()) {
    if (isProduction) {
      throw configError("FRONTEND_ORIGINS must be set in production to the comma-separated frontend origins.");
    }
    return developmentOrigins;
  }

  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    if (origin === "*") {
      throw configError("FRONTEND_ORIGINS values must be exact http(s) origins without paths; wildcard origins are not allowed.");
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw configError(`FRONTEND_ORIGINS contains an invalid origin: ${origin}`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
      throw configError(`FRONTEND_ORIGINS values must be exact http(s) origins without paths: ${origin}`);
    }
  }
  return [...new Set(origins)];
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const apiKey = env.CAPIT_API_KEY?.trim();
  if (!apiKey) throw configError("CAPIT_API_KEY must be set.");

  const redisUrl = env.REDIS_URL?.trim() || (isProduction ? "" : "redis://localhost:6379");
  if (!redisUrl && isProduction) throw configError("REDIS_URL must be set in production to connect to the managed Redis service.");
  if (redisUrl) {
    let parsedRedisUrl: URL;
    try {
      parsedRedisUrl = new URL(redisUrl);
    } catch {
      throw configError("REDIS_URL must be a valid redis:// or rediss:// URL.");
    }
    if ((parsedRedisUrl.protocol !== "redis:" && parsedRedisUrl.protocol !== "rediss:") || !parsedRedisUrl.hostname) {
      throw configError("REDIS_URL must be a valid redis:// or rediss:// URL.");
    }
  }

  const metricsBearerToken = env.METRICS_BEARER_TOKEN?.trim();
  if (isProduction && !metricsBearerToken) {
    throw configError("METRICS_BEARER_TOKEN must be set in production to protect the /metrics endpoint.");
  }
  if (isProduction && metricsBearerToken && metricsBearerToken.length < 32) {
    throw configError("METRICS_BEARER_TOKEN must contain at least 32 characters in production.");
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError("PORT must be an integer between 1 and 65535.");
  }

  const frontendOrigins = parseOrigins(env.FRONTEND_ORIGINS, isProduction);
  return {
    nodeEnv,
    port,
    frontendOrigins,
    redisUrl,
    apiKey,
    instanceId: env.INSTANCE_ID?.trim() || `api-${port}`,
    ...(env.PROMETHEUS_URL?.trim() ? { prometheusUrl: env.PROMETHEUS_URL.trim() } : {}),
    ...(metricsBearerToken ? { metricsBearerToken } : {}),
  };
}
