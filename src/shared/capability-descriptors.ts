import type { CapabilityDescriptor } from "@gik-ai/kernel";
import { fluentComponentCapabilities } from "@gik-ai/components/fluent";
import { primitiveComponentCapabilities } from "@gik-ai/components/primitives";
import { semanticComponentCapabilities } from "@gik-ai/components/semantic";
import { securityComponentCapabilities } from "@gik-ai/components/security";
import { softwareComponentCapabilities } from "@gik-ai/components/software";

const providers: Record<string, Record<string, CapabilityDescriptor>> = {
  fluent: fluentComponentCapabilities,
  primitive: primitiveComponentCapabilities,
  semantic: semanticComponentCapabilities,
  security: securityComponentCapabilities,
  software: softwareComponentCapabilities,
};

export function resolveSampleCapabilityDescriptors(
  provider: string,
): Record<string, CapabilityDescriptor> | undefined {
  return providers[provider];
}
