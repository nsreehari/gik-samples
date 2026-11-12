import type { ProjectionView } from "gik-react";
import { createProjectionProviderSet } from "gik-components";
import { sampleComponentProviders } from "../../../shared/capability-descriptors";
import { credentialAccessViews } from "./credential-access";

export const browserProjectionProviders = [
  ...sampleComponentProviders,
  {
    id: "host",
    views: credentialAccessViews,
  },
] as const;

const providerSet = createProjectionProviderSet(browserProjectionProviders);

export function resolveProjectionViews(id: string): Record<string, ProjectionView> | undefined {
  return providerSet.resolveViews(id);
}

export const resolveCapabilityDescriptors = providerSet.resolveCapabilities;
