import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { SyncJsonataExpressionProvider, type Json, type OrchestratorEffect } from "gik-kernel";
import {
  applyBlueprintPatches,
  createBlueprintDurableBootstrapEvent,
  createBlueprintDurableTransitionAdapter,
  materializeBlueprint,
  parseBlueprintReference,
} from "gik-blueprint";
import { resolveSampleBlueprintSource } from "../bootstrap/catalog/blueprint-catalog";
import { createSourceSettlementEvent, openHeadlessDurableBlueprint } from "../headless/blueprint-harness";
import { createContextStoreServiceKind, ServiceKindRegistry } from "gik-controlface/services";
import type { DurableStorageConnection } from "../service-kinds/durable-storage";
import { createContextStoreExecutor, type ContextStoreInvocation } from "../service-kinds/context-store/runtime";

const blueprint = JSON.parse(readFileSync(
  new URL("../bootstrap/blueprints/portfolio-tracker-new/blueprint.json", import.meta.url), "utf8",
)).payload;
const actor = blueprint.cells["portfolio-intelligence"];
const provider = new SyncJsonataExpressionProvider();

test("portfolio DPP keeps stable scope across valuations, gates stale evidence, and authors retry-stable records", () => {
  const [query, ingest] = actor.dpp.context.sources;
  const context = {
    portfolio: { id: blueprint.runtime.state.portfolio.id },
    inputs: {
      portfolioId: blueprint.runtime.state.portfolio.id,
      "portfolio-value": { positions: { AAPL: { value: 100 } }, summary: { marketValue: 100 } },
      refreshGeneration: 1,
      savedReportEnvelope: { found: false },
    },
    dpp: { manifest: actor.dpp.manifest },
    fetched_sources: {},
  };
  const request = provider.eval(query.input.expr, context) as any;
  const response = {
    scope: request.scope,
    requestKey: request.requestKey,
    records: [{ id: "prior", kind: "portfolio-observation", observedAt: "2026-01-01T00:00:00Z" }],
  };
  const output = provider.eval(query.output.expr, { response }) as any;
  const settled = { ...context, fetched_sources: { [query.id]: output } };
  const recordInput = provider.eval(ingest.input.expr, settled) as any;
  assert.equal(provider.eval(ingest.when, settled), true);
  assert.deepEqual(provider.eval(ingest.input.expr, settled), recordInput);
  assert.equal(recordInput.scope, request.scope);
  assert.equal(recordInput.records[0].observedAt, output.observedAt);
  assert.deepEqual(recordInput.records[0].content.portfolioValue, context.inputs["portfolio-value"]);
  const ingested = {
    ...settled,
    fetched_sources: {
      ...settled.fetched_sources,
      [ingest.id]: { scope: request.scope, recordIds: recordInput.records.map((record: any) => record.id), status: "stored" },
    },
  };
  assert.deepEqual(provider.eval(query.input.expr, ingested), request);
  assert.deepEqual(provider.eval(ingest.input.expr, ingested), recordInput);
  assert.notEqual(provider.eval(query.when, settled), true);
  assert.notEqual(provider.eval(ingest.when, ingested), true);
  assert.deepEqual(
    provider.eval(actor.sources[0].input.expr, ingested),
    provider.eval(actor.sources[0].input.expr, settled),
  );
  const changed = structuredClone(settled);
  changed.inputs["portfolio-value"].summary.marketValue = 120;
  const next = provider.eval(query.input.expr, changed) as any;
  assert.equal(next.scope, request.scope);
  assert.notEqual(next.requestKey, request.requestKey);
  assert.notEqual(provider.eval(ingest.when, changed), true);
  assert.notEqual(provider.eval(actor.sources[0].when, changed), true);
  const activeInputs = [actor, ...blueprint.serviceRecipes.flatMap((recipe: any) =>
    recipe.implementationPrograms.map((program: any) => program.cells?.["portfolio-intelligence"]).filter(Boolean))];
  for (const cell of activeInputs) {
    for (const source of cell.sources) {
      const input = provider.eval(source.input.expr, settled) as any;
      assert.deepEqual(input.purpose, actor.dpp.manifest);
      assert.deepEqual(input.evidence.history, response.records);
      if (source.when !== "false") assert.equal(provider.eval(source.when, settled), true);
      const report = { markdown: "# Current report" };
      const output = provider.eval(source.output.expr, { ...settled, response: report }) as any;
      assert.equal(output.requestKey, request.requestKey);
      assert.deepEqual(
        cell.compute?.some(({ id }: { id: string }) => id === "generated-portfolio-report")
          && source.id === "portfolio-semantic-intelligence.source"
          ? output.report.report
          : output.report,
        report,
      );
    }
  }
});

test("semantic intelligence preserves saved-report envelopes and suppresses stale snapshot output", () => {
  const report = { markdown: "# Current analysis" };
  for (const recipe of blueprint.serviceRecipes) {
    for (const program of recipe.implementationPrograms) {
      const cell = program.cells?.["portfolio-intelligence"];
      const computation = cell?.compute?.find(({ id }: { id: string }) => id === "generated-portfolio-report");
      if (!computation) continue;
      const source = cell.sources.find(({ id }: { id: string }) => id === "portfolio-semantic-intelligence.source");
      const inputs = {
        "portfolio-value": { summary: { marketValue: 100 } },
        refreshGeneration: 1,
        analysisContext: { portfolioKey: "portfolio-snapshot" },
      };
      const output = provider.eval(source.output.expr, { inputs, response: report }) as any;
      const context = { inputs, fetched_sources: { [source.id]: output } };
      const envelope = provider.eval(computation.expression, context) as any;
      assert.equal(envelope.found, true);
      assert.deepEqual(envelope.report, report);
      assert.equal(envelope.portfolioKey, inputs.analysisContext.portfolioKey);
      assert.equal(envelope.requestId, "1");
      assert.ok(Number.isFinite(Date.parse(envelope.asOf)));
      const [, presentation, providerId] = program.id.match(/^semantic-(.+)-(foundry|copilot)$/)!;
      assert.equal(envelope.analysisKey, `${providerId}/${presentation}`);
      const save = blueprint.cells["portfolio-intelligence-resolution"].sources[0];
      const saveInput = provider.eval(save.input.expr, {
        inputs: {
          ...inputs,
          analysisContext: { ...inputs.analysisContext, analysisKey: envelope.analysisKey },
          generatedReport: envelope,
        },
      }) as Record<string, Json>;
      assert.deepEqual({ ...saveInput }, {
        portfolio_key: "portfolio-snapshot", analysis_key: envelope.analysisKey, report: envelope,
      });
      const changed = { ...context, inputs: { ...inputs, refreshGeneration: 2 } };
      assert.equal(provider.eval(computation.expression, changed), null);
      assert.notEqual(provider.eval(actor.outputs[0].when, changed), true);
    }
  }
});

test("durable portfolio ignores stale retrieval and settles retry-idempotent ingestion without a feedback loop", async () => {
  const values = new Map<string, Json>();
  const connection: DurableStorageConnection = {
    ref: "test:portfolio",
    api: {
      async dispatch({ operation, args = [] }) {
        const key = String(args[0]);
        if (operation === "read") return values.get(key);
        if (operation === "write") { values.set(key, args[1] as Json); return null; }
        if (operation === "listKeys") return [...values.keys()].filter((value) => value.startsWith(key));
        throw new Error(`Unexpected operation '${operation}'`);
      },
    },
  };
  const execute = createContextStoreExecutor({ "portfolio-context": connection });
  const registry = new ServiceKindRegistry({ execute: (request) => execute(request as ContextStoreInvocation) });
  registry.register(createContextStoreServiceKind());
  const declaration = blueprint.services["portfolio-context"];
  const adapter = await registry.materialize({
    blueprintId: "portfolio-tracker-new", blueprintRevision: "1.0.0", serviceId: "portfolio-context",
  }, declaration);
  const invoke = async (effect: OrchestratorEffect) => {
    assert.equal(effect.kind, "invoke");
    const control = (effect as any).control;
    const operation = control.tool as "query" | "ingest";
    return (await adapter.execute({
      id: crypto.randomUUID(), service: "portfolio-context", operation,
      providerId: adapter.provider.id, capabilityId: declaration.operations[operation].contract,
      createdAt: new Date().toISOString(),
      input: provider.eval(control.sourceInputTransform.expr, control.sourceInputs),
    }, {})).output!;
  };
  const source = (effects: readonly OrchestratorEffect[], id: string) => {
    const effect = effects.find((effect) => effect.kind === "invoke" && effect.control.sourceId === id);
    assert.ok(effect, `Expected source '${id}'`);
    return effect;
  };
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new", {
    "intelligence-model": "mock", "market-prices": "mock", view: "desktop",
  });
  const initial = await session.transition([createBlueprintDurableBootstrapEvent()]);
  const valued = await session.transition([createSourceSettlementEvent(source(initial.effects, "market-prices.source"), {
    quotes: { AAPL: { ticker: "AAPL", price: 150 }, MSFT: { ticker: "MSFT", price: 200 } }, provider: "mock",
  })]);
  const previousQuery = source(valued.effects, "portfolio-context.query");
  const refreshed = await session.transition([{
    node: "portfolio-intelligence--primary--in-intelligence", name: "press", payload: {},
  }]);
  const stale = await session.transition([createSourceSettlementEvent(previousQuery, await invoke(previousQuery))]);
  assert.ok(stale.effects.every((effect) => effect.kind !== "invoke"
    || !["portfolio-context.ingest", "portfolio-intelligence.source"].includes(String(effect.control.sourceId))));
  const currentQuery = source([...refreshed.effects, ...stale.effects], "portfolio-context.query");
  const current = await session.transition([createSourceSettlementEvent(currentQuery, await invoke(currentQuery))]);
  const ingest = source(current.effects, "portfolio-context.ingest");
  const intelligence = source(current.effects, "portfolio-intelligence.source");
  const acknowledgment = await invoke(ingest);
  assert.deepEqual(await invoke(ingest), acknowledgment);
  assert.equal(values.size, 1);
  const ingestionEvent = createSourceSettlementEvent(ingest, acknowledgment);
  assert.deepEqual((await session.transition([ingestionEvent])).effects, []);
  assert.deepEqual((await session.transition([createSourceSettlementEvent(intelligence, {
    markdown: "# Intelligence", provider: "mock",
  })])).effects, []);
  assert.deepEqual((await session.transition([ingestionEvent])).effects, []);
  assert.deepEqual((await session.restart().transition([])).effects, []);
});

test("every intelligence provider request carries purpose and selected evidence without replacing its response contract", () => {
  const serviceMaps = [blueprint.services, ...blueprint.serviceRecipes.flatMap((recipe: any) =>
    recipe.implementationPrograms.map((program: any) => program.services ?? {}))];
  for (const services of serviceMaps) {
    for (const [id, service] of Object.entries(services) as [string, any][]) {
      if (!id.includes("intelligence") || !service.kind) continue;
      for (const operation of Object.values(service.operations) as any[]) {
        const request = provider.eval(operation.request.transform.expr, {
          input: { purpose: actor.dpp.manifest, evidence: { history: [{ id: "prior-observation" }] } },
        }) as any;
        assert.match(request.message, /portfolio-value/);
        assert.match(request.message, /prior-observation/);
        assert.match(request.message, /never infer trading authority/);
      }
    }
  }
  const ids = [...actor.sources, ...actor.dpp.context.sources, ...(actor.senses ?? []), ...(actor.dpp.context.senses ?? [])]
    .map(({ id }: { id: string }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(actor.kind, undefined);
  assert.ok(blueprint.cells["portfolio-holdings"]);
  assert.ok(blueprint.cells["market-prices"]);
  assert.ok(blueprint.cells["portfolio-value-cell"]);
});

test("mock intelligence consumes purpose and historical evidence while retaining its Markdown response shape", () => {
  const mock = JSON.parse(readFileSync(
    new URL("../bootstrap/blueprints/portfolio-tracker-mock/blueprint.json", import.meta.url), "utf8",
  )).payload;
  const expression = mock.cells["mock-controller"].behavior.on.analyze[0].args.from;
  const event = {
    positions: { AAPL: { ticker: "AAPL", value: 100 } },
    summary: { marketValue: 100, gainLoss: 10 },
    purpose: actor.dpp.manifest,
    evidence: { history: [{ id: "prior" }] },
  };
  const report = provider.eval(`($event := event; ${expression})`, { event }) as any;
  assert.deepEqual(Object.keys(report).sort(), ["markdown", "provider"]);
  assert.match(report.markdown, /Portfolio reality and value participant/);
  assert.match(report.markdown, /Prior evidence records: 1/);
  assert.match(report.markdown, /Market value: 100/);
});

test("withdrawing portfolio intelligence leaves holdings, price retrieval, and valuation operational", async () => {
  const source = structuredClone(resolveSampleBlueprintSource("portfolio-tracker-new"));
  source.payload.structureMode = "reconfigurable";
  const externalContext = { "intelligence-model": "mock", "market-prices": "mock", view: "desktop" };
  const resolveBlueprint = (reference: string) => resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
  const original = materializeBlueprint({
    blueprint: source,
    externalContext,
    resolveBlueprint,
  });
  const withdrawn = applyBlueprintPatches({
    blueprint: source, externalContext, state: original.payload.initialState,
    patch: [{ op: "removeCell", cellId: "portfolio-intelligence" }], origin: "authorized",
    resolveBlueprint,
  });
  const adapter = createBlueprintDurableTransitionAdapter({
    blueprint: withdrawn.blueprint, externalContext, materializedBlueprint: withdrawn.materializedBlueprint,
  });
  let spec = adapter.initialSpec();
  const initial = await adapter.transition({
    state: adapter.initialState(), spec, events: [createBlueprintDurableBootstrapEvent()],
  });
  const quoteRequest = initial.effects.find((effect) => effect.kind === "invoke" && effect.control.sourceRequestToken);
  assert.ok(quoteRequest);
  if (initial.specUpdates?.length) spec = adapter.applySpecUpdates({ spec, updates: initial.specUpdates });
  const settled = await adapter.transition({
    state: initial.state, spec,
    events: [createSourceSettlementEvent(quoteRequest, {
      quotes: { AAPL: { ticker: "AAPL", price: 150 }, MSFT: { ticker: "MSFT", price: 200 } },
      provider: "mock",
    })],
  });
  const portfolio = settled.state.portfolio as any;
  assert.deepEqual(portfolio.holdings, blueprint.runtime.state.portfolio.holdings);
  assert.equal(portfolio.stockQuotes.AAPL.price, 150);
  assert.equal(portfolio.value.summary.marketValue, 900);
});
