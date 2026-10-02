import type { CapabilityDescriptor } from "gik-kernel";
import {
  createProjectionProviderSet,
  fluentProjectionProvider,
  primitiveProjectionProvider,
  semanticProjectionProvider,
  securityProjectionProvider,
  softwareProjectionProvider,
  type ProjectionProvider,
} from "gik-components";

export const sampleComponentProviders: readonly ProjectionProvider[] = [
  fluentProjectionProvider,
  primitiveProjectionProvider,
  semanticProjectionProvider,
  securityProjectionProvider,
  softwareProjectionProvider,
];

const providerSet = createProjectionProviderSet(sampleComponentProviders);

export function resolveSampleCapabilityDescriptors(
  provider: string,
): Record<string, CapabilityDescriptor> | undefined {
  return providerSet.resolveCapabilities(provider);
}
