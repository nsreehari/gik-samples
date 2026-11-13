import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { test } from "vitest";
import { createBlueprintDurableBootstrapEvent, createBlueprintDurableEffectSettlementEvent } from "gik-blueprint";
import { DefaultServiceHost, ServiceKindRegistry, type ServiceRequest } from "gik-controlface/services";
import { InMemoryStateModel, JsonataExpressionProvider, SyncJsonataExpressionProvider, type Json, type OrchestratorEffect } from "gik-kernel";
import { materializeSampleBlueprint } from "../bootstrap/catalog/blueprint-catalog";
import { createSourceSettlementEvent, openHeadlessDurableBlueprint } from "../headless/blueprint-harness";
import { createFoundryAgentKind } from "../service-kinds/foundry-agent";

const source = JSON.parse(readFileSync(
  new URL("../bootstrap/blueprints/portfolio-tracker-new/blueprint.json", import.meta.url), "utf8",
)).payload;
const intakeAgent = JSON.parse(readFileSync(
  new URL("../bootstrap/blueprints/portfolio-tracker-new/foundry-intake-agent.json", import.meta.url), "utf8",
)).agents[0];
const expression = new SyncJsonataExpressionProvider();
const node = "portfolio-intelligence--intake--in-holdings";
const fileNode = "portfolio-intelligence--intake-file--in-holdings";
const updated = {
  status: "updated", changes: [{ ticker: "AAPL", quantity: 5, costBasis: 95 }],
  summary: "Updated AAPL to 5 shares at a per-share cost basis of 95.",
};
const file = { name: "holdings.csv", type: "text/csv", size: 40, lastModified: 1, text: "ticker,quantity,costBasis\nAAPL,5,95", encoding: "text" };
interface Portfolio extends Record<string, Json> {
  holdings: Record<string, { ticker: string; quantity: number; costBasis: number }>;
  intake: {
    revision: number; saving: boolean; file: typeof file | null; note: string;
    summary: string; error: string; pending: Json; lastSubmission: Json;
  };
}

function sourceEffect(effects: readonly OrchestratorEffect[], id: string) {
  const effect = effects.find((effect) => effect.kind === "invoke" && effect.control.sourceId === id);
  assert.ok(effect, `Expected source '${id}'`);
  assert.ok(effect.kind === "invoke");
  return effect;
}

async function fixture(ai = "foundry", serviceRegistry?: ServiceKindRegistry) {
  const context = { "intelligence-model": "mock", "market-prices": "mock", ai, view: "desktop" };
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new", context);
  const initial = await session.transition([createBlueprintDurableBootstrapEvent()]);
  const query = sourceEffect(initial.effects, "portfolio-context.query");
  const queryInput = expression.eval(query.control.sourceInputTransform!.expr, query.control.sourceInputs!) as Record<string, Json>;
  await session.transition([createSourceSettlementEvent(query, {
    scope: "portfolio:portfolio-demo", requestKey: queryInput.requestKey, records: [],
  })]);
  const materialized = materializeSampleBlueprint("portfolio-tracker-new", context);
  const declaration = materialized.payload.terminalBlueprint.payload.services!["portfolio-intake"];
  assert.ok("kind" in declaration);
  const calls: ServiceRequest[] = [];
  let response: Json = updated;
  let transportError: Error | undefined;
  const registry = serviceRegistry ?? new ServiceKindRegistry();
  if (!serviceRegistry) registry.register({
    manifest: {
      id: declaration.kind, version: "1", configSchema: { type: "object" },
      subjects: ["cell"], executionModes: ["immediate"],
    },
    create: () => ({
      provider: { id: declaration.kind, version: "1" },
      discover: async () => ({ provider: { id: declaration.kind, version: "1" }, revision: "1", discoveredAt: "now", capabilities: [] }),
      execute: async (request) => {
        calls.push(request);
        if (transportError) throw transportError;
        return { output: response };
      },
    }),
  });
  const invoke = async (effect: OrchestratorEffect) => {
    assert.ok(effect.kind === "invoke");
    const state = new InMemoryStateModel(["portfolio"]);
    state.apply([{ op: "set", path: "portfolio", value: session.snapshot().portfolio }]);
    const host = new DefaultServiceHost({
      blueprintId: "portfolio-tracker-new", blueprintRevision: "1",
      registry, declarations: { "portfolio-intake": declaration }, state,
      expression: new JsonataExpressionProvider(),
    });
    const result = await host.invoke(effect);
    assert.ok(result);
    return createBlueprintDurableEffectSettlementEvent(crypto.randomUUID(), result, effect);
  };
  const submit = async (note = "Update my AAPL holding", attachment: Json | null = file) => {
    if (attachment) await session.transition([{ node: fileNode, name: "select", payload: { file: attachment, files: [attachment] } }]);
    const portfolio = session.snapshot().portfolio as Portfolio;
    const transition = await session.transition([{
      node, name: "save", payload: { values: { note, revision: portfolio.intake.revision + 1 } },
    }]);
    const effect = transition.effects.find((effect) => effect.kind === "invoke" && effect.control.tool === "processSubmission");
    assert.ok(effect);
    return effect;
  };
  return {
    session, calls, submit, invoke, respond: (value: Json) => { response = value; },
    fail: (error: Error) => { transportError = error; }, kind: declaration.kind,
  };
}

test.each(["matching", "mismatched"])("Foundry intake respects named-agent schema admission through the real adapter: %s", async (contract) => {
  const requests: Record<string, Json>[] = [];
  const registry = new ServiceKindRegistry({
    hostCapabilities: ["foundry-executor", "credential-resolver"],
    resolveCredential: async (reference) => {
      assert.equal(reference, "foundry-agent/access-key");
      return "test-credential";
    },
    authorizeEndpoint: (kind, endpoint) =>
      kind === "foundry-agent" && endpoint.origin === "https://sz-foundry-proxy.azurewebsites.net",
  });
  registry.register(createFoundryAgentKind(async (url, init) => {
    assert.equal(String(url), "https://sz-foundry-proxy.azurewebsites.net/api/agent/chat");
    assert.equal(init?.method, "POST");
    const request = JSON.parse(String(init?.body)) as Record<string, Json>;
    requests.push(request);
    const format = request.responseSchema as Record<string, Json>;
    const configuredSchema = contract === "matching"
      ? intakeAgent.definition.text.format.schema
      : { ...intakeAgent.definition.text.format.schema, required: ["different-contract"] };
    if (request.agentName !== intakeAgent.id || !isDeepStrictEqual(format.schema, configuredSchema)) {
      return new Response(JSON.stringify({
        error: "Requested response schema does not match the named agent configuration",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      conversationId: "intake-conversation", responseId: "intake-response",
      reply: JSON.stringify(updated), toolCalls: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const f = await fixture("foundry", registry);
  const effect = await f.submit();
  await f.session.transition([await f.invoke(effect)]);
  const portfolio = f.session.snapshot().portfolio as Portfolio;
  assert.equal(portfolio.intake.saving, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].agentName, intakeAgent.id);
  assert.deepEqual(requests[0].allowedTools, []);
  if (contract === "matching") {
    assert.equal(portfolio.intake.error, "");
    assert.deepEqual(portfolio.holdings.AAPL, updated.changes[0]);
    assert.equal(portfolio.intake.file, null);
  } else {
    assert.match(portfolio.intake.error, /Requested response schema does not match/);
    assert.deepEqual(portfolio.holdings, source.runtime.state.portfolio.holdings);
    assert.deepEqual(portfolio.intake.file, file);
    assert.equal(portfolio.intake.note, "Update my AAPL holding");
  }
});

test.each(["foundry", "copilot"])("portfolio DPP processes a file/note, preserves other holdings, clears inputs and records context: %s", async (ai) => {
  const f = await fixture(ai);
  assert.equal(f.kind, ai === "copilot" ? "copilot-agent" : "foundry-agent");
  const effect = await f.submit();
  const result = await f.session.transition([await f.invoke(effect)]);
  const portfolio = result.state.portfolio as Portfolio;
  assert.deepEqual(portfolio.holdings.AAPL, updated.changes[0]);
  assert.deepEqual(portfolio.holdings.MSFT, source.runtime.state.portfolio.holdings.MSFT);
  assert.equal(portfolio.intake.saving, false);
  assert.equal(portfolio.intake.file, null);
  assert.equal(portfolio.intake.note, "");
  assert.equal(portfolio.intake.pending, null);
  assert.equal(portfolio.intake.summary, updated.summary);
  const request = f.calls[0].input as Record<string, Json>;
  assert.match(String(request.message), /Portfolio reality and value participant/);
  assert.match(String(request.message), /holdings.csv/);
  assert.match(String(request.message), /Update my AAPL holding/);
  const ingest = sourceEffect(result.effects, "portfolio-intake.ingest");
  const ingestion = expression.eval(ingest.control.sourceInputTransform!.expr, ingest.control.sourceInputs!) as Record<string, Json>;
  assert.equal(ingestion.scope, "portfolio:portfolio-demo");
  const records = ingestion.records as Record<string, Json>[];
  assert.deepEqual(records, [portfolio.intake.lastSubmission]);
  assert.deepEqual(records[0].content, {
    note: "Update my AAPL holding", fileName: file.name,
    changes: updated.changes, summary: updated.summary,
  });
  await f.session.transition([createSourceSettlementEvent(ingest, { scope: ingestion.scope, recordIds: records.map((r) => r.id), status: "stored" })]);
  assert.ok((await f.session.restart().transition([])).effects.every(
    (effect) => effect.kind !== "invoke" || effect.control.sourceId !== "portfolio-intake.ingest",
  ));
});

test.each(["clarification", "invalid-output", "duplicate-ticker", "invalid-file", "oversized-file", "transport"])("failed intake retains the draft and never changes holdings: %s", async (failure) => {
  const f = await fixture();
  if (failure === "clarification") f.respond({ status: "needs-input", changes: [], summary: "What is the per-share cost basis?" });
  if (failure === "invalid-output") f.respond({ ...updated, changes: [{ ticker: "AAPL", quantity: -2, costBasis: 95 }] });
  if (failure === "duplicate-ticker") f.respond({ ...updated, changes: [updated.changes[0], updated.changes[0]] });
  if (failure === "transport") f.fail(new Error("Configured AI connection is unavailable"));
  const attachment = failure === "invalid-file" ? { ...file, name: "statement.pdf" }
    : failure === "oversized-file" ? { ...file, size: 100001 } : file;
  const effect = await f.submit("Update my holding", attachment);
  await f.session.transition([await f.invoke(effect)]);
  const portfolio = f.session.snapshot().portfolio as Portfolio;
  assert.deepEqual(portfolio.holdings, source.runtime.state.portfolio.holdings);
  assert.ok(portfolio.intake.file);
  assert.equal(portfolio.intake.file.name, attachment.name);
  assert.equal(portfolio.intake.note, "Update my holding");
  assert.equal(portfolio.intake.saving, false);
  assert.ok(portfolio.intake.error);
  if (["invalid-file", "oversized-file"].includes(failure)) {
    assert.equal(f.calls.length, 0);
    assert.match(portfolio.intake.error, /Choose a CSV, JSON or text file of at most 100 KB/);
  }
});

test.each(["file-only", "note-only"])("intake accepts a submission without the other input: %s", async (mode) => {
  const f = await fixture();
  const effect = await f.submit(mode === "file-only" ? "" : "Set AAPL to 5 shares at 95", mode === "file-only" ? file : null);
  await f.session.transition([await f.invoke(effect)]);
  const portfolio = f.session.snapshot().portfolio as Portfolio;
  assert.equal(portfolio.intake.error, "");
  assert.deepEqual(portfolio.holdings.AAPL, updated.changes[0]);
  assert.equal(f.calls.length, 1);
});

test("intake ignores duplicate/late results and refuses to overwrite an intervening holdings edit", async () => {
  const f = await fixture();
  const first = await f.submit();
  const settled = await f.invoke(first);
  await f.session.transition([{ node: "portfolio-holdings--primary--in-holdings", name: "save", payload: {
    rows: [{ ticker: "AAPL", quantity: 7, costBasis: 90 }],
  } }]);
  await f.session.transition([settled]);
  let portfolio = f.session.snapshot().portfolio as Portfolio;
  assert.equal(portfolio.holdings.AAPL.quantity, 7);
  assert.match(portfolio.intake.error, /Holdings changed/);
  const second = await f.submit("Set AAPL to 5 shares at 95", null);
  await f.session.transition([createBlueprintDurableEffectSettlementEvent(crypto.randomUUID(), {
    events: [{ node, name: "intake-result", payload: { ...updated, revision: 1 } }],
  }, first)]);
  assert.equal((f.session.snapshot().portfolio as typeof portfolio).intake.saving, true);
  const completed = await f.invoke(second);
  await f.session.transition([completed]);
  const after = f.session.snapshot();
  assert.deepEqual((await f.session.transition([completed])).state, after);
  portfolio = after.portfolio as typeof portfolio;
  assert.equal(portfolio.holdings.AAPL.quantity, 5);
  assert.equal(portfolio.intake.saving, false);
});

test("intake remains available across desktop/mobile and every intelligence mode without requiring a positive valuation", () => {
  for (const view of ["desktop", "mobile"]) {
    for (const ai of ["foundry", "copilot"]) {
      for (const model of ["simple", "mock", "semantic"]) {
        const materialized = materializeSampleBlueprint("portfolio-tracker-new", {
          view, ai, "intelligence-model": model, "market-prices": "mock",
        });
        const b = materialized.payload.terminalBlueprint.payload;
        const intake = b.cells!["portfolio-intelligence"].potentialViews!.intake;
        assert.equal(intake.capability, "primitive:form");
        assert.equal(b.cells!["portfolio-intelligence"].potentialViews!["intake-file"].capability, "primitive:file-input");
        const service = b.services!["portfolio-intake"];
        assert.ok("kind" in service);
        assert.equal(service.kind, ai === "copilot" ? "copilot-agent" : "foundry-agent");
      }
    }
  }
  const query = source.cells["portfolio-intelligence"].dpp.context.sources[0];
  assert.equal(expression.eval(query.when, {
    inputs: { portfolioId: "empty", "portfolio-value": { summary: { marketValue: 0 } }, refreshGeneration: 0 },
    fetched_sources: {},
  }), true);
});
