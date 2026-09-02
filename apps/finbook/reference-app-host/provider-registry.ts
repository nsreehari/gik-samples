import type { CapabilityDescriptor } from "gik-kernel";
import type { ProjectionView } from "gik-react";

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
