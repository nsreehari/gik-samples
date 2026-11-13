import { defineConfig } from "tsup";

export default defineConfig({
  entry: { scheduler: "src/scheduler.ts", gmail: "src/gmail.ts" },
  format: ["esm"], dts: true, sourcemap: true, clean: true,
  splitting: false, tsconfig: "tsconfig.json",
  external: ["croner", "gik-controlface", "gik-kernel"],
});
