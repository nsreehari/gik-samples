import assert from "node:assert/strict";
import { parseBlueprintReference } from "@gik-ai/blueprint";
import { test } from "vitest";

import { getSampleBlueprintCatalog } from "../bootstrap/catalog/blueprint-catalog";
import { runBlueprintTestDocument } from "./declarative-blueprint-tests";

test("all catalog Blueprints pass their declarative tests", () => {
  const catalog = getSampleBlueprintCatalog();
  assert.deepEqual(Object.keys(catalog.tests).sort(), [...catalog.blueprints].sort());
  const results = Object.values(catalog.tests).flatMap((document) =>
    runBlueprintTestDocument(document, {
      blueprint: catalog.entries[document.blueprint],
      resolveBlueprint: (reference) => catalog.entries[parseBlueprintReference(reference).id],
    }));
  assert.deepEqual(
    results.filter(({ passed }) => !passed),
    [],
  );
});
