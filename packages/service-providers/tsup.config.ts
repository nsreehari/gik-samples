import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    scheduler: "src/scheduler.ts",
    gmail: "src/gmail.ts",
    "github-context-store": "src/github-context-store.ts",
    foundry: "src/foundry.ts",
  },
  format: ["esm"], dts: true, sourcemap: true, clean: true,
  splitting: false, tsconfig: "tsconfig.json",
  external: ["croner", "gik-controlface", "gik-kernel", "gik-agent-lifecycle-exp"],
});
