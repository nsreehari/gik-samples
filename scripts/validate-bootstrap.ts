import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadBlueprintCatalogBundle } from "../src/bootstrap/load-catalog";
import {
  parseBlueprintCatalogBundle,
  verifyBlueprintCatalogBundle,
} from "../src/bootstrap/catalog/blueprint-catalog";
import catalog from "../src/bootstrap/catalog.json" with { type: "json" };

const bootstrapRoot = resolve(import.meta.dirname, "../src/bootstrap");
const bundle = await loadBlueprintCatalogBundle(
  catalog,
  async (path) => JSON.parse(await readFile(resolve(bootstrapRoot, path), "utf8")),
);
await verifyBlueprintCatalogBundle(parseBlueprintCatalogBundle(bundle));

console.log(
  `Validated ${bundle.blueprints.length} Blueprints and ${bundle.launchProfiles.length} launches.`,
);
