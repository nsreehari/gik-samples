import React from "react";
import { openBlueprint } from "@gik-ai/controlface/blueprint";
import {
  BlueprintHost,
  validateBlueprintArtifact,
  type BlueprintArtifact,
  type BundleNative,
  type ProjectionView,
} from "@gik-ai/react";

import finbookBlueprintJson from "../../blueprints/finbook/blueprint.json";
import { financeComponentViews } from "./components/FinbookExplorer";
import { createFinbookServiceOrchestrator } from "./services/service-host";

validateBlueprintArtifact(finbookBlueprintJson);
const finbookBlueprint: BlueprintArtifact = finbookBlueprintJson;
const runtime = openBlueprint(finbookBlueprint);
const mcpServer = import.meta.env.VITE_FINBOOK_MCP_URL?.trim() || undefined;
const native: BundleNative = {
  wrapOrchestrator: createFinbookServiceOrchestrator(runtime, mcpServer),
};

function resolveLeavesProvider(id: string): Record<string, ProjectionView> | undefined {
  return id === "finance" ? financeComponentViews : undefined;
}

export function FinbookHost(): React.ReactElement {
  return (
    <BlueprintHost
      blueprint={finbookBlueprint}
      native={native}
      resolveLeavesProvider={resolveLeavesProvider}
    />
  );
}
