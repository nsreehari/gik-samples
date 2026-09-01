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

From the copied `apps/finbook` directory, install both workspace packages once:

```powershell
cd apps\finbook
npm install
```

The required GIK packages are vendored under `vendor/gik-packages` because the
corporate package-feed proxy does not expose them. Other dependencies remain
normal unpinned npm ranges, and `npm install` generates the application lockfile.
The compatible XYFlow pair is also vendored because the proxy currently serves
an incompatible React/System package combination.

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

`FINBOOK_DB_PATH`, `FINBOOK_HOST`, `FINBOOK_PORT`, and
`FINBOOK_ALLOWED_ORIGINS` configure the local server. Runtime SQLite files are
created from the checked-in JSON/JSONL seeds and are ignored by Git.

The Blueprint owns the concrete MCP endpoint. For deployment, author a
deployment-specific Finbook Blueprint revision containing the hosted HTTPS
endpoint; the browser host may authorize or reject that endpoint but does not
rewrite it from environment variables.

## Extract

The directory has no runtime dependency on the sample catalog, hosted
Blueprint Studio, or another source repository. It can be split while
preserving history:

```powershell
git subtree split --prefix=apps/finbook -b finbook-main
```

The extracted directory is already the package root. Run `npm install`, `npm run dev`, and
`npm run check` without copying files or depending on the surrounding `gik-samples` source tree.

## Host in Azure or Firebase

The Node request handler and Finbook MCP contract are independent of local
process startup. A hosted HTTP/function adapter can call the same tool handler.

Do not use a function instance's SQLite file as shared production storage.
Replace the local adapter with a managed relational implementation:

- Azure Database for PostgreSQL or Azure SQL on Azure;
- Cloud SQL for PostgreSQL or Firebase Data Connect on Google Cloud.

Keep stable finance fields relational and retain genuinely extensible values as
JSON/JSONB. The required persistence semantics are documented in
`mcp-server/storage-contract.md`; hosted adapters must preserve the existing MCP
tool names and envelopes so the Blueprint remains unchanged.
