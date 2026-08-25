import type { CapabilityDescriptor } from "@gik/kernel";
import type { ProjectionView } from "@gik/react";
import { fluentComponentCapabilities, fluentComponentViews } from "@gik/components/fluent";
import { primitiveComponentCapabilities, primitiveComponentViews } from "@gik/components/primitives";
import { semanticComponentCapabilities, semanticComponentViews } from "@gik/components/semantic";
import { securityComponentCapabilities, securityComponentViews } from "@gik/components/security";
import { softwareComponentCapabilities, softwareComponentViews } from "@gik/components/software";
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
