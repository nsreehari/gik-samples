import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20_000,
    setupFiles: ["src/bootstrap/catalog/test-setup.ts"],
    server: {
      deps: {
        inline: ["tabster"],
      },
    },
    include: [
      "packages/components/test/**/*.test.ts",
      "packages/components/test/**/*.test.tsx",
      "src/browser-host/**/*.test.ts",
      "src/browser-host/**/*.test.tsx",
      "src/headless/**/*.test.ts",
      "src/scenarios/**/*.test.ts",
      "src/service-kinds/**/*.test.ts",
      "src/testing/**/*.test.ts",
    ],
    exclude: [
      "tests/agent-provisioning-guidance.test.ts",
      "tests/demo-runner-v1.test.ts",
      "tests/node-hosted-blueprint-composition.test.ts",
      "tests/portfolio-tracker-new-node-host.test.ts",
    ],
  },
});
