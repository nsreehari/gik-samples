# GIK Samples

Community-facing components, Blueprint samples, and the browser App Host for the Generative Interaction Kernel.

[Explore Studio](https://nsreehari.github.io/gik-samples/) |
[Documentation hub](https://nsreehari.github.io/gik-samples/docs/) |
[Build a sample app](https://nsreehari.github.io/gik-samples/getting-started/) |
[Component workbench](https://nsreehari.github.io/gik-samples/storybook/)

## Package and documentation map

| Guide | Owns |
| --- | --- |
| [Documentation](docs/README.md) | Learning paths, documentation ownership, and navigation |
| [Samples](docs/samples.md) | Example selection, prerequisites, host boundaries, and continuous-awareness demo |
| [gik-components](packages/components/README.md) | Public projection catalogs, React adapters, explicit providers, and component authoring tools |
| [gik-service-providers](packages/service-providers/README.md) | Individually imported cron/Gmail providers with host-owned setup and execution authority |
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

For browser-only examples, purpose-bearing portfolio Cells, incident analysis,
the headless Sense demo, and provisioning prerequisites, use the
[sample guide](docs/samples.md). It distinguishes runnable browser previews
from local servers and external-service integrations.

## Application boundary

Blueprints own application composition and cross-component behavior:
sequencing, navigation, review workflows, and coordinating write actions.
Components are projection leaves: they render authored data declaratively and
emit declared events, but do not perform writes or own workflow state.
Imperative code provides infrastructure and domain mechanics that Blueprints
and components consume through well-defined props and events.

## Live site

- [Documentation hub](https://nsreehari.github.io/gik-samples/docs/) - concepts, samples, packages, and hosting
- [Build a sample app](https://nsreehari.github.io/gik-samples/getting-started/) - walkthrough and reference source
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

Use Node.js 24. Studio builds its local `gik-components` workspace package.
Standalone Finbook resolves the published package and needs no sibling build.

## Validation

The PR CI workflow runs the [validation sequence](VALIDATION.md) against public npm on GitHub-hosted
runners, plus standalone Finbook/MCP tests and a built-browser smoke test.
This supports CI-only validation when local registry mirrors have not yet
received a published GIK version; it does not change local registry settings.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements,
[SUPPORT.md](SUPPORT.md) for support boundaries, and [SECURITY.md](SECURITY.md)
for private vulnerability reporting.
