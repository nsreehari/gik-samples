import { test } from "vitest";

import { runAuthoredScenario } from "./scenario-runner";

test("runs the requested authored scenario", async () => {
  const result = await runAuthoredScenario({
    blueprint: process.env.GIK_SCENARIO_BLUEPRINT,
    scenario: process.env.GIK_SCENARIO_ID,
    context: process.env.GIK_SCENARIO_CONTEXT,
  });
  console.log(`SCENARIO_RESULT=${JSON.stringify(result)}`);
}, 300_000);
