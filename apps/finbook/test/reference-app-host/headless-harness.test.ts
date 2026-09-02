import assert from "node:assert/strict";
import { test } from "vitest";
import type { BlueprintArtifact } from "gik-react";

import blueprintJson from "../../blueprints/finbook/blueprint.json";
import { openReferenceAppHeadless } from "../../reference-app-host/headless-harness";

test("copyable reference-app host opens the Finbook Blueprint headlessly", () => {
  const session = openReferenceAppHeadless(blueprintJson as BlueprintArtifact);

  assert.equal(session.runtime.blueprintId, "finbook");
  assert.ok("finbook" in session.snapshot());
});
