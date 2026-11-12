import type { Json } from "gik-kernel";
import type { DurableStorageConnection } from "../durable-storage";

interface ContextRecord {
  id: string;
  kind: string;
  observedAt: string;
  [key: string]: Json;
}

export interface ContextStoreInvocation {
  kind: "context-store";
  storeRef: string;
  operation: "query" | "ingest";
  input: {
    scope: string;
    requestKey?: string;
    query?: { kinds?: string[]; order?: string };
    limit?: number;
    records?: ContextRecord[];
  };
}

export function createContextStoreExecutor(
  connections: Readonly<Record<string, DurableStorageConnection>>,
): (invocation: ContextStoreInvocation) => Promise<Json> {
  return async ({ storeRef, operation, input }): Promise<Json> => {
    const connection = Object.hasOwn(connections, storeRef) ? connections[storeRef] : undefined;
    if (!connection) throw new Error(`Context store '${storeRef}' is not authorized by the host`);
    const prefix = `dpp-context-${await digest(JSON.stringify({ storeRef, scope: input.scope }))}-`;
    const dispatch = (operation: "read" | "write" | "listKeys", args: Json[]) =>
      connection.api.dispatch({ ref: connection.ref, capability: "kv", operation, args });
    if (operation === "ingest") {
      const records = input.records ?? [];
      for (const record of records) {
        const key = prefix + await digest(record.id);
        const existing = await dispatch("read", [key]);
        if (existing === null || existing === undefined) {
          await dispatch("write", [key, record]);
        }
      }
      return { scope: input.scope, recordIds: records.map(({ id }) => id), status: "stored" };
    }
    if (operation !== "query") throw new Error(`Unsupported context-store operation '${operation}'`);
    if (!Number.isInteger(input.limit) || input.limit! < 1 || input.limit! > 1000) {
      throw new Error("Context query limit must be an integer between 1 and 1000");
    }
    const query = input.query ?? {};
    if (Object.keys(query).some((key) => key !== "kinds" && key !== "order")
      || (query.order !== undefined && query.order !== "observedAt-desc")
      || (query.kinds !== undefined && (!Array.isArray(query.kinds)
        || query.kinds.some((kind) => typeof kind !== "string" || !kind.trim())))) {
      throw new Error("Sample context queries support only kinds and observedAt-desc ordering");
    }
    const keys = await dispatch("listKeys", [prefix]) as string[];
    const records: ContextRecord[] = [];
    for (const key of keys.filter((key) => key.startsWith(prefix))) {
      const record = await dispatch("read", [key]) as ContextRecord | undefined;
      if (record && (!query.kinds || query.kinds.includes(record.kind))) records.push(record);
    }
    records.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));
    return {
      scope: input.scope,
      requestKey: input.requestKey!,
      records: records.slice(0, input.limit),
    };
  };
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
