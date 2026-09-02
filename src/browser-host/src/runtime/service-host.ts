import {
  DefaultServiceHost,
  type DefaultServiceHostOptions,
} from "gik-controlface/services";
import { executeQueuedCellSourceEffect } from "gik-blueprint/worker";
import type { BlueprintRuntime } from "gik-controlface/blueprint";
import {
  JsonataExpressionProvider,
  type Json,
  unwrap,
  type ServiceDeclaration,
  type StateModel,
} from "gik-kernel";
import type { LoadBundleOptions } from "gik-react";
import {
  createSampleServiceKindRegistry,
  type SampleServiceRegistryOptions,
} from "../../../service-kinds";
import { executeMcpServiceInvocation } from "../../../service-kinds/mcp/runtime";
import {
  clearBrowserCredential,
  resolveBrowserCredential,
} from "./browser-credentials";
import { createSampleServiceRegistryOptions } from "../../../service-kinds/registry-options";
import { createBlueprintAgentLifecycle, type UseProposal } from "./blueprint-agent-lifecycle";
import { createSampleAgentTools } from "../../../shared/agent-tools";
import type { BlueprintProposalStore } from "gik-blueprint-agent-host";
import { createBlueprintServiceResolver } from "../../../shared/blueprint-service-resolver";
import { createSampleCatalogBlueprintRegistry } from "../../../bootstrap/catalog/blueprint-catalog";
import { runWithBrowserServiceDependencies } from "./service-dependency-access";
import {
  bindBlueprintStorage,
  type BlueprintStorageConnectionFactory,
} from "../../../shared/blueprint-storage";
import { getSampleBlueprintCatalog } from "../../../bootstrap/catalog/blueprint-catalog";
import {
  authorizeTrustedServiceEndpoint,
  trustedServiceEndpointOrigins,
} from "../../../bootstrap/catalog/trusted-service-endpoints";

export const browserServiceRegistryOptions = createSampleServiceRegistryOptions({
  resolveCredential: resolveBrowserCredential,
  clearCredential: clearBrowserCredential,
}, {
  authorizeEndpoint: (kind, endpoint) =>
    authorizeTrustedServiceEndpoint(
      trustedServiceEndpointOrigins(getSampleBlueprintCatalog().seedEntries),
      kind,
      endpoint,
    ),
});

function mergeRegistryOptions(
  registryOptions: SampleServiceRegistryOptions = {},
  state?: StateModel
): SampleServiceRegistryOptions {
  const execute = registryOptions.execute ?? browserServiceRegistryOptions.execute;
  return {
    ...browserServiceRegistryOptions,
    ...registryOptions,
    hostCapabilities: [
      ...new Set([
        ...(browserServiceRegistryOptions.hostCapabilities ?? []),
        ...(registryOptions.hostCapabilities ?? []),
      ]),
    ],
    execute: execute && state
      ? (request) => {
          const invocation = request as Parameters<typeof executeMcpServiceInvocation>[0];
          if (invocation.kind !== "mcp") return execute(request);
          const config = invocation.declaration.config as Record<string, Json> | undefined;
          const serverStatePath = String(config?.serverStatePath ?? "").trim();
          const server = serverStatePath ? String(state.get(serverStatePath) ?? "").trim() : "";
          if (!server) return execute(request);
          return execute({
            ...invocation,
            declaration: {
              ...invocation.declaration,
              config: { ...config, server },
            },
          });
        }
      : execute,
  };
}

interface BlueprintServiceHostOptions {
  registryOptions?: SampleServiceRegistryOptions;
  proposalStore?: BlueprintProposalStore<UseProposal>;
  hostPolicy?: Pick<DefaultServiceHostOptions, "dependencyFailurePolicy">;
  instanceId?: string;
  blueprintStorage: BlueprintStorageConnectionFactory;
}

function createBlueprintServiceHost(
  runtime: BlueprintRuntime,
  state: StateModel,
  options: BlueprintServiceHostOptions,
): DefaultServiceHost {
  const {
    registryOptions = {},
    proposalStore,
    hostPolicy = {},
    instanceId = runtime.blueprintId,
    blueprintStorage,
  } = options;
  const manifest = unwrap(runtime.vocabulary);
  const declarations = (manifest.externals?.services ?? {}) as Record<string, ServiceDeclaration>;
  const agentLifecycle = createBlueprintAgentLifecycle(runtime, state, { proposalStore });
  const mergedOptions = mergeRegistryOptions(registryOptions, state);
  const rootOptions = bindBlueprintStorage(
    mergedOptions,
    blueprintStorage,
    { blueprintId: runtime.blueprintId, instanceId },
  );
  return new DefaultServiceHost({
    blueprintId: runtime.blueprintId,
    blueprintRevision: runtime.revision,
    declarations,
    registry: createSampleServiceKindRegistry(rootOptions),
    blueprintServices: createBlueprintServiceResolver({
      registry: createSampleCatalogBlueprintRegistry(),
      instanceId,
      createServiceRegistry: (context) => createSampleServiceKindRegistry(bindBlueprintStorage(
        mergedOptions,
        blueprintStorage,
        context,
      )),
    }),
    state,
    expression: new JsonataExpressionProvider({ safe: true }),
    agentTools: [...createSampleAgentTools(), ...agentLifecycle.tools],
    inProgressProposalSettlement: agentLifecycle.settle,
    ...hostPolicy,
  });
}

export type DeclarativeServiceOrchestratorOptions = BlueprintServiceHostOptions;

export function declarativeServiceOrchestrator(
  runtime: BlueprintRuntime,
  options: DeclarativeServiceOrchestratorOptions,
): NonNullable<LoadBundleOptions["wrapOrchestrator"]> {
  return (fallback, state) => {
    const host = createBlueprintServiceHost(runtime, state, options);
    const declarations = (unwrap(runtime.vocabulary).externals?.services ?? {}) as Record<string, ServiceDeclaration>;
    const serviceInvokes = new Set(Object.values(declarations).flatMap((declaration) => Object.keys(declaration.operations)));
    return {
      invoke: (effect, control) => effect.kind === "invoke" && serviceInvokes.has(effect.control.tool)
        ? executeQueuedCellSourceEffect(
            effect,
            state.snapshot(),
            (executingEffect) => runWithBrowserServiceDependencies(() => host.invoke(executingEffect)),
          )
        : fallback?.invoke?.(effect, control) ?? Promise.resolve(),
      request: fallback?.request?.bind(fallback),
      route: fallback?.route?.bind(fallback),
      compensate: fallback?.compensate?.bind(fallback),
    };
  };
}