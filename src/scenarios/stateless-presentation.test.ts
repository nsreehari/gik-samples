import assert from "node:assert/strict";
import { test } from "vitest";
import {
  materializeBlueprint,
  parseBlueprintReference,
  runMaterializedTransition,
} from "@gik-ai/blueprint";
import type { ResolvedNode } from "@gik-ai/kernel";

import {
  getSampleBlueprintCatalog,
  resolveSampleBlueprintSource,
} from "../bootstrap/catalog/blueprint-catalog";
import { resolveStatelessPresentation } from "./stateless-presentation";

function flattenTree(node: ResolvedNode): ResolvedNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

test("resolves a materialized Blueprint Presentation from an explicit state snapshot", async () => {
  const document = getSampleBlueprintCatalog().scenarios["portfolio-tracker-new"];
  const scenario = document.scenarios[0];
  const materialized = materializeBlueprint({
    blueprint: resolveSampleBlueprintSource(document.blueprint),
    externalContext: document.contextPresets[scenario.contextPreset!].context,
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });

  const tree = await resolveStatelessPresentation(
    materialized,
    structuredClone(materialized.payload.initialState),
  );
  const nodes = flattenTree(tree);

  assert.equal(tree.capability, "gik:presentation-fragment");
  assert.ok(nodes.some(({ id }) => id.startsWith("portfolio-holdings--primary--in-")));
  assert.ok(nodes.some(({ id }) => id.startsWith("market-prices--primary--in-")));
  assert.ok(nodes.some(({ id }) => id.startsWith("portfolio-value-cell--primary--in-")));
});

test("incident analysis hides report decorations until a report is available", async () => {
  const materialized = materializeBlueprint({
    blueprint: resolveSampleBlueprintSource("incident-analysis-new-shell"),
    externalContext: { model: "semantic" },
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });

  const tree = await resolveStatelessPresentation(
    materialized,
    structuredClone(materialized.payload.initialState),
  );
  const nodes = flattenTree(tree);
  const reportTimestamp = nodes.find(({ id }) =>
    id.startsWith("report-viewer--primary--in-analysis-report--before-1"));

  assert.ok(reportTimestamp);
  assert.equal(reportTimestamp.visible, false);
});

test("incident analysis requests source report options on its initial transition", async () => {
  const materialized = materializeBlueprint({
    blueprint: resolveSampleBlueprintSource("incident-analysis-new-shell"),
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });

  const result = await runMaterializedTransition({
    materializedBlueprint: materialized,
    state: structuredClone(materialized.payload.initialState),
    events: [],
  });

  assert.equal(result.effects.length, 1);
  assert.equal(result.effects[0]?.kind, "invoke");
  assert.equal(result.effects[0]?.control.tool, "listSourceReports");
});
