import assert from "node:assert/strict";
import { test } from "vitest";
import {
  materializeBlueprint,
  parseBlueprintReference,
  runMaterializedTransition,
} from "@gik/blueprint";

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
  assert.equal(acts.length, 6);
  assert.equal(acts[0].stepId, "replace-positions");
  assert.equal(acts[0].isStepStart, true);
  assert.equal(acts[0].isStepEnd, false);
  assert.equal(acts[3].isStepEnd, true);
  assert.equal(acts[4].stepId, "review-intelligence");
  assert.equal(acts[5].isStepEnd, true);
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
  const settledState = structuredClone(result.state);
  const portfolio = settledState.portfolio as Record<string, any>;
  portfolio.stockQuotes = {
    MSFT: { ticker: "MSFT", price: 357.81 },
    NVDA: { ticker: "NVDA", price: 233.74 },
    GOOG: { ticker: "GOOG", price: 334.57 },
  };
  portfolio.value = {
    positions: {
      MSFT: { ticker: "MSFT", quantity: 10, price: 357.81, value: 3578.1 },
      NVDA: { ticker: "NVDA", quantity: 4, price: 233.74, value: 934.96 },
      GOOG: { ticker: "GOOG", quantity: 10, price: 334.57, value: 3345.7 },
    },
    summary: { marketValue: 7858.76, costBasis: 6220, gainLoss: 1638.76 },
  };
  portfolio.intelligence = {
    provider: "portfolio-intelligence-mock",
    markdown: "# Mock portfolio intelligence\n\nPositions: MSFT, NVDA, GOOG",
  };
  const scope = { state: settledState, context };
  if (!("wait" in acts[1])) throw new Error("Expected wait act.");
  assert.equal(await evaluateScenarioWait(acts[1], scope), true);
  if (!("wait" in acts[2])) throw new Error("Expected wait act.");
  assert.equal(await evaluateScenarioWait(acts[2], scope), true);
  if (!("observe" in acts[3])) throw new Error("Expected observation act.");
  assert.deepEqual(await collectScenarioObservation(acts[3], scope), {
    googQuote: 334.57,
    googPositionValue: 3345.7,
    portfolioMarketValue: 7858.76,
  });
  if (!("wait" in acts[4])) throw new Error("Expected wait act.");
  assert.equal(await evaluateScenarioWait(acts[4], scope), true);
  if (!("observe" in acts[5])) throw new Error("Expected observation act.");
  const intelligence = await collectScenarioObservation(acts[5], scope);
  assert.match(String(intelligence.report), /GOOG/);
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
    /non-empty acts array/,
  );
});
