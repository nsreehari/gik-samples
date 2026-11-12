# GIK Samples

Community-facing components, Blueprint samples, and the browser App Host for the Generative Interaction Kernel.

## Reference applications

- [`apps/finbook`](./apps/finbook) is a carve-out-ready declarative finance
  application with its own Blueprint, web host, MCP server, domain logic,
  SQLite persistence, seeds, and tests.

The app publishes `/provisioning/` and `/in-memory/provisioning/`. These routes
use the same repository/user Blueprint catalog as the Studio and store
user-owned provisioning profiles in IndexedDB or memory respectively. They
export portable `gik-project/1` plans containing the selected Blueprint and
derived agent declarations. Plans can always be downloaded and applied with
the copied scripts, or reviewed and applied through the loopback companion.

The curated repository Blueprints remain immutable seeds. The browser
experience is published at `/`, selected Blueprints use `?b=<id>`, and
Storybook is published at `/storybook/`. The repository consumers resolve
`gik-components` from the local workspace source directory using `file:`
dependencies, never a tarball. All external `gik-*` dependencies, including
`gik-agent-lifecycle-exp` and `gik-blueprint-agent-host`, resolve from published
npm packages.

The portfolio intelligence Cell declares `dpp.manifest` and context query/ingest
sources. Its host stores scoped observations in the Blueprint instance's durable
storage and supplies selected history alongside the current valuation to the
intelligence provider. See the [portfolio test cases](src/bootstrap/blueprints/portfolio-tracker-new/TEST_CASES.md)
for correlation, retry, and lifecycle guarantees.

The dependency minimums include both Cell Senses and DPP support: Blueprint and
Controlface 0.5.0, Evaluators 0.4.0, Kernel 0.4.1, and React 0.4.2.
These minimums also apply to the standalone Finbook app and its browser host.

Blueprint service declarations own their concrete non-secret configuration,
including service endpoints and logical `credentialRef` values. The browser
host authorizes endpoints declared by repository-seeded Blueprints and resolves
the referenced secret from browser credential storage when the service is used.
Never place literal keys, tokens, or passwords in a Blueprint or Vite variable.

## Continuous awareness example

The [Senses clock Blueprint](src/bootstrap/blueprints/senses-clock/blueprint.json)
declares a timer Sense and a bounded report source in the same Cell. The
[headless host](src/headless/senses-clock-host.ts) registers existing service
kinds, reconciles committed bindings, journals each Signal, and executes the
resulting source effects.

```sh
npm exec -- tsx src/headless/senses-clock-demo.ts
npm test -- src/headless/senses-clock-host.test.ts
```

The bounded demo prints counter and report snapshots, then closes its worker and
timer. It uses the published memory storage provider; callers can supply another
compatible durable provider and references. The integration test reuses that
storage across host restart and verifies repeated deliveries, source settlement,
disable, re-enable, recovery, and cleanup. The timer uses fixed-delay intervals,
skips missed occurrences, and begins a fresh interval after reconnect.

## Application boundary

Blueprints own application composition and cross-component behavior:
sequencing, navigation, review workflows, and coordinating write actions.
Components are projection leaves: they render authored data declaratively and
emit declared events, but do not perform writes or own workflow state.
Imperative code provides infrastructure and domain mechanics that Blueprints
and components consume through well-defined props and events.

## Live site

- [Root sample app](https://nsreehari.github.io/gik-samples/)
- [Storybook](https://nsreehari.github.io/gik-samples/storybook/)
- [Scenario Explorer](https://nsreehari.github.io/gik-samples/scenarios/)
- [Released GIK package downloads](https://nsreehari.github.io/gik-samples/vendor/)

Pages includes versioned npm tarballs for the ten stable core GIK packages and
the released `gik-components` version. The download index links a manifest with
original npm URLs, npm integrity digests, and SHA-256 checksums. These archives
are generated and verified in CI, never committed to Git. `/vendor/` is a
download directory, not an npm registry; dependency resolution is unchanged.

## Development

```sh
npm install --no-audit --no-fund
npm install --prefix apps/finbook --no-audit --no-fund
npm run dev
```

The MCP server is a standalone package. In another terminal, install that
package, copy `.env.template` to `.env`, configure
`GIK_WORKSPACE_ROOTS` and `GIK_ALLOWED_ORIGINS`, then start it:

```sh
cd packages/mcp-server
npm install
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

Use Node.js 24. Build `gik-components` before standalone Finbook consumers so
the local directory dependency has its generated entry points available.

## Validation

```sh
npm run build
npm run typecheck
npm test
```

The PR CI workflow runs these checks against public npm on GitHub-hosted
runners, plus standalone Finbook/MCP tests and a built-browser smoke test.
This supports CI-only validation when local registry mirrors have not yet
received a published GIK version; it does not change local registry settings.

See [VALIDATION.md](VALIDATION.md) for the full deterministic local validation
sequence, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements,
[SUPPORT.md](SUPPORT.md) for support boundaries, and [SECURITY.md](SECURITY.md)
for private vulnerability reporting.
