import type { HostedBlueprintResolutionContext } from "@gik-ai/blueprint";
import type { BlueprintProposalStore } from "@gik-ai/blueprint-agent-host";
import type { ReactBlueprintHostRegistry } from "@gik-ai/react";
import type { UseProposal } from "./blueprint-agent-lifecycle";
import { resolveBlueprintNative } from "./blueprint-runtime";
import { getSampleBlueprintCatalog } from "../../../bootstrap/catalog/blueprint-catalog";
import type { BlueprintStorageConnectionFactory } from "../../../shared/blueprint-storage";
import {
  resolveBlueprintDatabaseArtifact,
  resolveBlueprintDatabaseRoot,
} from "../../../shared/blueprint-database-registry";

export interface SampleBlueprintHostRegistryOptions {
  createProposalStore?: (
    blueprintId: string,
    context: HostedBlueprintResolutionContext,
  ) => BlueprintProposalStore<UseProposal>;
  blueprintStorage?: BlueprintStorageConnectionFactory;
  blueprintStorageRootInstanceId?: string;
}

export function createSampleBlueprintHostRegistry(
  options: SampleBlueprintHostRegistryOptions = {},
): ReactBlueprintHostRegistry {
  const blueprintDatabaseRoots = new Set<string>();
  const resolveArtifact = (reference: Parameters<ReactBlueprintHostRegistry["resolveArtifact"]>[0]) => {
    const blueprint = getSampleBlueprintCatalog().entries[reference.id];
    if (!blueprint) throw new Error(`Unknown hosted Blueprint '${reference.id}'`);
    if (reference.version !== undefined && blueprint.payload.version !== reference.version) {
      throw new Error(
        `Hosted Blueprint '${reference.id}' version '${reference.version}' is unavailable; host has '${blueprint.payload.version}'`,
      );
    }
    return blueprint;
  };
  return {
    resolveArtifact,
    async resolve(reference, context) {
      const resolvedDatabaseRootInstanceId = resolveBlueprintDatabaseRoot(
        context,
        blueprintDatabaseRoots,
      );
      const blueprintDatabaseRootInstanceId = resolvedDatabaseRootInstanceId
        ? options.blueprintStorageRootInstanceId ?? resolvedDatabaseRootInstanceId
        : undefined;
      const repositoryBlueprint = getSampleBlueprintCatalog().seedEntries[reference.id];
      const storedBlueprint = await resolveBlueprintDatabaseArtifact(
        reference,
        blueprintDatabaseRootInstanceId,
        options.blueprintStorage,
      );
      const blueprint = storedBlueprint ?? resolveArtifact(reference);

      const proposalStore = options.createProposalStore?.(reference.id, context);
      return {
        reference: {
          scheme: "blueprint",
          id: reference.id,
          version: blueprint.payload.version,
        },
        blueprint,
        ...(repositoryBlueprint
          ? {
              native: resolveBlueprintNative(reference.id, {
                proposalStore,
                blueprintStorage: options.blueprintStorage,
                instanceId: `${context.parentInstanceId}/cells/${context.cellId}`,
              }),
            }
          : {}),
      };
    },
  };
}