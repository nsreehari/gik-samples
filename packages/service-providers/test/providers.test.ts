import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { DefaultServiceHost, ServiceKindRegistry, UnsatisfiedServiceDependencyError, type ServiceDependencyStatus, type ServiceKindContext, type ServiceRequest } from "gik-controlface/services";
import { InMemoryStateModel, JsonataExpressionProvider, type NativeServiceDeclaration } from "gik-kernel";
import { createGmailServiceKind, gmailScopes, GmailSendUncertainError, type GmailConnection } from "../src/gmail";
import { createSchedulerServiceKind } from "../src/scheduler";

afterEach(() => { vi.useRealTimers(); });
const settlement = { transform: { kind: "jsonata" as const, expr: "{}" } };
const identity = { blueprintId: "test", blueprintRevision: "1", serviceId: "mail" };
function declaration(operations = ["search", "get"]): NativeServiceDeclaration {
  return {
    kind: "gmail", version: "1", config: { endpoint: "https://gmail.googleapis.com", credentialRef: "google/main", pollIntervalMs: 1000 },
    operations: Object.fromEntries(operations.map((operation) => [operation, {
      operation, contract: `gmail.${operation}/v1`, settlement,
      ...(operation === "watch" ? { sense: { kind: "feed" as const, signals: { message: { payloadSchema: { type: "object" } } } } } : {}),
    }])),
  };
}
function request(operation: string, input: ServiceRequest["input"] = {}): ServiceRequest {
  return { id: "request", service: "mail", operation, input, providerId: "gmail", capabilityId: `gmail.${operation}/v1`, createdAt: "now" };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function gmail(connection: GmailConnection, status: () => ServiceDependencyStatus = () => ({ state: "ready" })) {
  const clear = vi.fn();
  const resolve = vi.fn(async () => connection);
  const endpoint = vi.fn<NonNullable<ServiceKindContext["authorizeEndpoint"]>>(async () => true);
  const registry = new ServiceKindRegistry({
    inspectDependency: status, resolveCredential: resolve, authorizeEndpoint: endpoint, clearCredential: clear,
  });
  registry.register(createGmailServiceKind());
  return { registry, clear, resolve, endpoint };
}

test("setup derives minimal scopes without reading credentials; search/get use authorized encoded URLs", async () => {
  const read = vi.fn(async () => json({ messages: [{ id: "message" }] }));
  const fixture = gmail({ request: read });
  const setup = await fixture.registry.describeSetup(identity, declaration());
  assert.deepEqual(setup.dependencies[0].requirement.permissions, [gmailScopes.readonly]);
  assert.equal(fixture.resolve.mock.calls.length, 0);
  assert.deepEqual((await fixture.registry.describeSetup(identity, declaration(["send"]))).dependencies[0].requirement.permissions, [gmailScopes.send]);
  const adapter = await fixture.registry.materialize(identity, declaration());
  await adapter.execute(request("search", { query: "label:inbox a&b", maxResults: 2 }), {});
  const search = new URL(fixture.endpoint.mock.calls[0][1].href);
  assert.equal(search.searchParams.get("q"), "label:inbox a&b");
  await adapter.execute(request("get", { id: "a/b", format: "metadata" }), {});
  assert.ok(fixture.endpoint.mock.calls[1][1].pathname.endsWith("/a%2Fb"));
  await assert.rejects(async () => adapter.execute(request("get", { id: ".." }), {}), /dot segment/);
  await assert.rejects(async () => adapter.execute(request("get", { id: "message", format: ["metadata"] }), {}), /message format/);
  await assert.rejects(async () => adapter.execute(request("send", { raw: "ZGF0YQ" }), {}), /not declared/);
});

test("invalid endpoints and denied endpoints never obtain credentials; revocation is live", async () => {
  let status: ServiceDependencyStatus = { state: "ready" };
  const fixture = gmail({ request: async () => json({}) }, () => status);
  assert.equal((await fixture.registry.validate({ ...declaration(), config: { endpoint: "https://example.invalid", credentialRef: "google/main" } })).ok, false);
  const adapter = await fixture.registry.materialize(identity, declaration());
  fixture.endpoint.mockResolvedValue(false);
  await assert.rejects(async () => adapter.execute(request("search"), {}), /Host denied/);
  assert.equal(fixture.resolve.mock.calls.length, 0);
  status = { state: "authorization-required", message: "Account revoked" };
  fixture.endpoint.mockResolvedValue(true);
  await assert.rejects(async () => adapter.execute(request("search"), {}), /Account revoked/);
  assert.equal(fixture.resolve.mock.calls.length, 0);
});

test("HTTP 401 invalidates the host connection and reports actionable authorization failure", async () => {
  const fixture = gmail({ request: async () => json({}, 401) });
  const adapter = await fixture.registry.materialize(identity, declaration());
  await assert.rejects(async () => adapter.execute(request("search"), {}), (error) => {
    assert.ok(error instanceof UnsatisfiedServiceDependencyError);
    assert.equal(error.dependencyStatus?.state, "authorization-required");
    return true;
  });
  assert.deepEqual(fixture.clear.mock.calls, [["google/main"]]);
});

test("send requires an explicit host write port and rejects all automatic retry modes", async () => {
  const fixture = gmail({ request: async () => assert.fail("Reads must not send mail") });
  const send = declaration(["send"]);
  const adapter = await fixture.registry.materialize(identity, send);
  await assert.rejects(async () => adapter.execute(request("send", { raw: "ZGF0YQ" }), {}), /authorized Gmail send port/);
  for (const change of [
    { mode: "queued" as const },
    { onViolation: { action: "retry" as const, maxAttempts: 2 } },
    { onViolation: { action: "correction-prompt" as const, maxAttempts: 2 } },
  ]) {
    assert.equal((await fixture.registry.validate({ ...send, operations: {
      send: { ...send.operations.send, ...change },
    } })).ok, false);
  }
});

test("host send readiness is a separate dependency and is rechecked before every POST", async () => {
  let enabled = true;
  const send = vi.fn(async () => json({ id: "sent" }));
  const registry = new ServiceKindRegistry({
    resolveCredential: async () => ({ request: async () => json({}), send }),
    authorizeEndpoint: () => true,
    inspectDependency: (requirement) => requirement.kind === "gmail-send-authority" && !enabled
      ? { state: "unavailable", message: "Sending is disabled by the host" } : { state: "ready" },
  });
  registry.register(createGmailServiceKind());
  const adapter = await registry.materialize(identity, declaration(["send"]));
  enabled = false;
  const report = await registry.describeSetup(identity, declaration(["send"]));
  assert.equal(report.ready, false);
  assert.equal(report.dependencies[1].requirement.kind, "gmail-send-authority");
  await assert.rejects(async () => adapter.execute(request("send", { raw: "ZGF0YQ" }), {}), /Sending is disabled/);
  assert.equal(send.mock.calls.length, 0);
});

test.each(["network", "server", "malformed"])("uncertain send completion is explicit and never retried: %s", async (failure) => {
  const send = vi.fn(async () => {
    if (failure === "network") throw new Error("Connection lost");
    if (failure === "server") return json({}, 503);
    return new Response("invalid JSON");
  });
  const fixture = gmail({ request: async () => json({}), send });
  const adapter = await fixture.registry.materialize(identity, declaration(["send"]));
  await assert.rejects(async () => adapter.execute(request("send", { raw: "ZGF0YQ" }), {}), GmailSendUncertainError);
  assert.equal(send.mock.calls.length, 1);
});

test.each([undefined, "immediate"] as const)("public host rejects explicit send enqueue and cannot retry uncertain completion with mode %s", async (mode) => {
  const send = vi.fn(async () => { throw new Error("Connection lost after POST"); });
  const fixture = gmail({ request: async () => assert.fail("Reads must not send mail"), send });
  const mail = declaration(["send"]);
  const host = new DefaultServiceHost({
    ...identity, registry: fixture.registry, maxAttempts: 3,
    declarations: { mail: { ...mail, operations: {
      deliver: { ...mail.operations.send, ...(mode ? { mode } : {}) },
    } } },
    state: new InMemoryStateModel(["work"]), expression: new JsonataExpressionProvider(),
  });
  const effect = { kind: "invoke" as const, node: "mail", control: { tool: "deliver", serviceRef: "mail" }, data: { raw: "ZGF0YQ" } };
  await assert.rejects(() => host.enqueue(effect), /cannot be queued/);
  assert.equal(fixture.resolve.mock.calls.length, 0);
  assert.equal(fixture.endpoint.mock.calls.length, 0);
  assert.equal(send.mock.calls.length, 0);
  assert.deepEqual(await host.listRequests(), []);
  assert.equal(await host.runNext(), undefined);
  await assert.rejects(() => host.invoke(effect), /Gmail send completion is uncertain/);
  const [record] = await host.listRequests();
  assert.equal(record.status, "failed");
  assert.equal(record.attempts, 1);
  assert.equal(await host.runNext(), undefined);
  assert.equal(send.mock.calls.length, 1);
});

test("public host still queues Gmail read operations", async () => {
  const read = vi.fn(async () => json({ messages: [{ id: "message" }] }));
  const fixture = gmail({ request: read });
  const host = new DefaultServiceHost({
    ...identity, registry: fixture.registry, declarations: { mail: declaration(["search"]) },
    state: new InMemoryStateModel(["work"]), expression: new JsonataExpressionProvider(),
  });
  const effect = { kind: "invoke" as const, node: "mail", control: { tool: "search", serviceRef: "mail" }, data: {} };
  assert.equal((await host.enqueue(effect)).status, "accepted");
  assert.equal((await host.runNext())?.status, "completed");
  assert.equal(read.mock.calls.length, 1);
});

test("send hands the host the complete invocation and returns the Gmail message identity", async () => {
  const send = vi.fn<NonNullable<GmailConnection["send"]>>(async () => json({ id: "sent-message", threadId: "thread" }));
  const fixture = gmail({ request: async () => assert.fail("No write through the read port"), send });
  const adapter = await fixture.registry.materialize(identity, declaration(["send"]));
  const invocation = { ...request("send", { raw: "ZGF0YQ" }), idempotencyKey: "host-intent" };
  assert.deepEqual((await adapter.execute(invocation, {})).output, { id: "sent-message", threadId: "thread" });
  assert.deepEqual(send.mock.calls[0][1], invocation);
});

test("polling emits discrete IDs, deduplicates, stops on revoked authorization and closes timers", async () => {
  vi.useFakeTimers();
  let status: ServiceDependencyStatus = { state: "ready" };
  const read = vi.fn(async () => json({ messages: [{ id: "first" }] }));
  const fixture = gmail({ request: read }, () => status);
  const adapter = await fixture.registry.materialize(identity, declaration(["watch"]));
  assert.ok(adapter.observe);
  const emit = vi.fn(async () => {});
  const onError = vi.fn();
  const handle = await adapter.observe(request("watch"), { kind: "feed", action: "subscribe", emit, onError });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(emit.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(emit.mock.calls.length, 1);
  read.mockImplementation(async () => json({ messages: [{ id: "first" }, { id: "second" }] }));
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(emit.mock.calls.length, 2);
  status = { state: "authorization-required", message: "Revoked" };
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(onError.mock.calls.length, 1);
  await handle.close("unsubscribe");
  const count = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  assert.equal(read.mock.calls.length, count);
});

test("closing an in-flight poll aborts the transport and suppresses late delivery", async () => {
  vi.useFakeTimers();
  let complete: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  const fixture = gmail({ request: async (input) => {
    signal = input.signal;
    return new Promise<Response>((resolve) => { complete = resolve; });
  } });
  const adapter = await fixture.registry.materialize(identity, declaration(["watch"]));
  assert.ok(adapter.observe);
  const emit = vi.fn(async () => {});
  const handle = await adapter.observe(request("watch"), { kind: "feed", action: "subscribe", emit, onError: (error) => assert.fail(String(error)) });
  await vi.advanceTimersByTimeAsync(0);
  const closing = handle.close("unsubscribe");
  assert.equal(signal?.aborted, true);
  assert.ok(complete);
  complete(json({ messages: [{ id: "late" }] }));
  await closing;
  assert.equal(emit.mock.calls.length, 0);
});

function scheduler(expression: string, timezone: string) {
  const registry = new ServiceKindRegistry();
  registry.register(createSchedulerServiceKind());
  const declaration: NativeServiceDeclaration = {
    kind: "cron-scheduler", version: "1", config: { expression, timezone },
    operations: { tick: { operation: "tick", contract: "scheduler.cron/v1", settlement,
      sense: { kind: "timer", signals: { due: { payloadSchema: { type: "object" } } } },
    } },
  };
  return { registry, declaration };
}

test("cron uses the explicit timezone across DST and cleans up on abort", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-08T13:29:59Z"));
  const fixture = scheduler("30 9 * * *", "America/New_York");
  const adapter = fixture.registry.materializeSync(identity, fixture.declaration);
  assert.ok(adapter.observe);
  const emit = vi.fn(async () => {});
  const controller = new AbortController();
  const handle = await adapter.observe(request("tick"), { kind: "timer", action: "schedule", signal: controller.signal, emit, onError: (error) => assert.fail(String(error)) });
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(emit.mock.calls.length, 1);
  controller.abort();
  await handle.close("cancel");
  await vi.advanceTimersByTimeAsync(86400000);
  assert.equal(emit.mock.calls.length, 1);
});

test("cron skips missed downtime occurrences and rejects malformed schedules", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const fixture = scheduler("* * * * *", "UTC");
  assert.equal((await fixture.registry.validate({ ...fixture.declaration, config: { expression: "bad cron", timezone: "UTC" } })).ok, false);
  const adapter = await fixture.registry.materialize(identity, fixture.declaration);
  assert.ok(adapter.observe);
  const emit = vi.fn(async () => {});
  const first = await adapter.observe(request("tick"), { kind: "timer", action: "schedule", emit, onError: (error) => assert.fail(String(error)) });
  await first.close("cancel");
  vi.setSystemTime(new Date("2026-01-05T00:00:30Z"));
  const second = await adapter.observe(request("tick"), { kind: "timer", action: "schedule", emit, onError: (error) => assert.fail(String(error)) });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(emit.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(30000);
  assert.equal(emit.mock.calls.length, 1);
  await second.close("cancel");
});

test("cron does not overlap an outstanding delivery and close waits for it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const fixture = scheduler("* * * * *", "UTC");
  const adapter = await fixture.registry.materialize(identity, fixture.declaration);
  assert.ok(adapter.observe);
  let complete: (() => void) | undefined;
  const emit = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  const handle = await adapter.observe(request("tick"), { kind: "timer", action: "schedule", emit, onError: (error) => assert.fail(String(error)) });
  await vi.advanceTimersByTimeAsync(180000);
  assert.equal(emit.mock.calls.length, 1);
  let closed = false;
  const closing = Promise.resolve(handle.close("cancel")).then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.ok(complete);
  complete();
  await closing;
  await vi.advanceTimersByTimeAsync(60000);
  assert.equal(emit.mock.calls.length, 1);
});
