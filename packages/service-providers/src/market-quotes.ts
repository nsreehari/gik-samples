import {
  requireServiceDependency, serviceConfig,
  type ServiceDependencyRequirement, type ServiceKindFactory,
} from "gik-controlface/services";
import type { NativeServiceDeclaration, Json } from "gik-kernel";
import { keys, object, text } from "./values";

const symbolPattern = /^[A-Z0-9^][A-Z0-9.^=-]{0,31}(?![\s\S])/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}(?![\s\S])/;
export const marketQuoteInputSchema = {
  type: "object", additionalProperties: false, required: ["symbols"],
  properties: {
    symbols: {
      type: "array", minItems: 1, maxItems: 20,
      items: { type: "string", pattern: symbolPattern.source },
    },
  },
};

/** The host resolves this opaque reference and owns transport, authorization and cancellation. */
export interface MarketQuotesHostRequest {
  kind: "market-quotes";
  providerRef: string;
  input: { symbols: string[] };
  signal?: AbortSignal;
}

function requirement(declaration: NativeServiceDeclaration): ServiceDependencyRequirement {
  const ref = text(serviceConfig(declaration).providerRef, "providerRef");
  if (!referencePattern.test(ref)) throw new Error("providerRef must be a bounded opaque reference, not a URL");
  return { id: "quote-host", kind: "market-quotes-host", title: "Host-Managed Quote Provider", ref };
}

// JSON must be finite, acyclic data; do not silently normalize provider-specific shapes.
function isFiniteJson(value: unknown, ancestors = new Set<object>()): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from(value).every((item) => isFiniteJson(item, ancestors))
    : Object.values(value).every((item) => isFiniteJson(item, ancestors));
  ancestors.delete(value);
  return valid;
}

export function createMarketQuotesServiceKind(): ServiceKindFactory {
  const provider = { id: "market-quotes", version: "1", title: "Market Quotes" };
  return {
    manifest: {
      ...provider, subjects: ["cell", "substrate-agent", "chat", "task"],
      executionModes: ["immediate", "queued"],
      configSchema: {
        type: "object", additionalProperties: false, required: ["providerRef"],
        properties: { providerRef: { type: "string", pattern: referencePattern.source, maxLength: 128 } },
      },
    },
    describeDependencies: (declaration) => [requirement(declaration)],
    validate(declaration, context) {
      if (declaration.version !== "1" || !context.execute
        || !Object.keys(declaration.operations).length
        || Object.values(declaration.operations).some((operation) => operation.operation !== "get"
          || operation.contract !== "market-quotes/v1" || operation.sense)) {
        return { ok: false, errors: ["Market quotes require version 1, get with market-quotes/v1, and a host execute port without observation"] };
      }
      return { ok: true };
    },
    create(declaration, context) {
      const dependency = requirement(declaration);
      const providerRef = dependency.ref!;
      return {
        provider,
        discover: async () => ({
          provider, revision: "1", discoveredAt: new Date().toISOString(),
          capabilities: [{
            id: "market-quotes/v1", operation: "get", version: "1",
            inputSchema: marketQuoteInputSchema, assurance: "declared-and-locally-validated",
          }],
        }),
        async execute(request, execution) {
          if (request.operation !== "get") throw new Error("Unsupported market quote operation");
          execution.signal?.throwIfAborted();
          requireServiceDependency(context, dependency, request.service);
          const input = object(request.input, "Market quote input");
          keys(input, ["symbols"]);
          if (!Array.isArray(input.symbols) || input.symbols.length < 1 || input.symbols.length > 20
            || Array.from(input.symbols).some((symbol) => typeof symbol !== "string" || !symbolPattern.test(symbol))) {
            throw new Error("Market quote symbols must contain 1-20 valid uppercase symbols");
          }
          if (!context.execute) throw new Error("The host quote provider is unavailable");
          const hostRequest: MarketQuotesHostRequest = {
            kind: "market-quotes", providerRef, input: { symbols: [...input.symbols] }, signal: execution.signal,
          };
          const output = await context.execute(hostRequest);
          execution.signal?.throwIfAborted();
          requireServiceDependency(context, dependency, request.service);
          if (!isFiniteJson(output)) throw new Error("Market quote output must be finite JSON data");
          return { output };
        },
      };
    },
  };
}
