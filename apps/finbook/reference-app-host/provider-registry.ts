import type { CapabilityDescriptor } from "@gik-ai/kernel";
import type { ProjectionView } from "@gik-ai/react";

export interface ProjectionProvider {
  id: string;
  views: Record<string, ProjectionView>;
  capabilities: Record<string, CapabilityDescriptor>;
}

export function createProjectionProviderRegistry(providers: readonly ProjectionProvider[]) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    resolveViews: (id: string) => byId.get(id)?.views,
    resolveCapabilities: (id: string) => byId.get(id)?.capabilities,
  };
}
