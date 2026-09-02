import type { ProjectionView } from "gik-react";
import { fluentComponentViews } from "gik-components/fluent";
import { primitiveComponentViews } from "gik-components/primitives";
import { semanticComponentViews } from "gik-components/semantic";
import { securityComponentViews } from "gik-components/security";
import { softwareComponentViews } from "gik-components/software";
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
