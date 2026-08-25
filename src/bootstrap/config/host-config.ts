import localConfig from "./host.local.json";
import productionConfig from "./host.production.json";

const FOUNDRY_PROXY_ORIGIN_TOKEN = "${GIK_FOUNDRY_PROXY_ORIGIN}";
const HTTP_PROXY_ORIGIN_TOKEN = "${GIK_HTTP_PROXY_ORIGIN}";

export type HostConfig = {
  foundryProxyOrigin: string;
  httpProxyOrigin: string;
};

type HostEnvironment = "local" | "production";

type HostEnvironmentInput = {
  MODE: string;
  VITE_GIK_HOST_ENV?: string;
  VITE_GIK_FOUNDRY_PROXY_ORIGIN?: string;
  VITE_GIK_HTTP_PROXY_ORIGIN?: string;
};

function resolveHostEnvironment(env: HostEnvironmentInput): HostEnvironment {
  const configured = env.VITE_GIK_HOST_ENV?.trim();
  if (configured === "local" || configured === "production") return configured;
  if (configured) throw new Error(`Unsupported VITE_GIK_HOST_ENV '${configured}'`);
  if (env.MODE === "gik-local") return "local";
  return "production";
}

const moduleEnvironment = (import.meta as ImportMeta & { env?: HostEnvironmentInput }).env;
const defaultEnvironment = { MODE: "production" };
function resolveHostConfig(env: HostEnvironmentInput): HostConfig {
  if (resolveHostEnvironment(env) === "local") return localConfig;
  return {
    foundryProxyOrigin:
      env.VITE_GIK_FOUNDRY_PROXY_ORIGIN?.trim() || productionConfig.foundryProxyOrigin,
    httpProxyOrigin:
      env.VITE_GIK_HTTP_PROXY_ORIGIN?.trim() || productionConfig.httpProxyOrigin,
  };
}

export const hostConfig: HostConfig = resolveHostConfig(moduleEnvironment ?? defaultEnvironment);

export function applyHostConfig<T>(value: T, config: HostConfig = hostConfig): T {
  if (value === FOUNDRY_PROXY_ORIGIN_TOKEN) {
    return config.foundryProxyOrigin as T;
  }
  if (value === HTTP_PROXY_ORIGIN_TOKEN) {
    return config.httpProxyOrigin as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyHostConfig(entry, config)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, applyHostConfig(entry, config)])
    ) as T;
  }
  return value;
}