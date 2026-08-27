import {
  createIndexedDbStorageApi,
  createIndexedDbStorageRef,
} from "@gik-ai/durable-runtime/storage/indexed-db/api";
import {
  createMemoryStorageApi,
  createMemoryStorageRef,
} from "@gik-ai/durable-runtime/storage/memory";

import {
  createBlueprintStorageConnectionFactory,
  type BlueprintStorageConnectionFactory,
} from "../../../shared/blueprint-storage";

export function createBrowserBlueprintStorageConnectionFactory(
  durableEnabled: boolean,
): BlueprintStorageConnectionFactory {
  return durableEnabled
    ? createBlueprintStorageConnectionFactory(
        createIndexedDbStorageApi({ databaseName: "gik-samples-host" }),
        createIndexedDbStorageRef,
      )
    : createBlueprintStorageConnectionFactory(
        createMemoryStorageApi(),
        createMemoryStorageRef,
      );
}
