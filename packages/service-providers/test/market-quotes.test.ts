import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  ServiceKindRegistry, UnsatisfiedServiceDependencyError,
  type ServiceDependencyStatus, type ServiceKindContext, type ServiceRequest,
} from "gik-controlface/services";
import type { NativeServiceDeclaration } from "gik-kernel";
import { createMarketQuotesServiceKind, type MarketQuotesHostRequest } from "../src/market-quotes";

const identity = { blueprintId: "quotes-test", blueprintRevision: "1", serviceId: "quotes" };
const declaration: NativeServiceDeclaration = {
  kind: "market-quotes", version: "1", config: { providerRef: "quotes/main" },
  operations: {
    get: {
      operation: "get", contract: "market-quotes/v1",
      settlement: { transform: { kind: "jsonata", expr: "{}" } },
    },
  },
};
function request(input: ServiceRequest["input"] = { symbols: ["ACME"] }): ServiceRequest {
  return {
    id: "quote-request", service: "quotes", operation: "get", input,
    providerId: "market-quotes", capabilityId: "market-quotes/v1", createdAt: "now",
  };
}
function fixture(
  execute: NonNullable<ServiceKindContext["execute"]> = async () => ({}),
  status: () => ServiceDependencyStatus = () => ({ state: "ready" }),
) {
  const transport = vi.fn(execute);
  const inspect = vi.fn<NonNullable<ServiceKindContext["inspectDependency"]>>(() => status());
  const registry = new ServiceKindRegistry({ execute: transport, inspectDependency: inspect });
  registry.register(createMarketQuotesServiceKind());
  return { registry, transport, inspect };
}

test("native setup and discovery are transport-free and derive the configured dependency", async () => {
  const { registry, transport, inspect } = fixture();
  const setup = await registry.describeSetup(identity, declaration);
  assert.equal(setup.ready, true);
  assert.deepEqual(setup.dependencies[0].requirement, {
    id: "quote-host", kind: "market-quotes-host", title: "Host-Managed Quote Provider", ref: "quotes/main",
  });
  assert.deepEqual(inspect.mock.calls[0][1], identity);
  const adapter = await registry.materialize(identity, declaration);
  const catalog = await adapter.discover();
  assert.equal(catalog.capabilities.length, 1);
  assert.equal(catalog.capabilities[0].id, "market-quotes/v1");
  assert.equal(catalog.capabilities[0].operation, "get");
  assert.equal(transport.mock.calls.length, 0);
});

test("declarations require a bounded opaque reference, supported get contract and host transport", async () => {
  const { registry } = fixture();
  const configs: NativeServiceDeclaration["config"][] = [{}, { providerRef: "" }, { providerRef: "https://example.invalid" },
    { providerRef: "a".repeat(129) }, { providerRef: "quotes/main\n" },
    { providerRef: "quotes/main", endpoint: "https://example.invalid" }];
  for (const config of configs) {
    assert.equal((await registry.validate({ ...declaration, config })).ok, false);
  }
  const changes: Partial<NativeServiceDeclaration>[] = [
    { version: "2" }, { operations: {} },
    { operations: { get: { ...declaration.operations.get, operation: "fetch" } } },
    { operations: { get: { ...declaration.operations.get, contract: "quotes/v2" } } },
    { operations: { get: { ...declaration.operations.get, sense: { kind: "feed" as const, signals: {} } } } },
  ];
  for (const change of changes) assert.equal((await registry.validate({ ...declaration, ...change })).ok, false);
  const missing = new ServiceKindRegistry();
  missing.register(createMarketQuotesServiceKind());
  assert.equal((await missing.validate(declaration)).ok, false);
  assert.equal((await registry.validate({ ...declaration, operations: {
    get: { ...declaration.operations.get, mode: "queued" },
  } })).ok, true);
});

test("invalid and oversized symbol inputs never reach the host; boundary symbols are preserved", async () => {
  const { registry, transport } = fixture();
  const adapter = await registry.materialize(identity, declaration);
  const sparse = new Array(1);
  const inputs: ServiceRequest["input"][] = [null, [], {}, { symbols: [] }, { symbols: Array(21).fill("ACME") },
    { symbols: ["acme"] }, { symbols: ["ACME\n"] }, { symbols: ["A".repeat(33)] }, { symbols: [42] },
    { symbols: ["https://example.invalid"] }, { symbols: ["ACME"], url: "https://example.invalid" },
    { symbols: sparse }];
  for (const input of inputs) {
    await assert.rejects(async () => adapter.execute(request(input), {}));
  }
  await assert.rejects(async () => adapter.execute({ ...request(), operation: "fetch" }, {}), /Unsupported/);
  assert.equal(transport.mock.calls.length, 0);
  const symbols = ["A".repeat(32), "^TEST", "ACME.A", "TEST=F", ...Array(16).fill("ACME")];
  await adapter.execute(request({ symbols }), {});
  const hostRequest = transport.mock.calls[0][0] as MarketQuotesHostRequest;
  assert.deepEqual(hostRequest, { kind: "market-quotes", providerRef: "quotes/main", input: { symbols }, signal: undefined });
  assert.notEqual(hostRequest.input.symbols, symbols);
});

test("output keeps provider object, array and scalar shapes but rejects non-finite or non-JSON data", async () => {
  let output: unknown;
  const { registry } = fixture(async () => output);
  const adapter = await registry.materialize(identity, declaration);
  for (output of [
    { quotes: [{ symbol: "ACME", price: 12.5, currency: "USD" }], missing: ["TEST"], source: { revision: "synthetic" } },
    [{ symbol: "ACME", value: null }], null, 0, "unavailable", false,
  ]) {
    const result = await adapter.execute(request(), {});
    assert.equal(result.output, output);
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (output of [undefined, Infinity, { quote: NaN }, { quote: undefined }, new Date(), 1n, cyclic, new Array(1)]) {
    await assert.rejects(async () => adapter.execute(request(), {}), /finite JSON/);
  }
});

test("pre-aborted requests do not execute; in-flight cancellation propagates and suppresses late output", async () => {
  const controller = new AbortController();
  const { registry, transport } = fixture(async (value) => {
    const hostRequest = value as MarketQuotesHostRequest;
    assert.equal(hostRequest.signal, controller.signal);
    controller.abort();
    return { quotes: [] };
  });
  const adapter = await registry.materialize(identity, declaration);
  await assert.rejects(async () => adapter.execute(request(), { signal: controller.signal }), { name: "AbortError" });
  assert.equal(transport.mock.calls.length, 1);
  await assert.rejects(async () => adapter.execute(request(), { signal: controller.signal }), { name: "AbortError" });
  assert.equal(transport.mock.calls.length, 1);
});

test("live revocation blocks each invocation and discards an output produced after revocation", async () => {
  let status: ServiceDependencyStatus = { state: "ready" };
  const { registry, transport } = fixture(async () => {
    status = { state: "unavailable", message: "Quotes are disabled" };
    return { quotes: [] };
  }, () => status);
  const adapter = await registry.materialize(identity, declaration);
  const revoked = (error: unknown) => {
    assert.ok(error instanceof UnsatisfiedServiceDependencyError);
    assert.equal(error.dependencyStatus?.state, "unavailable");
    return true;
  };
  await assert.rejects(async () => adapter.execute(request(), {}), revoked);
  await assert.rejects(async () => adapter.execute(request(), {}), revoked);
  assert.equal(transport.mock.calls.length, 1);
  assert.equal((await registry.describeSetup(identity, declaration)).ready, false);
});
