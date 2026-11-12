# Finbook

Finbook is a cloneable full-stack GIK reference application. Its first
milestone intentionally presents a small read-only report explorer while owning
the complete application boundary: Blueprint, component catalog, host, finance
domain, MCP server, SQLite adapter, seed data, tests, and build entry points.

## Architecture

```text
apps/finbook/
├── reference-app-host/
│   ├── browser-host/    minimal React/Vite composition root
│   ├── service-host/    ServiceHost, MCP service kind, and MCP client
│   ├── provider-registry.ts
│   ├── policies.ts      endpoint and credential policy interfaces
│   └── headless-harness.ts
├── gik-components/     application-owned declarative components
├── blueprints/         application composition, state, events, and MCP sources
├── mcp-server/         Finbook domain, SQLite persistence, and MCP/HTTP host
├── scripts/            validation and local development entry points
└── test/               component and reference-host tests
```

The React entry renders one `BlueprintHost` and supplies both the standard
primitive catalog and the app-owned finance catalog. The Blueprint has two
semantic Cells:

- `finbook-selector` loads account options, presents a `primitive:form`, and
  publishes the selected account, financial year, and report through ports;
- `finbook-explorer` consumes those ports, runs one Finbook computed-view
  query, and presents the result through `finance:finbook-explorer`.

`finance:finbook-explorer` is a self-describing declarative component with a
closed props schema, validator, authoring guidance, trial materializer,
capability descriptor, and projection view. Its implementation composes the
governed `fluent:table` component instead of recreating table controls.

The browser host includes a narrow application-owned MCP service adapter and has no dependency on
Blueprint Studio. The provider registry, policies, service composition, and optional headless
harness are kept together under `reference-app-host` so another reference application can copy and
replace the Finbook-specific Blueprint, components, and server without importing Studio code.

## Run locally

Use Node.js 24. From the repository root, install the app workspace and build
the local component package before running the browser host:

```powershell
npm install --no-audit --no-fund
npm run build --workspace gik-components
cd apps\finbook
npm install --no-audit --no-fund
```

The required GIK packages resolve from normal dependencies, with
`gik-components` linked from the local repository source package. The
compatible XYFlow pair remains vendored under `vendor/npm-packages` because
the proxy currently serves an incompatible React/System package combination.
Other dependencies remain normal npm ranges.

The [browser-host README](reference-app-host/browser-host/README.md) owns the
React composition entry point; the [server README](mcp-server/README.md) owns
the standalone server entry points and persistence boundary.

Start the SQLite-backed MCP server and browser host together:

```powershell
npm run dev
```

Open `http://127.0.0.1:5176/finbook/`. The MCP endpoint is
`http://127.0.0.1:7811/mcp`.

Useful checks:

```powershell
npm run check
```

The Blueprint owns the concrete MCP endpoint. For deployment, author a
deployment-specific Finbook Blueprint revision containing the hosted HTTPS
endpoint; the browser host may authorize or reject that endpoint but does not
rewrite it from environment variables.

This sample uses bounded MCP sources, not a DPP manifest or continuous Sense.
It consumes DPP/Sense-capable packages without requiring every Cell to become
a participant or observer.

## Extract

The app does not import the Studio or sample catalog at runtime. It can be
split while preserving history:

```powershell
git subtree split --prefix=apps/finbook -b finbook-main
```

The extracted directory is the app workspace root, but it is **not yet
installable unchanged**: the root and browser-host manifests still point to
the surrounding repository's `packages/components` directory. Before extracting,
plan a separate dependency change to the published `gik-components` package or
preserve a compatible local component directory and update both paths.
Do not silently replace those `file:` dependencies in this repository.
Retain the app's separate XYFlow archives. After resolving the component
dependency, use the app's `dev` and `check` scripts.

## Host in Azure or Firebase

The Node request handler and Finbook MCP contract are independent of local
process startup. A hosted HTTP/function adapter can call the same tool handler.

Do not use a function instance's SQLite file as shared production storage.
Replace the local adapter with a managed relational implementation:

- Azure Database for PostgreSQL or Azure SQL on Azure;
- Cloud SQL for PostgreSQL or Firebase Data Connect on Google Cloud.

Keep stable finance fields relational and retain genuinely extensible values as
JSON/JSONB. The required persistence semantics are documented in the
[storage contract](mcp-server/storage-contract.md); hosted adapters must preserve
the existing MCP tool names and envelopes so the Blueprint remains unchanged.
