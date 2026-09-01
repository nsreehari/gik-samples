import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  materializeBlueprint,
  validateBlueprintArtifact,
  type BlueprintArtifact,
} from "@gik-ai/blueprint";
import { buildCapabilityCatalogFromExternals } from "@gik-ai/react";
import { financeComponentCapabilities } from "../app/src/components/FinbookExplorerContract";
import { finbookPrimitiveComponentCapabilities } from "../app/src/components/PrimitiveComponentContracts";

const blueprintPath = fileURLToPath(new URL("../blueprints/finbook/blueprint.json", import.meta.url));
const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
validateBlueprintArtifact(blueprint);
const artifact = blueprint as BlueprintArtifact;
const capabilityCatalog = buildCapabilityCatalogFromExternals(
  artifact.payload.runtime?.externals,
  (from) => {
    if (from === "primitive") return finbookPrimitiveComponentCapabilities;
    if (from === "finance") return financeComponentCapabilities;
    return undefined;
  },
);
materializeBlueprint({ blueprint: artifact, capabilityCatalog });
process.stdout.write("Finbook Blueprint is valid.\n");
