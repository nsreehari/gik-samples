import React from "react";
import { openBlueprint } from "@gik-ai/controlface/blueprint";
import {
  BlueprintHost,
  validateBlueprintArtifact,
  type BlueprintArtifact,
  type BundleNative,
  type ProjectionView,
} from "@gik-ai/react";
import type { CapabilityDescriptor } from "@gik-ai/kernel";
import {
  primitiveComponentCapabilities,
  primitiveComponentViews,
} from "@gik-ai/components/primitives";

import finbookBlueprintJson from "../../blueprints/finbook/blueprint.json";
import { financeComponentViews } from "./components/FinbookExplorer";
import { financeComponentCapabilities } from "./components/FinbookExplorerContract";
import { createFinbookServiceOrchestrator } from "./services/service-host";

validateBlueprintArtifact(finbookBlueprintJson);
const finbookBlueprint: BlueprintArtifact = finbookBlueprintJson;
const runtime = openBlueprint(finbookBlueprint);
const native: BundleNative = {
  wrapOrchestrator: createFinbookServiceOrchestrator(runtime),
};

function resolveLeavesProvider(id: string): Record<string, ProjectionView> | undefined {
  if (id === "finance") return financeComponentViews;
  if (id === "primitive") return primitiveComponentViews;
  return undefined;
}

function resolveCapabilityDescriptors(id: string): Record<string, CapabilityDescriptor> | undefined {
  if (id === "finance") return financeComponentCapabilities;
  if (id === "primitive") return primitiveComponentCapabilities;
  return undefined;
}

export function FinbookHost(): React.ReactElement {
  return (
    <BlueprintHost
      blueprint={finbookBlueprint}
      native={native}
      resolveLeavesProvider={resolveLeavesProvider}
      resolveCapabilityDescriptors={resolveCapabilityDescriptors}
    />
  );
}
