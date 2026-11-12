import { createProjectionProviderSet, type ProjectionProvider } from "gik-components";

export function createProjectionProviderRegistry(providers: readonly ProjectionProvider[]) {
  const providerSet = createProjectionProviderSet(providers);
  return {
    resolveViews: providerSet.resolveViews,
    resolveCapabilities: providerSet.resolveCapabilities,
  };
}
