import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: { autodocs: true },
  viteFinal: (config) => mergeConfig(config, {
    resolve: {
      // Avoid running docgen over minified local package bundles.
      alias: [
        {
          find: /^gik-components$/,
          replacement: fileURLToPath(new URL("../../packages/components/src/shared/index.ts", import.meta.url)),
        },
        ...["semantic", "security", "software", "primitives", "fluent", "agent-facing"].map((entry) => ({
          find: `gik-components/${entry}`,
          replacement: fileURLToPath(new URL(`../../packages/components/src/${entry === "agent-facing" ? "shared/agent-facing" : entry}`, import.meta.url)),
        })),
      ],
    },
  }),
};

export default config;