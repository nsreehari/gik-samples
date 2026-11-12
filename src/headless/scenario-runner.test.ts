import { test } from "vitest";

import { runAuthoredScenario } from "./scenario-runner";

// The authored-scenario harness settles real orchestrator effects. Only the
// portfolio-tracker blueprint resolves those effects against mock responses;
// the incident-analysis scenarios call live Foundry servers, which must never
// run during CI or local test runs. Pin the harness to the portfolio-tracker
// blueprint (default context "mock-desktop") so it stays fully offline.
test("runs the portfolio-tracker authored scenario against mock responses", async () => {
  const result = await runAuthoredScenario({
    blueprint: "portfolio-tracker-new",
    scenario: process.env.GIK_SCENARIO_ID,
    context: process.env.GIK_SCENARIO_CONTEXT,
  });
  console.log(`SCENARIO_RESULT=${JSON.stringify(result)}`);
}, 300_000);
