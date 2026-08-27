# GIK Samples

Community-facing components, Blueprint samples, and the browser App Host for the Generative Interaction Kernel.

The app publishes `/provisioning/` and `/in-memory/provisioning/`. These routes
use the same repository/user Blueprint catalog as the Studio and store
user-owned provisioning profiles in IndexedDB or memory respectively. They
export portable `gik-project/1` plans containing the selected Blueprint and
derived agent declarations. Plans can always be downloaded and applied with
the copied scripts, or reviewed and applied through the loopback companion.

The curated repository Blueprints remain immutable seeds. The browser
experience is published at `/`, selected Blueprints use `?b=<id>`, and
Storybook is published at `/storybook/`. Core `@gik/*` dependencies temporarily
resolve from integrity-checked archives under `vendor/gik-packages`.

Production builds use reserved example proxy origins by default. Set
`VITE_GIK_FOUNDRY_PROXY_ORIGIN` and `VITE_GIK_HTTP_PROXY_ORIGIN` to the public
deployment endpoints when building a hosted release.

## Development

```sh
npm install
npm run dev
```

The MCP server is a standalone package with its own lockfile. In another
terminal, install that package, copy `.env.template` to `.env`, configure
`GIK_WORKSPACE_ROOTS` and `GIK_ALLOWED_ORIGINS`, then start it:

```sh
cd packages/mcp-server
npm ci
node src/index.js --transport streamable-http
```

Open `/provisioning/`, enter the pairing code printed by the companion,
generate a plan, preview server-side changes, then apply and verify. The bearer
token is short-lived and kept only in page memory. Hosted Studio origins must be
passed exactly as additional `--origin` values. The server never binds beyond
`127.0.0.1`.

Copilot provisioning and runs use the complete local Copilot CLI subsystem.
Foundry provisioning requires `az login`, the optional `@azure/ai-projects`
and `@azure/identity` peers, and an explicit
`AZURE_AI_FOUNDRY_PROJECT_ENDPOINT`; Azure tokens never reach the browser. See
[`packages/mcp-server/README.md`](packages/mcp-server/README.md) for MCP stdio,
HTTP bearer, and download-fallback details.

The committed vendored packages are validated during every production build. Run
`npm run validate:vendor` directly to verify their provenance, checksums, and
contents without building the application.

## Validation

```sh
npm run build
npm run typecheck
npm test
```
