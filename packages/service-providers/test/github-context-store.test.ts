import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test, vi } from "vitest";

import {
  CONTEXT_STORE_INGEST_CONTRACT,
  CONTEXT_STORE_QUERY_CONTRACT,
  ServiceKindRegistry,
  UnsatisfiedServiceDependencyError,
  type ServiceKindContext,
  type ServiceRequest,
} from "gik-controlface/services";
import type { Json, NativeServiceDeclaration } from "gik-kernel";
import {
  createGitHubContextStoreServiceKind,
  GitHubContextRecordConflictError,
  type GitHubContextStoreConnection,
  type GitHubContextStoreHttpRequest,
} from "../src/github-context-store";

const settlement = { transform: { kind: "jsonata" as const, expr: "{}" } };
const identity = {
  blueprintId: "test",
  blueprintRevision: "1",
  serviceId: "maintainer-context",
};
const configuredStore = {
  endpoint: "https://api.github.com",
  repository: "owner/backing",
  ref: "refs/heads/context-v1",
  prefix: ".gik-state/context/v1",
  credentialRef: "github/context",
  maxWriteAttempts: 3,
  maxRecordsPerScope: 100,
};

function declaration(operations = ["query", "ingest"]): NativeServiceDeclaration {
  return {
    kind: "github-context-store",
    version: "1",
    config: configuredStore,
    operations: Object.fromEntries(operations.map((operation) => [
      operation,
      {
        operation,
        contract: operation === "query"
          ? CONTEXT_STORE_QUERY_CONTRACT
          : CONTEXT_STORE_INGEST_CONTRACT,
        settlement,
      },
    ])),
  };
}

function request(operation: string, input: Json): ServiceRequest {
  return {
    id: `request-${operation}`,
    service: identity.serviceId,
    operation,
    input,
    providerId: "github-context-store",
    capabilityId: operation === "query"
      ? CONTEXT_STORE_QUERY_CONTRACT
      : CONTEXT_STORE_INGEST_CONTRACT,
    createdAt: "2026-11-13T00:00:00.000Z",
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeGitHubContextRepository implements GitHubContextStoreConnection {
  private readonly blobs = new Map<string, string>();
  private readonly trees = new Map<string, Map<string, string>>([
    ["tree-base", new Map()],
  ]);
  private readonly commits = new Map<string, { tree: string; parent?: string }>([
    ["base", { tree: "tree-base" }],
  ]);
  private sequence = 0;
  head = "base";
  refConflicts = 0;
  refUpdates = 0;

  readonly request = vi.fn(async (input: Readonly<GitHubContextStoreHttpRequest>) => {
    const url = new URL(input.url);
    const path = url.pathname.replace("/repos/owner/backing/", "");
    const body = input.body ? JSON.parse(input.body) as Record<string, unknown> : {};

    if (input.method === "GET" && path === "git/ref/heads/context-v1") {
      return response({ object: { sha: this.head } });
    }
    if (input.method === "GET" && path.startsWith("git/commits/")) {
      const sha = decodeURIComponent(path.slice("git/commits/".length));
      const commit = this.commits.get(sha);
      return commit ? response({ sha, tree: { sha: commit.tree } }) : response({}, 404);
    }
    if (input.method === "GET" && path.startsWith("contents/")) {
      const revision = url.searchParams.get("ref");
      const commit = revision ? this.commits.get(revision) : undefined;
      const repositoryPath = path.slice("contents/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      const content = commit ? this.trees.get(commit.tree)?.get(repositoryPath) : undefined;
      return content === undefined
        ? response({}, 404)
        : response({
          type: "file",
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
        });
    }
    if (input.method === "POST" && path === "git/blobs") {
      const sha = `blob-${++this.sequence}`;
      this.blobs.set(sha, String(body.content));
      return response({ sha }, 201);
    }
    if (input.method === "POST" && path === "git/trees") {
      const base = this.trees.get(String(body.base_tree));
      if (!base || !Array.isArray(body.tree)) return response({}, 422);
      const next = new Map(base);
      for (const raw of body.tree) {
        const entry = raw as { path: string; sha: string };
        const content = this.blobs.get(entry.sha);
        if (content === undefined) return response({}, 422);
        next.set(entry.path, content);
      }
      const sha = `tree-${++this.sequence}`;
      this.trees.set(sha, next);
      return response({ sha }, 201);
    }
    if (input.method === "POST" && path === "git/commits") {
      const parents = body.parents;
      if (!Array.isArray(parents) || typeof parents[0] !== "string"
        || !this.trees.has(String(body.tree))) {
        return response({}, 422);
      }
      const sha = `commit-${++this.sequence}`;
      this.commits.set(sha, { tree: String(body.tree), parent: parents[0] });
      return response({ sha }, 201);
    }
    if (input.method === "PATCH" && path === "git/refs/heads/context-v1") {
      this.refUpdates += 1;
      const revision = String(body.sha);
      if (this.refConflicts > 0) {
        this.refConflicts -= 1;
        const current = this.commits.get(this.head);
        assert.ok(current);
        const sibling = `external-${++this.sequence}`;
        this.commits.set(sibling, { tree: current.tree, parent: this.head });
        this.head = sibling;
        return response({ message: "Update is not a fast forward" }, 422);
      }
      if (body.force !== false || this.commits.get(revision)?.parent !== this.head) {
        return response({ message: "Update is not a fast forward" }, 422);
      }
      this.head = revision;
      return response({ object: { sha: revision } });
    }
    return response({ message: `Unhandled ${input.method} ${path}` }, 500);
  });
}

function fixture(
  connection: GitHubContextStoreConnection,
  authorize: NonNullable<ServiceKindContext["authorizeEndpoint"]> = () => true,
) {
  const clear = vi.fn();
  const resolve = vi.fn(async () => connection);
  const endpoint = vi.fn(authorize);
  const registry = new ServiceKindRegistry({
    resolveCredential: resolve,
    clearCredential: clear,
    authorizeEndpoint: endpoint,
    inspectDependency: () => ({ state: "ready" }),
  });
  registry.register(createGitHubContextStoreServiceKind());
  return { registry, clear, resolve, endpoint };
}

test("setup derives least GitHub contents permission and validates concrete configuration", async () => {
  const remote = new FakeGitHubContextRepository();
  const context = fixture(remote);
  const setup = await context.registry.describeSetup(identity, declaration(["query"]));
  assert.deepEqual(setup.dependencies[0].requirement.permissions, ["contents:read"]);
  assert.equal(context.resolve.mock.calls.length, 0);
  assert.deepEqual(
    (await context.registry.describeSetup(identity, declaration())).dependencies[0]
      .requirement.permissions,
    ["contents:write"],
  );
  assert.equal((await context.registry.validate({
    ...declaration(),
    config: { ...configuredStore, endpoint: "https://example.invalid" },
  })).ok, false);
  assert.equal((await context.registry.validate({
    ...declaration(),
    config: { ...configuredStore, ref: "refs/heads/../main" },
  })).ok, false);

  const adapter = await context.registry.materialize(identity, declaration());
  assert.deepEqual(await adapter.probe?.({}), {
    ok: true,
    detail: {
      repository: "owner/backing",
      ref: "refs/heads/context-v1",
      revision: "base",
    },
  });
});

test("ingest is immutable and idempotent while query is bounded and revisioned", async () => {
  const remote = new FakeGitHubContextRepository();
  const context = fixture(remote);
  const adapter = await context.registry.materialize(identity, declaration());
  const records = [
    {
      id: "older",
      kind: "assessment",
      observedAt: "2026-11-12T00:00:00.000Z",
      content: { result: "old" },
    },
    {
      id: "newer",
      kind: "assessment",
      observedAt: "2026-11-13T00:00:00.000Z",
      content: { result: "new" },
    },
  ];
  const stored = await adapter.execute(request("ingest", {
    scope: "strategy-group:gik",
    records,
  }), {});
  assert.deepEqual(stored.output, {
    scope: "strategy-group:gik",
    recordIds: ["older", "newer"],
    status: "stored",
  });
  assert.equal(stored.detail?.revision, remote.head);

  const queried = await adapter.execute(request("query", {
    scope: "strategy-group:gik",
    requestKey: "latest",
    query: {},
    limit: 1,
  }), {});
  assert.deepEqual(queried.output, {
    scope: "strategy-group:gik",
    requestKey: "latest",
    records: [records[1]],
  });
  assert.equal(queried.detail?.revision, remote.head);

  const updates = remote.refUpdates;
  await adapter.execute(request("ingest", {
    scope: "strategy-group:gik",
    records: [records[1]],
  }), {});
  assert.equal(remote.refUpdates, updates);
  await assert.rejects(
    async () => adapter.execute(request("ingest", {
      scope: "strategy-group:gik",
      records: [{ ...records[1], content: { result: "changed" } }],
    }), {}),
    GitHubContextRecordConflictError,
  );
});

test("ingest rebases only non-fast-forward races and preserves idempotency", async () => {
  const remote = new FakeGitHubContextRepository();
  remote.refConflicts = 1;
  const adapter = await fixture(remote).registry.materialize(identity, declaration());
  const result = await adapter.execute(request("ingest", {
    scope: "strategy-group:gik",
    records: [{
      id: "assessment",
      kind: "assessment",
      observedAt: "2026-11-13T00:00:00.000Z",
    }],
  }), {});
  assert.equal(remote.refUpdates, 2);
  assert.equal(result.detail?.revision, remote.head);
});

test("endpoint denial precedes credential resolution and HTTP 401 clears the connection", async () => {
  const remote = new FakeGitHubContextRepository();
  const denied = fixture(remote, () => false);
  const deniedAdapter = await denied.registry.materialize(identity, declaration(["query"]));
  await assert.rejects(
    async () => deniedAdapter.execute(request("query", {
      scope: "scope",
      requestKey: "request",
      query: {},
      limit: 1,
    }), {}),
    /Host denied/,
  );
  assert.equal(denied.resolve.mock.calls.length, 0);

  const expired = fixture({
    request: async () => response({}, 401),
  });
  const expiredAdapter = await expired.registry.materialize(identity, declaration(["query"]));
  await assert.rejects(
    async () => expiredAdapter.execute(request("query", {
      scope: "scope",
      requestKey: "request",
      query: {},
      limit: 1,
    }), {}),
    (error: unknown) => {
      assert.ok(error instanceof UnsatisfiedServiceDependencyError);
      assert.equal(error.dependencyStatus?.state, "authorization-required");
      return true;
    },
  );
  assert.deepEqual(expired.clear.mock.calls, [["github/context"]]);
});
