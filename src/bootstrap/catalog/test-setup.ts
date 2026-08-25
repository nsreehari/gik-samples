import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import catalog from "../catalog.json" with { type: "json" };
import { loadBlueprintCatalogBundle } from "../load-catalog";
import {
  createBlueprintCatalogSnapshot,
  installSampleBlueprintCatalog,
  parseBlueprintCatalogBundle,
  verifyBlueprintCatalogBundle,
} from "./blueprint-catalog";

const bootstrapRoot = resolve(import.meta.dirname, "..");
const bundle = await loadBlueprintCatalogBundle(
  catalog,
  async (path) => JSON.parse(await readFile(resolve(bootstrapRoot, path), "utf8")),
);
const parsedBundle = parseBlueprintCatalogBundle(bundle);
await verifyBlueprintCatalogBundle(parsedBundle);

installSampleBlueprintCatalog(createBlueprintCatalogSnapshot(parsedBundle));
