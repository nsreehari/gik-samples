import assert from "node:assert/strict";
import { test } from "vitest";
import type { CapabilityDescriptor } from "gik-kernel";
import type { ProjectionView } from "gik-react";

import { createProjectionProviderRegistry } from "../../reference-app-host/provider-registry";

test("provider registry resolves paired view and capability catalogs", () => {
  const views = {} as Record<string, ProjectionView>;
  const capabilities = {} as Record<string, CapabilityDescriptor>;
  const registry = createProjectionProviderRegistry([
    { id: "finance", views, capabilities },
  ]);

  assert.equal(registry.resolveViews("finance"), views);
  assert.equal(registry.resolveCapabilities("finance"), capabilities);
  assert.equal(registry.resolveViews("unknown"), undefined);
  assert.equal(registry.resolveCapabilities("unknown"), undefined);
});
