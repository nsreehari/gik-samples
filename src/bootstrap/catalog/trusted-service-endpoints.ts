interface TrustedBlueprintSource {
  readonly payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectBlueprintServiceEndpoints(
  blueprint: TrustedBlueprintSource,
  endpoints: Map<string, Set<string>>,
): void {
  if (!isRecord(blueprint.payload) || !isRecord(blueprint.payload.services)) return;

  Object.values(blueprint.payload.services).forEach((declaration) => {
    if (!isRecord(declaration) || typeof declaration.kind !== "string") return;
    const config = isRecord(declaration.config) ? declaration.config : undefined;
    if (typeof config?.endpoint !== "string") return;

    const origins = endpoints.get(declaration.kind) ?? new Set<string>();
    origins.add(new URL(config.endpoint).origin);
    endpoints.set(declaration.kind, origins);
  });
}

export function trustedServiceEndpointOrigins(
  blueprints: Readonly<Record<string, TrustedBlueprintSource>>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const endpoints = new Map<string, Set<string>>();
  Object.values(blueprints).forEach((blueprint) => {
    collectBlueprintServiceEndpoints(blueprint, endpoints);
  });
  return endpoints;
}

export function authorizeTrustedServiceEndpoint(
  endpoints: ReadonlyMap<string, ReadonlySet<string>>,
  kind: string,
  endpoint: URL,
): boolean {
  return endpoints.get(kind)?.has(endpoint.origin) ?? false;
}
