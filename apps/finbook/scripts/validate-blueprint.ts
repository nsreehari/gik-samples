import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateBlueprintArtifact } from "@gik-ai/blueprint";

const blueprintPath = fileURLToPath(new URL("../blueprints/finbook/blueprint.json", import.meta.url));
const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
validateBlueprintArtifact(blueprint);
process.stdout.write("Finbook Blueprint is valid.\n");
