import type { StorageApi } from "@gik/durable-runtime";
import type { DurableStorageConnection } from "../../../service-kinds";
import { createBrowserBlueprintStorageConnectionFactory } from "../runtime/blueprint-storage";
import {
  validateProvisioningProfile,
  type AgentProvisioningProfile,
} from "./provisioning";

export interface ProvisioningProfileStore {
  read(blueprintId: string): Promise<AgentProvisioningProfile | null>;
  write(profile: AgentProvisioningProfile): Promise<void>;
}

function key(blueprintId: string): string {
  return `provisioning-profile:${encodeURIComponent(blueprintId)}`;
}

export function createProvisioningProfileStoreFromConnection(
  connection: DurableStorageConnection,
): ProvisioningProfileStore {
  const dispatch = (operation: "read" | "write", args: unknown[]) =>
    connection.api.dispatch({
      ref: connection.ref,
      capability: "kv",
      operation,
      args,
    } as Parameters<StorageApi["dispatch"]>[0]);
  return {
    async read(blueprintId) {
      const value = await dispatch("read", [key(blueprintId)]);
      if (value === null || value === undefined) return null;
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Stored provisioning profile for '${blueprintId}' is invalid`);
      }
      return validateProvisioningProfile(value as unknown as AgentProvisioningProfile, blueprintId);
    },
    async write(profile) {
      const validated = validateProvisioningProfile(profile);
      await dispatch("write", [key(validated.blueprintId), validated]);
    },
  };
}

export function createBrowserProvisioningProfileStore(
  durableEnabled: boolean,
): ProvisioningProfileStore {
  const connection = createBrowserBlueprintStorageConnectionFactory(durableEnabled)({
    blueprintId: "agent-provisioning-profiles",
    instanceId: "agent-provisioning-profiles",
  });
  return createProvisioningProfileStoreFromConnection(connection);
}
