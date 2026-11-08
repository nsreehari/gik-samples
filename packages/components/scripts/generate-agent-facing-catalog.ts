import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import React from "react";

globalThis.React = React;

const { agentFacingComponentCatalog } = await import("../src/shared/registry");
const outputPath = fileURLToPath(
  new URL("../src/generated/agent-facing-capability-catalog.ts", import.meta.url),
);
const source = [
  'import type { AgentFacingCapabilityCatalog } from "../shared/agent-facing";',
  "",
  `export const agentFacingComponentCatalog: AgentFacingCapabilityCatalog = ${JSON.stringify(agentFacingComponentCatalog, null, 2)};`,
  "",
].join("\n");

await writeFile(outputPath, source, "utf8");
