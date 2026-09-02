import type { ProjectionView } from "@gik-ai/react";
import { fluentComponentViews } from "@gik-ai/components/fluent";
import { primitiveComponentViews } from "@gik-ai/components/primitives";
import { semanticComponentViews } from "@gik-ai/components/semantic";
import { securityComponentViews } from "@gik-ai/components/security";
import { softwareComponentViews } from "@gik-ai/components/software";
import { resolveSampleCapabilityDescriptors } from "../../../shared/capability-descriptors";
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

export const resolveCapabilityDescriptors = resolveSampleCapabilityDescriptors;
