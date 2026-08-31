# Finbook

Finbook is a complete GIK reference application that can be copied out of this
repository. It owns its Blueprint, projection leaf, finance domain, MCP server,
SQLite adapter, seed data, tests, and build entry points.

## Architecture

```text
apps/finbook/
├── app/          minimal React host and finance projection
├── blueprints/   application composition, state, events, and MCP sources
├── scripts/      Blueprint validation
└── server/       Finbook domain, SQLite persistence, and MCP/HTTP host
```

The React entry renders one `BlueprintHost`. The Blueprint owns account and
financial-year selection, refresh behavior, service declarations, loading
state, and projection composition. `finance:finbook-explorer` is a
presentation-only leaf: it renders resolved props and emits declared UI events.

The browser host includes a narrow MCP service adapter because the current
general-purpose sample service host also owns Studio catalog, credential,
storage, and agent concerns. This adapter is app-local and has no dependency on
Blueprint Studio.

## Run locally

Install the web and server dependencies through the registries approved for
your environment:

```powershell
npm install --prefix apps\finbook\app
npm ci --prefix apps\finbook\server
```

Start the SQLite-backed MCP server and web application in separate terminals:

```powershell
npm run finbook:server
npm run finbook:dev
```

Open `http://127.0.0.1:5176/finbook/`. The MCP endpoint is
`http://127.0.0.1:7811/mcp`.

Useful checks:

```powershell
npm run finbook:build
npm run check --prefix apps\finbook\server
```

`FINBOOK_DB_PATH`, `FINBOOK_HOST`, `FINBOOK_PORT`, and
`FINBOOK_ALLOWED_ORIGINS` configure the local server. Runtime SQLite files are
created from the checked-in JSON/JSONL seeds and are ignored by Git.
Set `VITE_FINBOOK_MCP_URL` when building the web app for a deployed MCP
endpoint; the local Blueprint endpoint remains the development default.

## Extract

The directory has no runtime dependency on the sample catalog, hosted
Blueprint Studio, or another source repository. It can be split while
preserving history:

```powershell
git subtree split --prefix=apps/finbook -b finbook-main
```

After extraction, promote the app and server package scripts into the new
repository root or keep the two-package layout.

## Host in Azure or Firebase

The Node request handler and Finbook MCP contract are independent of local
process startup. A hosted HTTP/function adapter can call the same tool handler.

Do not use a function instance's SQLite file as shared production storage.
Replace the local adapter with a managed relational implementation:

- Azure Database for PostgreSQL or Azure SQL on Azure;
- Cloud SQL for PostgreSQL or Firebase Data Connect on Google Cloud.

Keep stable finance fields relational and retain genuinely extensible values as
JSON/JSONB. The required persistence semantics are documented in
`server/storage-contract.md`; hosted adapters must preserve the existing MCP
tool names and envelopes so the Blueprint remains unchanged.
