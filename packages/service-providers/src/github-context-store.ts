import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  CONTEXT_STORE_INGEST_CONTRACT,
  CONTEXT_STORE_MAX_QUERY_LIMIT,
  CONTEXT_STORE_QUERY_CONTRACT,
  contextStoreIngestInputSchema,
  contextStoreIngestOutputSchema,
  contextStoreQueryInputSchema,
  contextStoreQueryOutputSchema,
  requireServiceDependency,
  serviceConfig,
  UnsatisfiedServiceDependencyError,
  type ContextRecord,
  type ContextStoreIngestInput,
  type ContextStoreIngestOutput,
  type ContextStoreQueryInput,
  type ContextStoreQueryOutput,
  type ServiceDependencyRequirement,
  type ServiceKindContext,
  type ServiceKindFactory,
  type ServiceRequest,
} from "gik-controlface/services";
import type { Json, NativeServiceDeclaration } from "gik-kernel";
import { integer, isJson, keys, object, text } from "./values";

const provider = { id: "github-context-store", version: "1" };
const recordMode = "100644";
const recordType = "blob";
const defaultMaxRecordsPerScope = 1000;
const defaultMaxWriteAttempts = 3;

export interface GitHubContextStoreHttpRequest {
  url: string;
  method: "GET" | "POST" | "PATCH";
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal: AbortSignal;
}

/** The host owns authentication and adds it inside this connection. */
export interface GitHubContextStoreConnection {
  request(request: Readonly<GitHubContextStoreHttpRequest>): Promise<Response>;
}

export class GitHubContextRecordConflictError extends Error {
  readonly code = "github-context-record-conflict";

  constructor(recordId: string) {
    super(`GitHub context record '${recordId}' already exists with different content`);
    this.name = "GitHubContextRecordConflictError";
  }
}

export class GitHubContextStoreRevisionConflictError extends Error {
  readonly code = "github-context-store-revision-conflict";

  constructor(readonly ref: string, readonly attempts: number) {
    super(`GitHub context ref '${ref}' changed during ${attempts} write attempts`);
    this.name = "GitHubContextStoreRevisionConflictError";
  }
}

interface GitHubContextStoreConfig {
  endpoint: string;
  repository: string;
  ref: string;
  prefix: string;
  credentialRef: string;
  maxRecordsPerScope: number;
  maxWriteAttempts: number;
}

interface ScopeIndex {
  format: "gik-github-context-recent/1";
  scope: string;
  records: Array<{ id: string; observedAt: string }>;
}

interface GitHubApiObject {
  sha: string;
}

interface GitHubRefResponse {
  object: GitHubApiObject;
}

interface GitHubCommitResponse extends GitHubApiObject {
  tree: GitHubApiObject;
}

interface GitHubContentResponse {
  type: "file";
  encoding: "base64";
  content: string;
}

function isConnection(value: unknown): value is GitHubContextStoreConnection {
  return !!value && typeof value === "object"
    && "request" in value && typeof value.request === "function";
}

function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function serialize(value: unknown): string {
  if (!isJson(value)) throw new Error("GitHub context value must be JSON data");
  return `${JSON.stringify(canonical(value))}\n`;
}

function jsonValue(value: unknown, label: string): Json {
  if (!isJson(value)) throw new Error(`${label} must be JSON data`);
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function repositoryParts(repository: string): [string, string] {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error("GitHub context repository must be an owner/name pair");
  }
  return [parts[0], parts[1]];
}

function normalizedRef(value: string): string {
  if (!value.startsWith("refs/heads/")) {
    throw new Error("GitHub context ref must start with 'refs/heads/'");
  }
  const branch = value.slice("refs/heads/".length);
  if (!branch || branch.startsWith("/") || branch.endsWith("/")
    || branch.includes("//") || branch.split("/").some((part) =>
      !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("GitHub context ref contains an unsafe branch name");
  }
  return `heads/${branch}`;
}

function normalizedPrefix(value: string): string {
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\\")
    || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("GitHub context prefix must be a safe repository-relative path");
  }
  return value;
}

function config(declaration: NativeServiceDeclaration): GitHubContextStoreConfig {
  const value = serviceConfig(declaration);
  const endpoint = text(value.endpoint, "endpoint");
  if (endpoint !== "https://api.github.com") {
    throw new Error("GitHub context endpoint must be https://api.github.com");
  }
  return {
    endpoint,
    repository: text(value.repository, "repository"),
    ref: text(value.ref, "ref"),
    prefix: normalizedPrefix(text(value.prefix, "prefix")),
    credentialRef: text(value.credentialRef, "credentialRef"),
    maxRecordsPerScope: integer(
      value.maxRecordsPerScope ?? defaultMaxRecordsPerScope,
      "maxRecordsPerScope",
      1,
      5000,
    ),
    maxWriteAttempts: integer(
      value.maxWriteAttempts ?? defaultMaxWriteAttempts,
      "maxWriteAttempts",
      1,
      5,
    ),
  };
}

function credentialRequirement(declaration: NativeServiceDeclaration): ServiceDependencyRequirement {
  const configured = config(declaration);
  const writes = Object.values(declaration.operations)
    .some(({ operation }) => operation === "ingest");
  return {
    id: "github-context-repository",
    kind: "credential",
    title: "GitHub context repository",
    description: "Host-managed GitHub App connection for the declared context repository and ref",
    ref: configured.credentialRef,
    scheme: "github-app",
    permissions: [writes ? "contents:write" : "contents:read"],
  };
}

function validatedRecord(value: unknown): ContextRecord {
  if (!isJson(value)) throw new Error("GitHub context record must be JSON data");
  const record = object(value, "GitHub context record");
  const id = text(record.id, "record id");
  const kind = text(record.kind, "record kind");
  const observedAt = text(record.observedAt, "record observedAt");
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new Error("GitHub context record observedAt must be an ISO timestamp");
  }
  if (record.references !== undefined && !Array.isArray(record.references)) {
    throw new Error("GitHub context record references must be an array");
  }
  const result: ContextRecord = { id, kind, observedAt };
  for (const [key, entry] of Object.entries(record)) {
    if (!isJson(entry)) throw new Error(`GitHub context record field '${key}' is not JSON data`);
    result[key] = entry;
  }
  return result;
}

function jsonObject(value: unknown, label: string): Record<string, Json> {
  const source = object(value, label);
  const result: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!isJson(entry)) throw new Error(`${label} field '${key}' is not JSON data`);
    result[key] = entry;
  }
  return result;
}

function queryInput(value: unknown): ContextStoreQueryInput {
  const input = object(value, "GitHub context query");
  keys(input, ["scope", "requestKey", "query", "limit"]);
  return {
    scope: text(input.scope, "scope"),
    requestKey: text(input.requestKey, "requestKey"),
    query: jsonObject(input.query, "query"),
    limit: integer(input.limit, "limit", 1, CONTEXT_STORE_MAX_QUERY_LIMIT),
  };
}

function ingestInput(value: unknown): ContextStoreIngestInput {
  const input = object(value, "GitHub context ingestion");
  keys(input, ["scope", "records"]);
  if (!Array.isArray(input.records)) throw new Error("GitHub context records must be an array");
  const records = input.records.map(validatedRecord);
  const identities = new Map<string, string>();
  for (const record of records) {
    const encoded = serialize(record);
    const previous = identities.get(record.id);
    if (previous !== undefined && previous !== encoded) {
      throw new GitHubContextRecordConflictError(record.id);
    }
    identities.set(record.id, encoded);
  }
  return { scope: text(input.scope, "scope"), records };
}

function apiPath(parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function endpoint(configured: GitHubContextStoreConfig, suffix: string): URL {
  const [owner, repository] = repositoryParts(configured.repository);
  return new URL(`/repos/${apiPath([owner, repository])}/${suffix}`, configured.endpoint);
}

function scopePaths(configured: GitHubContextStoreConfig, scope: string) {
  const root = `${configured.prefix}/scopes/${digest(scope)}`;
  return {
    metadata: `${root}/metadata.json`,
    index: `${root}/recent.json`,
    record: (id: string) => `${root}/records/${digest(id)}.json`,
  };
}

function jsonResponse(value: unknown, label: string): Record<string, unknown> {
  if (!isJson(value)) throw new Error(`${label} is not JSON data`);
  return object(value, label);
}

function apiObject(value: unknown, label: string): GitHubApiObject {
  const response = jsonResponse(value, label);
  return { sha: text(response.sha, `${label} SHA`) };
}

function refResponse(value: unknown): GitHubRefResponse {
  const response = jsonResponse(value, "GitHub ref response");
  const target = object(response.object, "GitHub ref object");
  return { object: { sha: text(target.sha, "GitHub ref object SHA") } };
}

function commitResponse(value: unknown): GitHubCommitResponse {
  const response = jsonResponse(value, "GitHub commit response");
  const tree = object(response.tree, "GitHub commit tree");
  return {
    sha: text(response.sha, "GitHub commit SHA"),
    tree: { sha: text(tree.sha, "GitHub commit tree SHA") },
  };
}

function contentResponse(value: unknown): GitHubContentResponse {
  const response = jsonResponse(value, "GitHub content response");
  if (response.type !== "file" || response.encoding !== "base64") {
    throw new Error("GitHub content response is not a base64 file");
  }
  return {
    type: "file",
    encoding: "base64",
    content: text(response.content, "GitHub content"),
  };
}

function scopeIndex(value: unknown, scope: string): ScopeIndex {
  const source = jsonResponse(value, "GitHub context scope index");
  if (source.format !== "gik-github-context-recent/1"
    || source.scope !== scope || !Array.isArray(source.records)) {
    throw new Error("GitHub context scope index is corrupt or belongs to another scope");
  }
  return {
    format: "gik-github-context-recent/1",
    scope,
    records: source.records.map((entry) => {
      const record = object(entry, "GitHub context scope index record");
      return {
        id: text(record.id, "indexed record id"),
        observedAt: text(record.observedAt, "indexed record observedAt"),
      };
    }),
  };
}

export function createGitHubContextStoreServiceKind(): ServiceKindFactory {
  return {
    manifest: {
      id: provider.id,
      version: provider.version,
      title: "GitHub-backed context store",
      description: "Immutable bounded context records stored on a declared private GitHub ref",
      configSchema: {
        type: "object",
        additionalProperties: false,
        required: ["endpoint", "repository", "ref", "prefix", "credentialRef"],
        properties: {
          endpoint: { const: "https://api.github.com" },
          repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
          ref: { type: "string", pattern: "^refs/heads/[A-Za-z0-9._/-]+$" },
          prefix: { type: "string", minLength: 1 },
          credentialRef: { type: "string", minLength: 1 },
          maxRecordsPerScope: { type: "integer", minimum: 1, maximum: 5000 },
          maxWriteAttempts: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
      subjects: ["cell", "substrate-agent", "chat", "task"],
      executionModes: ["immediate", "queued"],
      supports: { discover: true, probe: true },
    },
    describeDependencies: (declaration) => [credentialRequirement(declaration)],
    validate(declaration, context) {
      try {
        if (declaration.version !== "1") {
          throw new Error("github-context-store supports version 1 only");
        }
        config(declaration);
        if (!context.resolveCredential || !context.authorizeEndpoint) {
          throw new Error(
            "github-context-store requires host credential resolution and endpoint authorization",
          );
        }
        if (!Object.keys(declaration.operations).length) {
          throw new Error("github-context-store requires a declared operation");
        }
        for (const operation of Object.values(declaration.operations)) {
          const contract = operation.operation === "query"
            ? CONTEXT_STORE_QUERY_CONTRACT
            : operation.operation === "ingest"
              ? CONTEXT_STORE_INGEST_CONTRACT
              : undefined;
          if (!contract || operation.contract !== contract || operation.sense) {
            throw new Error("Unsupported github-context-store operation or contract");
          }
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    create(declaration, context) {
      const configured = config(declaration);
      const ref = normalizedRef(configured.ref);
      const requirement = credentialRequirement(declaration);
      const operations = [...new Set(
        Object.values(declaration.operations).map(({ operation }) => operation),
      )];

      async function call(
        path: string,
        method: GitHubContextStoreHttpRequest["method"],
        body?: Json,
        signal?: AbortSignal,
        allowedStatuses: readonly number[] = [],
      ): Promise<{ response: Response; value?: unknown }> {
        requireServiceDependency(context, requirement, context.identity?.serviceId ?? provider.id);
        const url = endpoint(configured, path);
        if (!context.authorizeEndpoint
          || !await context.authorizeEndpoint(provider.id, url)) {
          throw new Error("Host denied the declared GitHub context-store endpoint");
        }
        const connection = await context.resolveCredential?.(configured.credentialRef);
        if (!isConnection(connection)) {
          throw new UnsatisfiedServiceDependencyError(
            "Host must supply a GitHub context-store connection",
            requirement,
            {
              dependencyStatus: {
                state: "missing",
                message: "Configure the host-managed GitHub App connection",
              },
            },
          );
        }
        const abort = AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(30000),
        ]);
        abort.throwIfAborted();
        requireServiceDependency(context, requirement, context.identity?.serviceId ?? provider.id);
        const response = await connection.request({
          url: url.href,
          method,
          headers: {
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "x-github-api-version": "2026-03-10",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: abort,
        });
        if (response.status === 401) {
          await context.clearCredential?.(configured.credentialRef);
          throw new UnsatisfiedServiceDependencyError(
            "GitHub context-store authorization expired",
            requirement,
            {
              dependencyStatus: {
                state: "authorization-required",
                message: "Reconnect the GitHub App installation",
              },
            },
          );
        }
        if (!response.ok && !allowedStatuses.includes(response.status)) {
          throw new Error(
            `GitHub context-store ${method} ${url.pathname} failed with HTTP ${response.status}`,
          );
        }
        if (response.status === 204 || allowedStatuses.includes(response.status)) {
          return { response };
        }
        let value: unknown;
        try {
          value = await response.json();
        } catch (error) {
          throw new Error("GitHub context-store response is not valid JSON", { cause: error });
        }
        return { response, value };
      }

      async function head(signal?: AbortSignal): Promise<GitHubCommitResponse> {
        const reference = refResponse(
          (await call(`git/ref/${apiPath(ref.split("/"))}`, "GET", undefined, signal)).value,
        );
        const commit = commitResponse(
          (await call(
            `git/commits/${encodeURIComponent(reference.object.sha)}`,
            "GET",
            undefined,
            signal,
          )).value,
        );
        return commit;
      }

      async function readPath(
        path: string,
        revision: string,
        signal?: AbortSignal,
      ): Promise<Json | undefined> {
        const url = `contents/${apiPath(path.split("/"))}?ref=${encodeURIComponent(revision)}`;
        const result = await call(url, "GET", undefined, signal, [404]);
        if (result.response.status === 404) return undefined;
        const content = contentResponse(result.value);
        try {
          const value: unknown = JSON.parse(
            Buffer.from(content.content.replace(/\s+/g, ""), "base64").toString("utf8"),
          );
          if (!isJson(value)) throw new Error("Decoded value is not JSON data");
          return value;
        } catch (error) {
          throw new Error(`GitHub context path '${path}' contains invalid JSON`, { cause: error });
        }
      }

      async function createBlob(content: string, signal?: AbortSignal): Promise<string> {
        const response = apiObject(
          (await call("git/blobs", "POST", { content, encoding: "utf-8" }, signal)).value,
          "GitHub blob response",
        );
        return response.sha;
      }

      async function commit(
        base: GitHubCommitResponse,
        changes: Array<{ path: string; content: string }>,
        message: string,
        signal?: AbortSignal,
      ): Promise<string | undefined> {
        const treeEntries = await Promise.all(changes.map(async ({ path, content }) => ({
          path,
          mode: recordMode,
          type: recordType,
          sha: await createBlob(content, signal),
        })));
        const tree = apiObject(
          (await call("git/trees", "POST", {
            base_tree: base.tree.sha,
            tree: treeEntries,
          }, signal)).value,
          "GitHub tree response",
        );
        const created = apiObject(
          (await call("git/commits", "POST", {
            message,
            tree: tree.sha,
            parents: [base.sha],
          }, signal)).value,
          "GitHub commit response",
        );
        const revision = created.sha;
        const update = await call(
          `git/refs/${apiPath(ref.split("/"))}`,
          "PATCH",
          { sha: revision, force: false },
          signal,
          [409, 422],
        );
        return update.response.ok ? revision : undefined;
      }

      async function query(
        input: ContextStoreQueryInput,
        signal?: AbortSignal,
      ): Promise<{ output: ContextStoreQueryOutput; revision: string }> {
        const current = await head(signal);
        const paths = scopePaths(configured, input.scope);
        const storedIndex = await readPath(paths.index, current.sha, signal);
        if (storedIndex === undefined) {
          return {
            output: { scope: input.scope, requestKey: input.requestKey, records: [] },
            revision: current.sha,
          };
        }
        const index = scopeIndex(storedIndex, input.scope);
        const records = await Promise.all(index.records.slice(0, input.limit).map(async (entry) => {
          const id = text(entry?.id, "indexed record id");
          const value = await readPath(paths.record(id), current.sha, signal);
          if (value === undefined) {
            throw new Error(`GitHub context scope index references missing record '${id}'`);
          }
          const record = validatedRecord(value);
          if (record.id !== id) {
            throw new Error(`GitHub context record path identity mismatch for '${id}'`);
          }
          return record;
        }));
        return {
          output: {
            scope: input.scope,
            requestKey: input.requestKey,
            records,
          },
          revision: current.sha,
        };
      }

      async function ingest(
        input: ContextStoreIngestInput,
        signal?: AbortSignal,
      ): Promise<{ output: ContextStoreIngestOutput; revision: string }> {
        const paths = scopePaths(configured, input.scope);
        for (let attempt = 1; attempt <= configured.maxWriteAttempts; attempt += 1) {
          const current = await head(signal);
          const metadataValue = await readPath(paths.metadata, current.sha, signal);
          if (metadataValue !== undefined) {
            const metadata = object(metadataValue, "GitHub context scope metadata");
            if (metadata.format !== "gik-github-context-scope/1"
              || metadata.scope !== input.scope) {
              throw new Error("GitHub context scope metadata is corrupt or hash-collided");
            }
          }
          const storedIndex = await readPath(paths.index, current.sha, signal);
          let index: ScopeIndex = {
            format: "gik-github-context-recent/1",
            scope: input.scope,
            records: [],
          };
          if (storedIndex !== undefined) {
            index = scopeIndex(storedIndex, input.scope);
          }

          const changes: Array<{ path: string; content: string }> = [];
          const entries = new Map(index.records.map((entry) => [entry.id, entry]));
          const unique = new Map<string, ContextRecord>();
          for (const record of input.records) unique.set(record.id, record);
          for (const record of unique.values()) {
            const path = paths.record(record.id);
            const encoded = serialize(record);
            const existing = await readPath(path, current.sha, signal);
            if (existing !== undefined) {
              const stored = validatedRecord(existing);
              if (stored.id !== record.id || serialize(stored) !== encoded) {
                throw new GitHubContextRecordConflictError(record.id);
              }
            } else {
              changes.push({ path, content: encoded });
            }
            entries.set(record.id, { id: record.id, observedAt: record.observedAt });
          }

          const nextRecords = [...entries.values()]
            .sort((left, right) =>
              right.observedAt.localeCompare(left.observedAt)
              || left.id.localeCompare(right.id))
            .slice(0, configured.maxRecordsPerScope);
          const nextIndex: ScopeIndex = { ...index, records: nextRecords };
          if (metadataValue === undefined) {
            changes.push({
              path: paths.metadata,
              content: serialize({
                format: "gik-github-context-scope/1",
                scope: input.scope,
              }),
            });
          }
          if (storedIndex === undefined
            || serialize(storedIndex) !== serialize(nextIndex)) {
            changes.push({
              path: paths.index,
              content: serialize(nextIndex),
            });
          }

          if (!changes.length) {
            return {
              output: {
                scope: input.scope,
                recordIds: input.records.map(({ id }) => id),
                status: "stored",
              },
              revision: current.sha,
            };
          }
          const revision = await commit(
            current,
            changes,
            `context: ingest ${input.records.length} record(s) for ${digest(input.scope).slice(0, 12)}`,
            signal,
          );
          if (revision) {
            return {
              output: {
                scope: input.scope,
                recordIds: input.records.map(({ id }) => id),
                status: "stored",
              },
              revision,
            };
          }
        }
        throw new GitHubContextStoreRevisionConflictError(
          configured.ref,
          configured.maxWriteAttempts,
        );
      }

      return {
        provider,
        discover: async () => ({
          provider,
          revision: "1",
          discoveredAt: new Date().toISOString(),
          capabilities: operations.map((operation) => ({
            id: operation === "query"
              ? CONTEXT_STORE_QUERY_CONTRACT
              : CONTEXT_STORE_INGEST_CONTRACT,
            operation,
            name: operation === "query"
              ? "Query GitHub context"
              : "Ingest GitHub context",
            version: "1",
            inputSchema: operation === "query"
              ? contextStoreQueryInputSchema
              : contextStoreIngestInputSchema,
            outputSchema: operation === "query"
              ? contextStoreQueryOutputSchema
              : contextStoreIngestOutputSchema,
            assurance: "declared-and-locally-validated",
          })),
        }),
        async probe(adapterContext) {
          const current = await head(adapterContext.signal);
          return {
            ok: true,
            detail: {
              repository: configured.repository,
              ref: configured.ref,
              revision: current.sha,
            },
          };
        },
        async execute(request: ServiceRequest, adapterContext) {
          if (!operations.includes(request.operation)) {
            throw new Error("GitHub context-store operation is not declared");
          }
          if (request.operation === "query") {
            const result = await query(queryInput(request.input), adapterContext.signal);
            return {
              output: jsonValue(result.output, "GitHub context query output"),
              detail: {
                repository: configured.repository,
                ref: configured.ref,
                revision: result.revision,
              },
            };
          }
          if (request.operation === "ingest") {
            const result = await ingest(ingestInput(request.input), adapterContext.signal);
            return {
              output: jsonValue(result.output, "GitHub context ingestion output"),
              detail: {
                repository: configured.repository,
                ref: configured.ref,
                revision: result.revision,
              },
            };
          }
          throw new Error("Unsupported GitHub context-store operation");
        },
      };
    },
  };
}
