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
Storybook is published at `/storybook/`. Core `@gik-ai/*` dependencies resolve
from the public npm registry; only the unpublished `@gik-ai/agent-lifecycle-exp`
and `@gik-ai/blueprint-agent-host` packages still resolve from
integrity-checked archives under `vendor/gik-packages`.

Blueprint service declarations own their concrete non-secret configuration,
including service endpoints and logical `credentialRef` values. The browser
host authorizes endpoints declared by repository-seeded Blueprints and resolves
the referenced secret from browser credential storage when the service is used.
Never place literal keys, tokens, or passwords in a Blueprint or Vite variable.

## Live site

- [Root sample app](https://nsreehari.github.io/gik-samples/)
- [Storybook](https://nsreehari.github.io/gik-samples/storybook/)
- [Scenario Explorer](https://nsreehari.github.io/gik-samples/scenarios/)

## Development

```sh
npm ci --no-audit --no-fund
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
and `@azure/identity` peers. Provider targets, models, and logical workspace
references flow from Blueprint service config into the portable and
server-reviewed plans; Azure tokens never reach the browser. See
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

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements,
[SUPPORT.md](SUPPORT.md) for support boundaries, and [SECURITY.md](SECURITY.md)
for private vulnerability reporting.
