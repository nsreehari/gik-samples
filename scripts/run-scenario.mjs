import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const scenarioEnvironment = {
  GIK_SCENARIO_BLUEPRINT: option("blueprint"),
  GIK_SCENARIO_ID: option("scenario"),
  GIK_SCENARIO_CONTEXT: option("context"),
};
const result = spawnSync(process.execPath, [
  join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
  "run",
  "--disableConsoleIntercept",
  "--config",
  "vitest.scenario.config.ts",
  "src/headless/scenario-runner.test.ts",
], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    ...Object.fromEntries(Object.entries(scenarioEnvironment).filter(([, value]) => value !== undefined)),
  },
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;
