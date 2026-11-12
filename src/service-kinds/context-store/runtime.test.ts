import assert from "node:assert/strict";
import { test } from "vitest";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Json } from "gik-kernel";
import { createFilesystemStorageLibrary } from "gik-durable-runtime/storage/filesystem/library";
import { createFilesystemStorageDispatcher } from "gik-durable-runtime/storage/filesystem/api";
import type { DurableStorageConnection } from "../durable-storage";
import { createContextStoreExecutor, type ContextStoreInvocation } from "./runtime";

test("context backend persists idempotent observations and queries only the authorized store and scope", async () => {
  const values = new Map<string, Json>();
  const connection: DurableStorageConnection = {
    ref: "test:portfolio",
    api: {
      async dispatch({ operation, args = [] }) {
        const key = String(args[0]);
        if (operation === "read") return values.get(key);
        if (operation === "write") {
          values.set(key, args[1] as Json);
          return null;
        }
        if (operation === "listKeys") return [...values.keys()].filter((value) => value.startsWith(key));
        throw new Error(`Unexpected operation '${operation}'`);
      },
    },
  };
  const execute = createContextStoreExecutor({ "portfolio-context": connection });
  const records: NonNullable<ContextStoreInvocation["input"]["records"]> = [
    { id: "first", kind: "portfolio-observation", observedAt: "2026-01-01T00:00:00Z", content: { value: 100 } },
    { id: "latest", kind: "portfolio-observation", observedAt: "2026-01-02T00:00:00Z", content: { value: 120 } },
    { id: "other-kind", kind: "decision", observedAt: "2026-01-03T00:00:00Z" },
  ];
  assert.deepEqual(await execute({
    kind: "context-store", storeRef: "portfolio-context", operation: "ingest",
    input: { scope: "portfolio:one", records },
  }), { scope: "portfolio:one", recordIds: ["first", "latest", "other-kind"], status: "stored" });
  await execute({
    kind: "context-store", storeRef: "portfolio-context", operation: "ingest",
    input: { scope: "portfolio:one", records: [{ ...records[0], observedAt: "2026-02-01T00:00:00Z" }] },
  });

  const reopened = createContextStoreExecutor({ "portfolio-context": connection });
  const query = {
    kind: "context-store" as const, storeRef: "portfolio-context", operation: "query" as const,
    input: {
      scope: "portfolio:one", requestKey: "snapshot:2",
      query: { kinds: ["portfolio-observation"], order: "observedAt-desc" }, limit: 1,
    },
  };
  assert.deepEqual(await reopened(query), {
    scope: "portfolio:one", requestKey: "snapshot:2", records: [records[1]],
  });
  assert.deepEqual(await reopened({ ...query, input: { ...query.input, scope: "portfolio:two" } }), {
    scope: "portfolio:two", requestKey: "snapshot:2", records: [],
  });
  assert.equal(values.size, 3);
  await assert.rejects(reopened({ ...query, storeRef: "unauthorized" }), /not authorized/);
  await assert.rejects(reopened({ ...query, input: { ...query.input, limit: 0 } }), /limit/);
  await assert.rejects(reopened({ ...query, input: { ...query.input, query: { order: "unsupported" } } }), /support only/);
});

test("context records survive a reopened filesystem store with retry-stable, portable storage keys", async () => {
  const rootDir = resolve(`.gik-context-test-${crypto.randomUUID()}`);
  const open = () => {
    const library = createFilesystemStorageLibrary({ rootDir });
    return createContextStoreExecutor({
      "portfolio-context": {
        ref: library.createRef("portfolio"),
        api: createFilesystemStorageDispatcher(library),
      },
    });
  };
  const record = {
    id: `observation:${JSON.stringify({ snapshot: "x".repeat(1000) })}`,
    kind: "portfolio-observation",
    observedAt: "2026-01-01T00:00:00Z",
    content: { value: 900 },
  };
  try {
    const ingest = {
      kind: "context-store" as const, storeRef: "portfolio-context", operation: "ingest" as const,
      input: { scope: "portfolio:one", records: [record] },
    };
    const expected = { scope: "portfolio:one", recordIds: [record.id], status: "stored" };
    assert.deepEqual(await open()(ingest), expected);
    assert.deepEqual(await open()({
      ...ingest, input: { ...ingest.input, records: [{ ...record, observedAt: "2026-02-01T00:00:00Z" }] },
    }), expected);
    assert.deepEqual(await open()({
      kind: "context-store", storeRef: "portfolio-context", operation: "query",
      input: { scope: "portfolio:one", requestKey: "snapshot", query: {}, limit: 10 },
    }), { scope: "portfolio:one", requestKey: "snapshot", records: [record] });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
