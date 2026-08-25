import type { StorageApi } from "@gik/durable-runtime";
import type { Json } from "@gik/kernel";

import type { DurableStorageConnection } from "../../service-kinds";

const BOOTSTRAP_MARKER_KEY = "$gik.bootstrap-assets";

export interface BlueprintBootstrapAssets {
  format: "gik-blueprint-bootstrap-assets/1";
  records: Array<{ key: string; value: Json }>;
}

export function parseBlueprintBootstrapAssets(value: unknown): BlueprintBootstrapAssets {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Blueprint bootstrap assets must be an object.");
  }
  const source = value as Record<string, unknown>;
  if (source.format !== "gik-blueprint-bootstrap-assets/1" || !Array.isArray(source.records)) {
    throw new Error("Blueprint bootstrap assets are invalid.");
  }
  const records = source.records.map((record) => {
    if (!record
      || typeof record !== "object"
      || Array.isArray(record)
      || typeof (record as Record<string, unknown>).key !== "string"
      || !(record as Record<string, unknown>).key
      || !Object.prototype.hasOwnProperty.call(record, "value")) {
      throw new Error("Blueprint bootstrap assets contain an invalid record.");
    }
    return {
      key: (record as Record<string, unknown>).key as string,
      value: structuredClone((record as Record<string, unknown>).value) as Json,
    };
  });
  if (new Set(records.map(({ key }) => key)).size !== records.length) {
    throw new Error("Blueprint bootstrap assets contain duplicate keys.");
  }
  return { format: "gik-blueprint-bootstrap-assets/1", records };
}

export function createBootstrapStorageConnection(
  api: StorageApi,
  ref: string,
  assets?: BlueprintBootstrapAssets,
): DurableStorageConnection {
  let initialized: Promise<void> | undefined;
  const initialize = () => initialized ??= initializeBootstrapAssets(api, ref, assets);
  return {
    ref,
    api: {
      async dispatch(request) {
        await initialize();
        return api.dispatch(request);
      },
    },
  };
}

async function initializeBootstrapAssets(
  api: StorageApi,
  ref: string,
  assets?: BlueprintBootstrapAssets,
): Promise<void> {
  if (!assets) return;
  const marker = await api.dispatch({
    ref,
    capability: "kv",
    operation: "read",
    args: [BOOTSTRAP_MARKER_KEY],
  });
  if (marker !== null && marker !== undefined) return;

  for (const record of assets.records) {
    if (record.key === BOOTSTRAP_MARKER_KEY) {
      throw new Error(`Blueprint bootstrap asset key '${BOOTSTRAP_MARKER_KEY}' is reserved`);
    }
    if (!await hasValue(api, ref, record.key)) {
      await api.dispatch({
        ref,
        capability: "kv",
        operation: "write",
        args: [record.key, record.value],
      });
    }
  }
  await api.dispatch({
    ref,
    capability: "kv",
    operation: "write",
    args: [BOOTSTRAP_MARKER_KEY, { format: assets.format }],
  });
}

async function hasValue(api: StorageApi, ref: string, key: string): Promise<boolean> {
  const value = await api.dispatch({
    ref,
    capability: "kv",
    operation: "read",
    args: [key],
  });
  return value !== null && value !== undefined;
}
