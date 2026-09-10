import type { CapabilityDescriptor, Json, ResolvedNode } from "gik-kernel";
import type { ProjectionView } from "gik-react";

import type { AgentFacingCapabilityCatalog } from "./agent-facing";
import {
  createAgentFacingCapabilityCatalog,
  createComponentAuthoringApi,
  type ComponentAgentKit,
  type ComponentAuthoringDescription,
  type ComponentAuthoringTool,
  type ComponentCatalogEntry,
  type ComponentPreflightReport,
} from "./component-authoring-internal";
import type {
  ComponentValidationReport,
  DeclarativeComponentDefinition,
} from "./definition";

export interface ProjectionProvider {
  id: string;
  definitions?: Readonly<Record<string, DeclarativeComponentDefinition>>;
  views?: Readonly<Record<string, ProjectionView>>;
  capabilities?: Readonly<Record<string, CapabilityDescriptor>>;
}

export interface ProjectionProviderSet {
  readonly providers: readonly ProjectionProvider[];
  readonly resolveViews: (from: string) => Record<string, ProjectionView> | undefined;
  readonly resolveCapabilities: (from: string) => Record<string, CapabilityDescriptor> | undefined;
  readonly list: () => ComponentCatalogEntry[];
  readonly describe: (capability: string) => ComponentAuthoringDescription;
  readonly validate: (capability: string, props: unknown) => ComponentValidationReport;
  readonly materialize: (capability: string, variant?: string) => ResolvedNode;
  readonly preflight: (capability: string, props: unknown) => ComponentPreflightReport;
  readonly instructions: (components?: readonly string[]) => string;
  readonly createTools: (components?: readonly string[]) => ComponentAuthoringTool[];
  readonly getKit: (components?: readonly string[]) => ComponentAgentKit;
  readonly agentFacingCatalog: () => AgentFacingCapabilityCatalog;
  readonly definitions: () => Readonly<Record<string, DeclarativeComponentDefinition>>;
}

function mergeRecords<T>(
  providers: readonly ProjectionProvider[],
  select: (provider: ProjectionProvider) => Readonly<Record<string, T>> | undefined,
): ReadonlyMap<string, Readonly<Record<string, T>>> {
  const merged = new Map<string, Readonly<Record<string, T>>>();
  for (const provider of providers) {
    const record = select(provider);
    if (record) merged.set(provider.id, record);
  }
  return merged;
}

function capabilityName(definition: DeclarativeComponentDefinition): string {
  const separator = definition.capability.indexOf(":");
  return separator >= 0 ? definition.capability.slice(separator + 1) : definition.capability;
}

function deriveViews(definitions: Readonly<Record<string, DeclarativeComponentDefinition>>): Readonly<Record<string, ProjectionView>> {
  return Object.fromEntries(
    Object.values(definitions).map((definition) => [capabilityName(definition), definition.component]),
  );
}

function deriveCapabilities(
  definitions: Readonly<Record<string, DeclarativeComponentDefinition>>,
): Readonly<Record<string, CapabilityDescriptor>> {
  return Object.fromEntries(
    Object.values(definitions).map((definition) => [capabilityName(definition), {
      propsSchema: definition.getSchema(),
      ...(definition.dataProp ? { dataProp: definition.dataProp } : {}),
      ...(definition.slots ? { slots: [...definition.slots] } : {}),
      emits: [...definition.events],
    } satisfies CapabilityDescriptor]),
  );
}

export function defineProjectionProvider(config: {
  id: string;
  definitions: Readonly<Record<string, DeclarativeComponentDefinition>>;
}): ProjectionProvider {
  return {
    id: config.id,
    definitions: config.definitions,
    views: deriveViews(config.definitions),
    capabilities: deriveCapabilities(config.definitions),
  };
}

function mergeDefinitions(providers: readonly ProjectionProvider[]): Record<string, DeclarativeComponentDefinition> {
  const merged: Record<string, DeclarativeComponentDefinition> = {};
  for (const provider of providers) {
    const definitions = provider.definitions;
    if (!definitions) continue;
    for (const [name, definition] of Object.entries(definitions)) {
      merged[name] = definition;
    }
  }
  return merged;
}

export function createProjectionProviderSet(providers: readonly ProjectionProvider[]): ProjectionProviderSet {
  const viewRegistry = mergeRecords(providers, (provider) => provider.views);
  const capabilityRegistry = mergeRecords(providers, (provider) => provider.capabilities);
  const mergedDefinitions = mergeDefinitions(providers);
  const authoringApi = createComponentAuthoringApi({
    definitions: mergedDefinitions,
    kind: "projection",
    toolKind: "Projection",
    allowEmptySelection: true,
  });

  return {
    providers,
    resolveViews: (from) => viewRegistry.get(from) as Record<string, ProjectionView> | undefined,
    resolveCapabilities: (from) => capabilityRegistry.get(from) as Record<string, CapabilityDescriptor> | undefined,
    list: () => authoringApi.list(),
    describe: authoringApi.describe,
    validate: authoringApi.validate,
    materialize: authoringApi.materialize,
    preflight: authoringApi.preflight,
    instructions: authoringApi.instructions,
    createTools: authoringApi.createTools,
    getKit: authoringApi.getKit,
    agentFacingCatalog: () => createAgentFacingCapabilityCatalog(mergedDefinitions),
    definitions: () => mergedDefinitions,
  };
}