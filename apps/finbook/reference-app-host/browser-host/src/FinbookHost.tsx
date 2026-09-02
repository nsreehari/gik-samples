import React from "react";
import { openBlueprint } from "@gik-ai/controlface/blueprint";
import {
  BlueprintHost,
  validateBlueprintArtifact,
  type BlueprintArtifact,
  type BundleNative,
} from "@gik-ai/react";
import {
  primitiveComponentCapabilities,
  primitiveComponentViews,
} from "@gik-ai/components/primitives";

import finbookBlueprintJson from "../../../blueprints/finbook/blueprint.json";
import {
  financeComponentCapabilities,
  financeComponentViews,
} from "../../../gik-components/FinbookExplorer";
import { createProjectionProviderRegistry } from "../../provider-registry";
import { createReferenceServiceOrchestrator } from "../../service-host/service-host";

validateBlueprintArtifact(finbookBlueprintJson);
const finbookBlueprint: BlueprintArtifact = finbookBlueprintJson;
const runtime = openBlueprint(finbookBlueprint);
const native: BundleNative = {
  wrapOrchestrator: createReferenceServiceOrchestrator(runtime),
};

const providers = createProjectionProviderRegistry([
  {
    id: "primitive",
    views: primitiveComponentViews,
    capabilities: primitiveComponentCapabilities,
  },
  {
    id: "finance",
    views: financeComponentViews,
    capabilities: financeComponentCapabilities,
  },
]);

export function FinbookHost(): React.ReactElement {
  return (
    <BlueprintHost
      blueprint={finbookBlueprint}
      native={native}
      resolveLeavesProvider={providers.resolveViews}
      resolveCapabilityDescriptors={providers.resolveCapabilities}
    />
  );
}
