import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import sirv from "sirv";
import { defineConfig, type Plugin } from "vite";

const hostDirectory = fileURLToPath(new URL(".", import.meta.url));
const storybookDirectory = fileURLToPath(new URL("../../storybook-static/", import.meta.url));
const bootstrapDirectory = fileURLToPath(new URL("../bootstrap/", import.meta.url));

function hostedAssets(): Plugin {
  return {
    name: "gik-hosted-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== "/storybook") {
          next();
          return;
        }

        response.statusCode = 308;
        response.setHeader("Location", `/storybook/${url.search}`);
        response.end();
      });
      server.middlewares.use(
        "/storybook",
        sirv(storybookDirectory, { dev: true, etag: true }),
      );
      server.middlewares.use(
        "/bootstrap",
        sirv(bootstrapDirectory, { dev: true, etag: true }),
      );
    },
    writeBundle() {
      if (!existsSync(storybookDirectory)) {
        throw new Error("Storybook output is missing. Run npm run build:storybook first.");
      }

      const distDirectory = `${hostDirectory}dist`;
      cpSync(storybookDirectory, `${distDirectory}/storybook`, { recursive: true });
      mkdirSync(`${distDirectory}/bootstrap`, { recursive: true });
      cpSync(
        `${bootstrapDirectory}catalog.json`,
        `${distDirectory}/bootstrap/catalog.json`,
      );
      cpSync(
        `${bootstrapDirectory}blueprints`,
        `${distDirectory}/bootstrap/blueprints`,
        { recursive: true },
      );
      mkdirSync(`${distDirectory}/in-memory`, { recursive: true });
      cpSync(`${distDirectory}/index.html`, `${distDirectory}/in-memory/index.html`);
      mkdirSync(`${distDirectory}/tests`, { recursive: true });
      cpSync(`${distDirectory}/index.html`, `${distDirectory}/tests/index.html`);
      mkdirSync(`${distDirectory}/scenarios`, { recursive: true });
      cpSync(`${distDirectory}/index.html`, `${distDirectory}/scenarios/index.html`);
      mkdirSync(`${distDirectory}/provisioning`, { recursive: true });
      cpSync(`${distDirectory}/index.html`, `${distDirectory}/provisioning/index.html`);
      mkdirSync(`${distDirectory}/in-memory/provisioning`, { recursive: true });
      writeFileSync(
        `${distDirectory}/in-memory/provisioning/index.html`,
        `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../../provisioning/"><script>location.replace("../../provisioning/"+location.search+location.hash)</script>`,
      );
    },
  };
}

// The ONE generic host: a consumer of the public packages plus the sample Blueprints it mounts.
export default defineConfig({
  // For GitHub Pages the site is served under /<repo>/, so built asset URLs must be prefixed.
  // The Pages workflow sets a versioned /gik/v*/ base; local dev/build defaults to "/".
  base: process.env.VITE_BASE || "/",
  publicDir: false,
  plugins: [react(), hostedAssets()],
  server: { port: 5175 },
});
