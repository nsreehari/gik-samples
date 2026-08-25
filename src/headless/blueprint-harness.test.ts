import assert from "node:assert/strict";
import { test } from "vitest";

import { getSampleBlueprintCatalog } from "../bootstrap/catalog/blueprint-catalog";
import { openHeadlessBlueprint } from "./blueprint-harness";

test("headless harness opens every catalog Blueprint with authored defaults", () => {
  for (const id of getSampleBlueprintCatalog().blueprints) {
    const session = openHeadlessBlueprint(id);
    assert.equal(session.runtime.blueprintId, id);
    assert.deepEqual(session.snapshot(), session.runtime.state);
  }
});

test("headless harness selects the Incident Analysis semantic model by default", () => {
  const session = openHeadlessBlueprint("incident-analysis-new-shell");
  assert.equal(session.runtime.definition.payload.kind, "incident-analysis-shell");
  assert.ok("incident" in session.snapshot());
});
