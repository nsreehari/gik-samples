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
  if (!isRecord(blueprint.payload)) return;

  const collect = (services: unknown) => {
    if (!isRecord(services)) return;
    Object.values(services).forEach((declaration) => {
      if (!isRecord(declaration) || typeof declaration.kind !== "string") return;
      const config = isRecord(declaration.config) ? declaration.config : undefined;
      if (typeof config?.endpoint !== "string") return;

      const origins = endpoints.get(declaration.kind) ?? new Set<string>();
      origins.add(new URL(config.endpoint).origin);
      endpoints.set(declaration.kind, origins);
    });
  };

  collect(blueprint.payload.services);
  const recipes = blueprint.payload.serviceRecipes;
  if (!Array.isArray(recipes)) return;
  recipes.forEach((recipe) => {
    if (!isRecord(recipe) || !Array.isArray(recipe.implementationPrograms)) return;
    recipe.implementationPrograms.forEach((program) => {
      if (isRecord(program)) collect(program.services);
    });
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
