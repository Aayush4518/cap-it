export type ApiInstanceKey = "api1" | "api2";

const localProxyBases: Record<ApiInstanceKey, string> = {
  api1: "/api/api1",
  api2: "/api/api2",
};

const configuredBases: Record<ApiInstanceKey, string | undefined> = {
  api1: import.meta.env.VITE_API1_URL,
  api2: import.meta.env.VITE_API2_URL,
};

export function apiBaseUrl(instance: ApiInstanceKey): string {
  return (configuredBases[instance]?.trim() || localProxyBases[instance]).replace(/\/+$/, "");
}

export function apiLoadTestUrl(instance: ApiInstanceKey): string | undefined {
  const configured = configuredBases[instance]?.trim();
  return configured ? configured.replace(/\/+$/, "") : undefined;
}

export function apiUrl(instance: ApiInstanceKey, path: string): string {
  return `${apiBaseUrl(instance)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function apiAddress(instance: ApiInstanceKey): string {
  const configured = configuredBases[instance]?.trim();
  if (!configured) return instance === "api1" ? ":3000" : ":3002";
  try {
    return new URL(configured).host;
  } catch {
    return configured;
  }
}
