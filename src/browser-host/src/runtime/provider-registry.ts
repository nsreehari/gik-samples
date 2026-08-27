import type { CapabilityDescriptor } from "@gik-ai/kernel";
import type { ProjectionView } from "@gik-ai/react";
import { fluentComponentCapabilities, fluentComponentViews } from "@gik-ai/components/fluent";
import { primitiveComponentCapabilities, primitiveComponentViews } from "@gik-ai/components/primitives";
import { semanticComponentCapabilities, semanticComponentViews } from "@gik-ai/components/semantic";
import { securityComponentCapabilities, securityComponentViews } from "@gik-ai/components/security";
import { softwareComponentCapabilities, softwareComponentViews } from "@gik-ai/components/software";
import { credentialAccessViews } from "./credential-access";

const projectionProviders: Record<string, Record<string, ProjectionView>> = {
  fluent: fluentComponentViews,
  host: credentialAccessViews,
  primitive: primitiveComponentViews,
  semantic: semanticComponentViews,
  security: securityComponentViews,
  software: softwareComponentViews,
};

export function resolveProjectionViews(id: string): Record<string, ProjectionView> | undefined {
  return projectionProviders[id];
}

const capabilityDescriptorProviders: Record<string, Record<string, CapabilityDescriptor>> = {
  fluent: fluentComponentCapabilities,
  primitive: primitiveComponentCapabilities,
  semantic: semanticComponentCapabilities,
  security: securityComponentCapabilities,
  software: softwareComponentCapabilities,
};

export function resolveCapabilityDescriptors(id: string): Record<string, CapabilityDescriptor> | undefined {
  return capabilityDescriptorProviders[id];
}
