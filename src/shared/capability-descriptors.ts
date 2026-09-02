import type { CapabilityDescriptor } from "gik-kernel";
import { fluentComponentCapabilities } from "gik-components/fluent";
import { primitiveComponentCapabilities } from "gik-components/primitives";
import { semanticComponentCapabilities } from "gik-components/semantic";
import { securityComponentCapabilities } from "gik-components/security";
import { softwareComponentCapabilities } from "gik-components/software";

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
