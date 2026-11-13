import {
  requireServiceDependency, serviceConfig, UnsatisfiedServiceDependencyError,
  type ServiceDependencyRequirement, type ServiceKindFactory, type ServiceRequest,
} from "gik-controlface/services";
import type { NativeServiceDeclaration } from "gik-kernel";
import { integer, isJson, keys, object, text } from "./values";

export const gmailScopes = {
  readonly: "https://www.googleapis.com/auth/gmail.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
} as const;

const searchSchema = {
  type: "object", additionalProperties: false,
  properties: {
    query: { type: "string", minLength: 1 }, maxResults: { type: "integer", minimum: 1, maximum: 100 },
    pageToken: { type: "string", minLength: 1 },
  },
};
export const gmailInputSchemas: Record<string, Record<string, unknown>> = {
  search: searchSchema,
  watch: { ...searchSchema, properties: { query: searchSchema.properties.query, maxResults: searchSchema.properties.maxResults } },
  get: {
    type: "object", additionalProperties: false, required: ["id"],
    properties: { id: { type: "string", minLength: 1 }, format: { enum: ["metadata", "minimal", "full", "raw"] } },
  },
  send: {
    type: "object", additionalProperties: false, required: ["raw"],
    properties: { raw: { type: "string", pattern: "^[A-Za-z0-9_-]+={0,2}$", minLength: 1 } },
  },
};

export interface GmailHttpRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
  signal: AbortSignal;
}

/** Tokens stay inside this host-owned connection. The send port must enforce host authorization. */
export interface GmailConnection {
  request(request: Readonly<GmailHttpRequest>): Promise<Response>;
  send?(request: Readonly<GmailHttpRequest>, invocation: Readonly<ServiceRequest>): Promise<Response>;
}

export class GmailSendUncertainError extends Error {
  readonly code = "gmail-send-uncertain";
  constructor(cause: unknown) {
    super("Gmail send completion is uncertain; inspect Sent mail before considering a new authorized attempt", { cause });
    this.name = "GmailSendUncertainError";
  }
}

function requirement(declaration: NativeServiceDeclaration): ServiceDependencyRequirement {
  const operations = Object.values(declaration.operations);
  return {
    id: "google-account", kind: "credential", title: "Google account",
    ref: text(serviceConfig(declaration).credentialRef, "credentialRef"), scheme: "google-oauth2",
    permissions: [
      ...(operations.some(({ operation }) => operation !== "send") ? [gmailScopes.readonly] : []),
      ...(operations.some(({ operation }) => operation === "send") ? [gmailScopes.send] : []),
    ],
  };
}

function sendRequirement(declaration: NativeServiceDeclaration): ServiceDependencyRequirement {
  return {
    id: "send-authority", kind: "gmail-send-authority", title: "Host-authorized Gmail sending",
    ref: text(serviceConfig(declaration).credentialRef, "credentialRef"),
  };
}

function isConnection(value: unknown): value is GmailConnection {
  return !!value && typeof value === "object" && "request" in value && typeof value.request === "function"
    && (!("send" in value) || value.send === undefined || typeof value.send === "function");
}

export function createGmailServiceKind(): ServiceKindFactory {
  return {
    manifest: {
      id: "gmail", version: "1", title: "Host-managed Gmail",
      configSchema: {
        type: "object", additionalProperties: false, required: ["endpoint", "credentialRef"],
        properties: {
          endpoint: { const: "https://gmail.googleapis.com" },
          credentialRef: { type: "string", minLength: 1 },
          pollIntervalMs: { type: "integer", minimum: 1000, maximum: 3600000 },
        },
      },
      subjects: ["cell", "substrate-agent", "chat", "task"],
      executionModes: ["immediate", "queued"], supports: { observe: true },
      operationConstraints: { send: { queueable: false, retryable: false } },
    },
    describeDependencies: (declaration) => [
      requirement(declaration),
      ...(Object.values(declaration.operations).some(({ operation }) => operation === "send") ? [sendRequirement(declaration)] : []),
    ],
    validate(declaration, context) {
      if (declaration.version !== "1") return { ok: false, errors: ["Gmail supports version 1 only"] };
      if (!context.resolveCredential || !context.authorizeEndpoint) {
        return { ok: false, errors: ["Gmail requires host credential resolution and endpoint authorization"] };
      }
      for (const operation of Object.values(declaration.operations)) {
        if (!["search", "get", "send", "watch"].includes(operation.operation)
          || operation.contract !== `gmail.${operation.operation}/v1`) {
          return { ok: false, errors: ["Unsupported Gmail operation or contract"] };
        }
        if (operation.operation === "watch") {
          if (operation.mode === "queued" || operation.sense?.kind !== "feed" || !operation.sense.signals.message) {
            return { ok: false, errors: ["Gmail watch requires an immediate feed Sense with a message signal"] };
          }
        } else if (operation.sense) return { ok: false, errors: ["Only Gmail watch supports observation"] };
        if (operation.operation === "send" && (operation.mode === "queued"
          || ["retry", "correction-prompt"].includes(operation.onViolation?.action ?? ""))) {
          return { ok: false, errors: ["Gmail send must be immediate without automatic transport or guardrail retries"] };
        }
      }
      return { ok: true };
    },
    create(declaration, context) {
      const config = serviceConfig(declaration);
      const dependency = requirement(declaration);
      const credentialRef = text(config.credentialRef, "credentialRef");
      const endpoint = text(config.endpoint, "endpoint");
      const operations = [...new Set(Object.values(declaration.operations).map(({ operation }) => operation))];
      const interval = integer(config.pollIntervalMs ?? 60000, "pollIntervalMs", 1000, 3600000);
      const provider = { id: "gmail", version: "1" };

      async function call(request: ServiceRequest, operation: "search" | "get" | "send", signal?: AbortSignal) {
        requireServiceDependency(context, dependency, request.service);
        const input = object(request.input ?? {}, "Gmail input");
        let path = "/gmail/v1/users/me/messages";
        let body: string | undefined;
        const query = new URLSearchParams();
        if (operation === "search") {
          keys(input, ["query", "maxResults", "pageToken"]);
          if (input.query !== undefined) query.set("q", text(input.query, "query"));
          if (input.pageToken !== undefined) query.set("pageToken", text(input.pageToken, "pageToken"));
          query.set("maxResults", String(integer(input.maxResults ?? 100, "maxResults", 1, 100)));
        } else if (operation === "get") {
          keys(input, ["id", "format"]);
          const id = text(input.id, "message id");
          if (id === "." || id === "..") throw new Error("Gmail message id cannot be a URL dot segment");
          path += `/${encodeURIComponent(id)}`;
          const format = text(input.format ?? "metadata", "message format");
          if (!["metadata", "minimal", "full", "raw"].includes(format)) throw new Error("Unsupported Gmail message format");
          query.set("format", format);
        } else {
          keys(input, ["raw"]);
          const raw = text(input.raw, "RFC 2822 base64url message");
          if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) throw new Error("Gmail raw message must be base64url encoded");
          path += "/send";
          body = JSON.stringify({ raw });
        }
        const url = new URL(path, endpoint);
        url.search = query.toString();
        if (!context.authorizeEndpoint || !await context.authorizeEndpoint("gmail", url)) {
          throw new Error("Host denied the declared Gmail endpoint");
        }
        const connection = await context.resolveCredential?.(credentialRef);
        if (!isConnection(connection)) throw new UnsatisfiedServiceDependencyError(
          "Host must supply a Gmail connection", dependency,
          { dependencyStatus: { state: "missing", message: "Configure the host-managed Gmail connection" } },
        );
        const abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]);
        abort.throwIfAborted();
        requireServiceDependency(context, dependency, request.service);
        const http: GmailHttpRequest = { url: url.href, method: operation === "send" ? "POST" : "GET", signal: abort, ...(body ? { body } : {}) };
        let response: Response;
        try {
          if (operation === "send") {
            requireServiceDependency(context, sendRequirement(declaration), request.service);
            if (!connection.send) throw new UnsatisfiedServiceDependencyError(
              "Host has not supplied an authorized Gmail send port", { kind: "gmail-send-authority", ref: dependency.ref },
            );
            response = await connection.send(http, structuredClone(request));
          } else response = await connection.request(http);
        } catch (error) {
          if (operation === "send" && !(error instanceof UnsatisfiedServiceDependencyError)) throw new GmailSendUncertainError(error);
          throw error;
        }
        if (response.status === 401) {
          await context.clearCredential?.(credentialRef);
          throw new UnsatisfiedServiceDependencyError("Google authorization expired", dependency, {
            dependencyStatus: { state: "authorization-required", message: "Reconnect the Google account" },
          });
        }
        if (!response.ok) {
          const error = new Error(`Gmail ${operation} failed with HTTP ${response.status}`);
          if (operation === "send" && (response.status === 408 || response.status >= 500)) throw new GmailSendUncertainError(error);
          throw error;
        }
        try {
          const output: unknown = await response.json();
          if (!isJson(output)) throw new Error("Gmail response is not JSON data");
          object(output, "Gmail response");
          return output;
        } catch (error) {
          if (operation === "send") throw new GmailSendUncertainError(error);
          throw error;
        }
      }
      return {
        provider,
        discover: async () => ({
          provider, revision: "1", discoveredAt: new Date().toISOString(),
          capabilities: operations.map((operation) => ({
            id: `gmail.${operation}/v1`, operation, name: `Gmail ${operation}`, version: "1",
            inputSchema: gmailInputSchemas[operation], assurance: "declared-and-locally-validated",
          })),
        }),
        async execute(request, execution) {
          if (!operations.includes(request.operation)) throw new Error("Gmail operation is not declared");
          const operation = request.operation;
          if (operation !== "search" && operation !== "get" && operation !== "send") throw new Error("Unsupported Gmail operation");
          return { output: await call(request, operation, execution.signal) };
        },
        async observe(request, observation) {
          if (!operations.includes("watch") || request.operation !== "watch" || observation.kind !== "feed") throw new Error("Unsupported Gmail observation");
          const input = object(request.input ?? {}, "Gmail watch input");
          keys(input, ["query", "maxResults"]);
          const controller = new AbortController();
          let stopped = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let pending = Promise.resolve();
          const seen = new Set<string>();
          const stop = () => {
            stopped = true;
            controller.abort();
            clearTimeout(timer);
            observation.signal?.removeEventListener("abort", stop);
          };
          if (observation.signal?.aborted) throw new Error("Gmail binding is already aborted");
          observation.signal?.addEventListener("abort", stop, { once: true });
          const poll = () => {
            pending = (async () => {
              const output = object(await call(request, "search", controller.signal), "Gmail list response");
              const messages = output.messages ?? [];
              if (!Array.isArray(messages)) throw new Error("Gmail messages must be an array");
              for (const value of messages) {
                if (stopped) return;
                const message = object(value, "Gmail message");
                const id = text(message.id, "Gmail message id");
                if (seen.has(id)) continue;
                requireServiceDependency(context, dependency, request.service);
                await observation.emit({
                  id, name: "message",
                  payload: { id, ...(typeof message.threadId === "string" ? { threadId: message.threadId } : {}) },
                });
                seen.add(id);
                if (seen.size > 256) {
                  const oldest = seen.values().next().value;
                  if (oldest !== undefined) seen.delete(oldest);
                }
              }
            })().then(() => {
              if (!stopped) timer = setTimeout(poll, interval);
            }, (error: unknown) => {
              if (stopped && controller.signal.aborted && error instanceof Error && error.name === "AbortError") return;
              stop();
              observation.onError(error);
            });
          };
          poll();
          return { async close() { stop(); await pending; } };
        },
      };
    },
  };
}
