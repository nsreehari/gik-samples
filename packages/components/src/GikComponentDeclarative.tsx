import React from "react";
import {
  authorProjectedProgram,
  type Action,
  type CapabilityDescriptor,
  type DocNode,
  type Json,
  type ProjectedVocabularyManifest,
} from "gik-kernel";
import {
  BundleHost,
  bundleFromJson,
  type Bundle,
  type BundleContextBindings,
  type EffectHandlerMap,
  type ProjectionView,
  type ProviderResolver,
} from "gik-react";

import { fluentComponentDefinitions } from "./fluent/registry";
import { primitiveComponentDefinitions } from "./primitives/registry";
import { semanticComponentDefinitions } from "./semantic/registry";
import { securityComponentDefinitions } from "./security/registry";
import { softwareComponentDefinitions } from "./software/registry";
import {
  createProjectionProviderSet,
  defineProjectionProvider,
  type ProjectionProvider,
} from "./shared/provider-set";

const DECLARATIVE_ACTIONS = ["assign", "assignFrom", "derive", "invoke", "route", "confirm", "emit"];

export const fluentProjectionProvider: ProjectionProvider = defineProjectionProvider({
  id: "fluent",
  definitions: fluentComponentDefinitions,
});

export const primitiveProjectionProvider: ProjectionProvider = defineProjectionProvider({
  id: "primitive",
  definitions: primitiveComponentDefinitions,
});

export const semanticProjectionProvider: ProjectionProvider = defineProjectionProvider({
  id: "semantic",
  definitions: semanticComponentDefinitions,
});

export const securityProjectionProvider: ProjectionProvider = defineProjectionProvider({
  id: "security",
  definitions: securityComponentDefinitions,
});

export const softwareProjectionProvider: ProjectionProvider = defineProjectionProvider({
  id: "software",
  definitions: softwareComponentDefinitions,
});

function resolveProjectionViews(
  from: string,
  providerSet: ReturnType<typeof createProjectionProviderSet>,
  resolveProvider?: ProviderResolver,
): Record<string, ProjectionView> | undefined {
  return providerSet.resolveViews(from) ?? resolveProvider?.(from);
}

function resolveProjectionCapabilities(
  from: string,
  providerSet: ReturnType<typeof createProjectionProviderSet>,
  resolveCapabilityDescriptors?: (from: string) => Record<string, CapabilityDescriptor> | undefined,
): Record<string, CapabilityDescriptor> | undefined {
  return providerSet.resolveCapabilities(from) ?? resolveCapabilityDescriptors?.(from);
}

export interface GikComponentRuntimeProviderProps {
  children: React.ReactNode;
  state?: Record<string, Json>;
  effectHandlers?: EffectHandlerMap;
  contexts?: BundleContextBindings;
  providers?: readonly ProjectionProvider[];
  resolveProvider?: ProviderResolver;
  resolveCapabilityDescriptors?: (from: string) => Record<string, CapabilityDescriptor> | undefined;
}

interface GikComponentRuntimeValue {
  state: Record<string, Json>;
  effectHandlers: EffectHandlerMap;
  contexts: BundleContextBindings;
  providers: readonly ProjectionProvider[];
  resolveProvider?: ProviderResolver;
  resolveCapabilityDescriptors?: (from: string) => Record<string, CapabilityDescriptor> | undefined;
}

const GikComponentRuntimeContext = React.createContext<GikComponentRuntimeValue>({
  state: {},
  effectHandlers: {},
  contexts: {},
  providers: [],
});

export function GikComponentRuntimeProvider({
  children,
  state = {},
  effectHandlers = {},
  contexts = {},
  providers = [],
  resolveProvider,
  resolveCapabilityDescriptors,
}: GikComponentRuntimeProviderProps): React.ReactElement {
  const value = React.useMemo(
    () => ({ state, effectHandlers, contexts, providers, resolveProvider, resolveCapabilityDescriptors }),
    [state, effectHandlers, contexts, providers, resolveProvider, resolveCapabilityDescriptors],
  );
  return <GikComponentRuntimeContext.Provider value={value}>{children}</GikComponentRuntimeContext.Provider>;
}

export interface GikComponentDeclarativeProps {
  nodeJson: Json;
  providers?: readonly ProjectionProvider[];
}

function assertDocNode(value: Json): asserts value is Json & DocNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GikComponentDeclarative nodeJson must be a JSON object");
  }
  const candidate = value as Record<string, Json>;
  if (typeof candidate.id !== "string" || typeof candidate.capability !== "string") {
    throw new Error("GikComponentDeclarative nodeJson requires string id and capability fields");
  }
}

function childNodes(node: DocNode): DocNode[] {
  return node.edges?.children ?? [];
}

function visitNodes(node: DocNode, visit: (current: DocNode) => void): void {
  visit(node);
  for (const child of childNodes(node)) visitNodes(child, visit);
}

function actionsIn(node: DocNode): Action[] {
  return Object.values(node.edges?.on ?? {}).flat();
}

function componentContract(
  capability: string,
  providerSet: ReturnType<typeof createProjectionProviderSet>,
  resolveCapabilityDescriptors?: (from: string) => Record<string, CapabilityDescriptor> | undefined,
) {
  const separator = capability.indexOf(":");
  const layer = capability.slice(0, separator);
  const name = capability.slice(separator + 1);
  const descriptor = resolveProjectionCapabilities(layer, providerSet, resolveCapabilityDescriptors)?.[name];
  if (descriptor) return { layer, name, descriptor };
  throw new Error(`GikComponentDeclarative does not recognize capability: ${capability}`);
}

export function createGikComponentDeclarativeBundle(
  nodeJson: Json,
  runtime: Pick<GikComponentRuntimeValue, "state" | "effectHandlers" | "contexts" | "providers" | "resolveCapabilityDescriptors"> = {
    state: {},
    effectHandlers: {},
    contexts: {},
    providers: [],
  },
): Bundle {
  assertDocNode(nodeJson);
  const root = nodeJson as unknown as DocNode;
  const providerSet = createProjectionProviderSet(runtime.providers);
  const capabilities: ProjectedVocabularyManifest["capabilities"] = {};
  const imports = new Map<string, Set<string>>();
  const requiredEffects = new Set<string>();

  visitNodes(root, (node) => {
    const { layer, name, descriptor } = componentContract(node.capability, providerSet, runtime.resolveCapabilityDescriptors);
    capabilities[node.capability] = descriptor;
    const names = imports.get(layer) ?? new Set<string>();
    names.add(name);
    imports.set(layer, names);
    for (const action of actionsIn(node)) {
      const tool = action.do === "invoke" ? action.control.tool : undefined;
      if (typeof tool === "string") requiredEffects.add(tool);
    }
  });

  const vocabulary: ProjectedVocabularyManifest = {
    version: "1.0.0",
    expression: "jsonata",
    namespaces: Object.keys(runtime.state),
    contexts: Object.keys(runtime.contexts),
    actions: DECLARATIVE_ACTIONS,
    capabilities,
    externals: {
      projectionViews: Object.fromEntries(
        [...imports].map(([layer, names]) => [layer, { from: layer, use: [...names] }]),
      ),
      ...(requiredEffects.size > 0 ? { effectHandlers: [...requiredEffects] } : {}),
    },
  };

  return bundleFromJson({
    vocabulary: { gik: "0.1", type: "vocabulary", payload: vocabulary },
    program: authorProjectedProgram(root),
    state: runtime.state,
  }, { effectHandlers: runtime.effectHandlers });
}

export function GikComponentDeclarative({ nodeJson, providers: localProviders = [] }: GikComponentDeclarativeProps): React.ReactElement {
  const runtime = React.useContext(GikComponentRuntimeContext);
  const mergedProviders = React.useMemo(
    () => [...runtime.providers, ...localProviders],
    [localProviders, runtime.providers],
  );
  const providerSet = React.useMemo(
    () => createProjectionProviderSet(mergedProviders),
    [mergedProviders],
  );
  const bundle = React.useMemo(
    () => createGikComponentDeclarativeBundle(nodeJson, { ...runtime, providers: mergedProviders }),
    [mergedProviders, nodeJson, runtime],
  );
  const resolveProvider = React.useCallback<ProviderResolver>(
    (from) => resolveProjectionViews(from, providerSet, runtime.resolveProvider),
    [providerSet, runtime.resolveProvider],
  );
  const signature = JSON.stringify([nodeJson, runtime.state]);

  return (
    <BundleHost
      key={signature}
      bundle={bundle}
      resolveProvider={resolveProvider}
      contexts={runtime.contexts}
    />
  );
}