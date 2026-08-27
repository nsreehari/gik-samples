import assert from "node:assert/strict";
import { test } from "vitest";
import {
  materializeBlueprint,
  parseBlueprintReference,
  runMaterializedTransition,
} from "@gik-ai/blueprint";

import {
  getSampleBlueprintCatalog,
  resolveSampleBlueprintSource,
} from "../bootstrap/catalog/blueprint-catalog";
import {
  collectScenarioObservation,
  evaluateScenarioWait,
  flattenScenarioActs,
  parseScenarioDocument,
  validateScenarioDocumentTarget,
} from "./scenario-document";

test("catalog scenarios flatten hierarchical acts and transition the Blueprint directly", async () => {
  const document = getSampleBlueprintCatalog().scenarios["portfolio-tracker-new"];
  assert.ok(document);
  const scenario = document.scenarios[0];
  const acts = flattenScenarioActs(scenario);
  assert.equal(scenario.steps.length, 5);
  assert.equal(acts.length, 18);
  const wordCount = (value: string) => value.trim().split(/\s+/).length;
  for (const step of scenario.steps) {
    assert.ok(step.description, `Expected step '${step.id}' to have a description.`);
    assert.ok(wordCount(step.description) <= 12, `Step '${step.id}' description is too long.`);
  }
  for (const act of acts) {
    assert.ok(act.description, `Expected act '${act.id}' to have a description.`);
    assert.ok(wordCount(act.title) <= 5, `Act '${act.id}' title is too long.`);
    assert.ok(wordCount(act.description) <= 12, `Act '${act.id}' description is too long.`);
  }
  assert.equal(acts[0].stepId, "replace-positions");
  assert.equal(acts[0].isStepStart, true);
  assert.equal(acts[0].isStepEnd, false);
  assert.equal(acts[3].isStepEnd, true);
  assert.equal(acts[4].stepId, "add-aapl");
  assert.equal(acts[8].stepId, "remove-nvda");
  assert.equal(acts[12].stepId, "increase-goog");
  assert.equal(acts[16].stepId, "review-intelligence");
  assert.equal(acts[17].isStepEnd, true);
  assert.ok("event" in acts[0]);
  assert.ok("wait" in acts[1]);
  assert.ok("wait" in acts[2]);
  assert.ok("observe" in acts[3]);

  const blueprint = resolveSampleBlueprintSource(document.blueprint);
  const context = document.contextPresets[scenario.contextPreset!].context;
  const materialized = materializeBlueprint({
    blueprint,
    externalContext: context,
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });
  const result = await runMaterializedTransition({
    materializedBlueprint: materialized,
    state: materialized.payload.initialState,
    events: ["event" in acts[0] ? acts[0].event : (() => { throw new Error("Expected event act."); })()],
  });

  assert.deepEqual(result.state.portfolio, {
    ...(result.state.portfolio as Record<string, unknown>),
    holdings: {
      MSFT: { ticker: "MSFT", quantity: 10, costBasis: 400 },
      NVDA: { ticker: "NVDA", quantity: 4, costBasis: 180 },
      GOOG: { ticker: "GOOG", quantity: 10, costBasis: 150 },
    },
  });
  const actById = (id: string) => {
    const act = acts.find((candidate) => candidate.id === id);
    if (!act) throw new Error(`Expected scenario act '${id}'.`);
    return act;
  };
  const settledState = structuredClone(result.state);
  const portfolio = settledState.portfolio as Record<string, any>;
  portfolio.holdings = {
    MSFT: { ticker: "MSFT", quantity: 10, costBasis: 400 },
    GOOG: { ticker: "GOOG", quantity: 15, costBasis: 150 },
    AAPL: { ticker: "AAPL", quantity: 6, costBasis: 190 },
  };
  portfolio.stockQuotes = {
    MSFT: { ticker: "MSFT", price: 357.81 },
    GOOG: { ticker: "GOOG", price: 334.57 },
    AAPL: { ticker: "AAPL", price: 229.31 },
  };
  portfolio.value = {
    positions: {
      MSFT: { ticker: "MSFT", quantity: 10, price: 357.81, value: 3578.1 },
      GOOG: { ticker: "GOOG", quantity: 15, price: 334.57, value: 5018.55 },
      AAPL: { ticker: "AAPL", quantity: 6, price: 229.31, value: 1375.86 },
    },
    summary: { marketValue: 9972.51, costBasis: 7390, gainLoss: 2582.51 },
  };
  portfolio.intelligence = {
    provider: "portfolio-intelligence-mock",
    markdown: "# Mock portfolio intelligence\n\nPositions: MSFT, GOOG, AAPL",
  };
  const scope = { state: settledState, context };
  for (const id of [
    "wait-for-aapl-price",
    "wait-for-aapl-valuation",
    "wait-for-nvda-removal",
    "wait-for-revalued-portfolio",
    "wait-for-goog-quantity",
    "wait-for-goog-revaluation",
    "wait-for-portfolio-intelligence",
  ]) {
    const act = actById(id);
    if (!("wait" in act)) throw new Error(`Expected '${id}' to be a wait act.`);
    assert.equal(await evaluateScenarioWait(act, scope), true);
  }
  const aaplObservation = actById("observe-aapl-valuation");
  if (!("observe" in aaplObservation)) throw new Error("Expected AAPL observation act.");
  assert.deepEqual(await collectScenarioObservation(aaplObservation, scope), {
    aaplQuote: 229.31,
    aaplPositionValue: 1375.86,
    portfolioMarketValue: 9972.51,
  });
  const removalObservation = actById("observe-nvda-removal");
  if (!("observe" in removalObservation)) throw new Error("Expected NVDA observation act.");
  assert.deepEqual(await collectScenarioObservation(removalObservation, scope), {
    nvdaHoldingRemoved: true,
    nvdaValuationRemoved: true,
    portfolioMarketValue: 9972.51,
  });
  const googObservation = actById("observe-goog-revaluation");
  if (!("observe" in googObservation)) throw new Error("Expected GOOG observation act.");
  assert.deepEqual(await collectScenarioObservation(googObservation, scope), {
    googQuantity: 15,
    googPositionValue: 5018.55,
    portfolioMarketValue: 9972.51,
  });
  const intelligenceObservation = actById("observe-goog-intelligence");
  if (!("observe" in intelligenceObservation)) throw new Error("Expected intelligence observation act.");
  const intelligence = await collectScenarioObservation(intelligenceObservation, scope);
  assert.match(String(intelligence.report), /AAPL/);
});

test("scenario acts validate Cell ownership, event contracts, and payload schemas", () => {
  const blueprint = structuredClone(resolveSampleBlueprintSource("portfolio-tracker-new"));
  blueprint.payload.cells!["portfolio-holdings"].events!.save.payloadSchema = {
    type: "object",
    required: ["rows"],
    properties: { rows: { type: "array" } },
  };
  const valid = parseScenarioDocument({
    format: "gik-scenarios/1",
    blueprint: "portfolio-tracker-new",
    contextPresets: {},
    scenarios: [{
      id: "valid",
      title: "Valid",
      steps: [{
        id: "step",
        title: "Step",
        acts: [{
          id: "save",
          title: "Save",
          event: {
            node: "portfolio-holdings--primary--in-holdings",
            name: "save",
            payload: { rows: [] },
          },
        }],
      }],
    }],
  });
  assert.doesNotThrow(() => validateScenarioDocumentTarget(valid, blueprint));

  const wrongEvent = structuredClone(valid);
  const wrongEventAct = wrongEvent.scenarios[0].steps[0].acts[0];
  if (!("event" in wrongEventAct)) throw new Error("Expected event act.");
  wrongEventAct.event.name = "missing";
  assert.throws(
    () => validateScenarioDocumentTarget(wrongEvent, blueprint),
    /unknown event 'missing'/,
  );

  const wrongPayload = structuredClone(valid);
  const wrongPayloadAct = wrongPayload.scenarios[0].steps[0].acts[0];
  if (!("event" in wrongPayloadAct)) throw new Error("Expected event act.");
  wrongPayloadAct.event.payload = {};
  assert.throws(
    () => validateScenarioDocumentTarget(wrongPayload, blueprint),
    /Invalid payload for scenario act 'save'/,
  );

  const nonDispatchableNode = structuredClone(valid);
  const nonDispatchableAct = nonDispatchableNode.scenarios[0].steps[0].acts[0];
  if (!("event" in nonDispatchableAct)) throw new Error("Expected event act.");
  nonDispatchableAct.event.node = "portfolio-holdings";
  assert.throws(
    () => validateScenarioDocumentTarget(nonDispatchableNode, blueprint),
    /non-dispatchable event node 'portfolio-holdings'/,
  );
});

test("wait and observation acts evaluate settled state without dispatching events", async () => {
  const document = parseScenarioDocument({
    format: "gik-scenarios/1",
    blueprint: "sample",
    contextPresets: {},
    scenarios: [{
      id: "observe",
      title: "Observe",
      steps: [{
        id: "step",
        title: "Step",
        acts: [
          {
            id: "wait-price",
            title: "Wait for price",
            wait: {
              when: "$exists($state.portfolio.stockQuotes.GOOG.price)",
            },
          },
          {
            id: "price",
            title: "Observe price",
            observe: {
              select: {
                ticker: "'GOOG'",
                price: "$state.portfolio.stockQuotes.GOOG.price",
              },
            },
          },
        ],
      }],
    }],
  });
  const [wait, observe] = flattenScenarioActs(document.scenarios[0]);
  if (!("wait" in wait) || !("observe" in observe)) {
    throw new Error("Expected wait and observation acts.");
  }
  const context = {};
  assert.equal(await evaluateScenarioWait(wait, {
    state: { portfolio: { stockQuotes: { GOOG: { price: 123.45 } } } },
    context,
  }), true);
  assert.equal(await evaluateScenarioWait(wait, {
    state: { portfolio: { stockQuotes: {} } },
    context,
  }), false);
  assert.deepEqual(await collectScenarioObservation(observe, {
    state: { portfolio: { stockQuotes: { GOOG: { price: 123.45 } } } },
    context,
  }), { ticker: "GOOG", price: 123.45 });
});

test("unsupported formats and obsolete command documents are rejected", () => {
  assert.throws(
    () => parseScenarioDocument({
      format: "gik-scenarios/2",
      blueprint: "sample",
      commands: { run: { node: "cell", event: "run" } },
      contextPresets: {},
      scenarios: [],
    }),
    /Unsupported scenario document format/,
  );
  assert.throws(
    () => parseScenarioDocument({
      format: "gik-scenarios/1",
      blueprint: "sample",
      contextPresets: {},
      scenarios: [{
        id: "old",
        title: "Old",
        steps: [{ id: "dispatch", title: "Dispatch", kind: "dispatch", command: "run" }],
      }],
    }),
    /unknown field\(s\): kind, command/,
  );
});

test("scenario parsing rejects unknown fields at every document layer", () => {
  const valid = {
    format: "gik-scenarios/1",
    blueprint: "sample",
    contextPresets: {
      desktop: { label: "Desktop", context: { view: "desktop" } },
    },
    scenarios: [{
      id: "sample",
      title: "Sample",
      contextPreset: "desktop",
      steps: [{
        id: "step",
        title: "Step",
        acts: [{
          id: "wait",
          title: "Wait",
          wait: { when: "true" },
        }],
      }],
    }],
  };
  const invalidDocuments: Array<[string, unknown]> = [
    ["document", { ...valid, extra: true }],
    ["context preset", {
      ...valid,
      contextPresets: {
        desktop: { ...valid.contextPresets.desktop, extra: true },
      },
    }],
    ["scenario", {
      ...valid,
      scenarios: [{ ...valid.scenarios[0], extra: true }],
    }],
    ["step", {
      ...valid,
      scenarios: [{
        ...valid.scenarios[0],
        steps: [{ ...valid.scenarios[0].steps[0], extra: true }],
      }],
    }],
    ["act", {
      ...valid,
      scenarios: [{
        ...valid.scenarios[0],
        steps: [{
          ...valid.scenarios[0].steps[0],
          acts: [{ ...valid.scenarios[0].steps[0].acts[0], extra: true }],
        }],
      }],
    }],
    ["act body", {
      ...valid,
      scenarios: [{
        ...valid.scenarios[0],
        steps: [{
          ...valid.scenarios[0].steps[0],
          acts: [{
            ...valid.scenarios[0].steps[0].acts[0],
            wait: { when: "true", extra: true },
          }],
        }],
      }],
    }],
  ];

  for (const [layer, document] of invalidDocuments) {
    assert.throws(
      () => parseScenarioDocument(document),
      /contains unknown field\(s\): extra/,
      layer,
    );
  }
});

test("scenario parsing rejects invalid expressions, JSON values, and scenario-wide duplicate act IDs", () => {
  const scenario = {
    id: "sample",
    title: "Sample",
    steps: [
      {
        id: "first",
        title: "First",
        acts: [{ id: "same", title: "Wait", wait: { when: "true" } }],
      },
      {
        id: "second",
        title: "Second",
        acts: [{ id: "same", title: "Observe", observe: { select: { value: "1" } } }],
      },
    ],
  };
  assert.throws(
    () => parseScenarioDocument({
      format: "gik-scenarios/1",
      blueprint: "sample",
      contextPresets: {},
      scenarios: [scenario],
    }),
    /duplicate act IDs/,
  );
  assert.throws(
    () => parseScenarioDocument({
      format: "gik-scenarios/1",
      blueprint: "sample",
      contextPresets: {},
      scenarios: [{
        ...scenario,
        steps: [{
          ...scenario.steps[0],
          acts: [{ id: "wait", title: "Wait", wait: { when: "(" } }],
        }],
      }],
    }),
    /valid JSONata expression/,
  );
  assert.throws(
    () => parseScenarioDocument({
      format: "gik-scenarios/1",
      blueprint: "sample",
      contextPresets: {
        invalid: { label: "Invalid", context: { value: undefined } },
      },
      scenarios: [{
        id: "sample",
        title: "Sample",
        steps: [{
          id: "step",
          title: "Step",
          acts: [{ id: "wait", title: "Wait", wait: { when: "true" } }],
        }],
      }],
    }),
    /must contain JSON values/,
  );
});
