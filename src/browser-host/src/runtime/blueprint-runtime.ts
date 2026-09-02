import type { BundleNative } from "@gik-ai/react";
import type { ExternalContext, MaterializedBlueprint } from "@gik-ai/blueprint";
import type { Json } from "@gik-ai/kernel";
import { openBlueprint } from "@gik-ai/controlface/blueprint";
import { openSampleBlueprint, resolveSampleLaunchExternalContext } from "../../../bootstrap/catalog/blueprint-catalog";
import { browserServiceRegistryOptions, declarativeServiceOrchestrator } from "./service-host";
import { createBrowserBlueprintStorageConnectionFactory } from "./blueprint-storage";
import type { BlueprintProposalStore } from "@gik-ai/blueprint-agent-host";
import type { UseProposal } from "./blueprint-agent-lifecycle";
import type { BlueprintStorageConnectionFactory } from "../../../shared/blueprint-storage";
import type { SampleServiceRegistryOptions } from "../../../service-kinds";

export interface ResolveBlueprintNativeOptions {
  proposalStore?: BlueprintProposalStore<UseProposal>;
  instanceId?: string;
  blueprintStorage?: BlueprintStorageConnectionFactory;
  registryOptions?: SampleServiceRegistryOptions;
}

export function resolveBlueprintNative(id: string, options: ResolveBlueprintNativeOptions = {}): BundleNative {
  const runtime = openSampleBlueprint(id);
  return resolveBlueprintNativeFromRuntime(id, runtime, options);
}

export function resolveBlueprintNativeFromMaterialized(
  id: string,
  materializedBlueprint: MaterializedBlueprint,
  options: ResolveBlueprintNativeOptions = {},
): BundleNative {
  return resolveBlueprintNativeFromRuntime(
    id,
    openBlueprint(materializedBlueprint.payload.terminalBlueprint),
    options,
  );
}

function resolveBlueprintNativeFromRuntime(
  id: string,
  runtime: ReturnType<typeof openSampleBlueprint>,
  options: ResolveBlueprintNativeOptions,
): BundleNative {
  const serviceOrchestrator = declarativeServiceOrchestrator(runtime, {
    registryOptions: {
      ...browserServiceRegistryOptions,
      ...options.registryOptions,
    },
    proposalStore: options.proposalStore,
    hostPolicy: { dependencyFailurePolicy: "throw" },
    instanceId: options.instanceId ?? id,
    blueprintStorage: options.blueprintStorage
      ?? createBrowserBlueprintStorageConnectionFactory(false),
  });
  return {
    wrapOrchestrator: serviceOrchestrator,
  };
}

export function resolveBlueprintInitialContext(
  id: string,
  externalContext?: ExternalContext,
): Record<string, Json> {
  const launchContext = externalContext ?? resolveSampleLaunchExternalContext(id);
  const runtime = openSampleBlueprint(id, launchContext);
  return {
    initialSeed: structuredClone({ ...runtime.state, ...launchContext }) as Json,
  };
}
