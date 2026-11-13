import { pathToFileURL } from "node:url";
export function assertLanes(needs) {
  if (needs.plan.result !== "success") throw new Error("Planning failed or was cancelled");
  for (const selector of ["full", "finbook", "mcp", "reused"]) {
    if (!["true", "false"].includes(needs.plan.outputs[selector])) throw new Error(`Missing or invalid planning selector: ${selector}`);
  }
  for (const [lane, selector] of [["studio", "full"], ["finbook", "finbook"], ["mcp", "mcp"]]) {
    const selected = needs.plan.outputs[selector] === "true" && needs.plan.outputs.reused !== "true";
    if (needs[lane].result !== (selected ? "success" : "skipped")) {
      throw new Error(`${lane}: expected ${selected ? "success" : "skipped"}, got ${needs[lane].result}`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertLanes(JSON.parse(process.env.RESULTS));
}
