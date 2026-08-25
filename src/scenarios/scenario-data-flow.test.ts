import assert from "node:assert/strict";
import { test } from "vitest";
import { materializeBlueprint, parseBlueprintReference } from "@gik/blueprint";

import {
  getSampleBlueprintCatalog,
  resolveSampleBlueprintSource,
} from "../bootstrap/catalog/blueprint-catalog";
import { createScenarioDataFlowModel } from "./scenario-data-flow";

test("data flow maps terminal Blueprint Cells to canvas nodes and shared-token ports", () => {
  const document = getSampleBlueprintCatalog().scenarios["portfolio-tracker-new"];
  const scenario = document.scenarios[0];
  const blueprint = resolveSampleBlueprintSource(document.blueprint);
  const materialized = materializeBlueprint({
    blueprint,
    externalContext: document.contextPresets[scenario.contextPreset!].context,
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });
  const model = createScenarioDataFlowModel(
    materialized,
    materialized.payload.initialState,
    "portfolio-holdings--primary--in-holdings",
  );

  assert.deepEqual(
    model.nodes.map(({ id }) => id),
    Object.keys(materialized.payload.terminalBlueprint.payload.cells ?? {}),
  );
  assert.equal(
    model.nodes.find(({ id }) => id === "portfolio-holdings")?.tone,
    "accent",
  );
  assert.equal(
    model.nodePorts["portfolio-holdings"].right?.[0].token,
    "holdings",
  );
  assert.equal(
    model.nodePorts["market-prices"].left?.[0].token,
    "holdings",
  );
});
