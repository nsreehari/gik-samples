# GIK Samples

Community-facing components, Blueprint samples, and the browser App Host for the Generative Interaction Kernel.

## Package and documentation map

| Guide | Owns |
| --- | --- |
| [gik-components](packages/components/README.md) | Public projection catalogs, React adapters, explicit providers, and component authoring tools |
| [MCP companion](packages/mcp-server/README.md) | Standalone local tooling, pairing, credentials, provisioning, and MCP transports |
| [Finbook](apps/finbook/README.md) | Reference application setup, composition, and extraction constraints |
| [Validation](VALIDATION.md) | The repository-wide install/build/test sequence and CI-only option |
| [Releasing](RELEASING.md) | Components publication and generated Pages package downloads |
| [Architecture decisions](docs/decisions/README.md) | Sample design rationale and boundaries, not another package API catalog |

Core package APIs live in the
[core package READMEs](https://github.com/nsreehari/generative-interaction-kernel#choose-a-package);
the [DPP](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/dpp.md)
and [Sense](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/senses.md)
guides define their cross-package contracts. This repository supplies example
host wiring; it does not redefine those contracts.

## Reference applications

- [`apps/finbook`](./apps/finbook) is a declarative finance reference
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

Cell expressions read settled results as `fetched_sources.<id>`; source
configuration arrays remain named `sources`. Manifest text does not grant
execution permission or automatically start agents or timers. Dependency
minimums are maintained in the consumer package manifests, not a second version
table here.

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
the released `gik-components` version. `/vendor/` is a download directory, not
an npm registry. [Releasing](RELEASING.md#pages-package-downloads) owns archive
verification, manifest contents, and post-publication refresh behavior.

## Development

```sh
npm install --no-audit --no-fund
npm install --prefix apps/finbook --no-audit --no-fund
npm run dev
```

For local tooling and `/provisioning/` pairing, follow the
[MCP companion guide](packages/mcp-server/README.md). It owns the standalone
install, exact-origin configuration, short-lived pairing tokens, Copilot CLI
setup, and optional Foundry prerequisites. Credentials never belong in the
portable plan or browser request.

Use Node.js 24. Build `gik-components` before standalone Finbook consumers so
the local directory dependency has its generated entry points available.

## Validation

The PR CI workflow runs the [validation sequence](VALIDATION.md) against public npm on GitHub-hosted
runners, plus standalone Finbook/MCP tests and a built-browser smoke test.
This supports CI-only validation when local registry mirrors have not yet
received a published GIK version; it does not change local registry settings.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements,
[SUPPORT.md](SUPPORT.md) for support boundaries, and [SECURITY.md](SECURITY.md)
for private vulnerability reporting.
