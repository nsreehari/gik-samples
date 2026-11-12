# Finbook server

Private Node workspace owning the Finbook domain, local SQLite adapter,
seed data, tool handler, and MCP/HTTP process. It is separate from the
[Studio MCP companion](../../../packages/mcp-server/README.md).

Use the [Finbook setup guide](../README.md) to install and start the complete
app. From the app workspace root, these commands operate only on the server:

```sh
npm run dev:server
npm run check --workspace gik-finbook-server
```

The check regenerates domain MCP manifests, runs domain tests and seed
validation, and executes the server's Node tests.

## HTTP and configuration

[`createFinbookHttpServer`](src/index.js) creates the Node HTTP server without
starting a listener when imported. The process entry point starts it on the
configured host and port.

- `POST /mcp`: initialization, session-bound tool listing/calls, and initialized
  notification handling.
- `GET /health`: process health.
- `FINBOOK_HOST`: listener address, default `127.0.0.1`.
- `FINBOOK_PORT`: listener port, default `7811`.
- `FINBOOK_DB_PATH`: optional SQLite location.
- `FINBOOK_ALLOWED_ORIGINS`: comma-separated allowed browser origins; defaults
  to localhost and loopback on port 5176.

The tool inventory and input schemas are owned by the
[generated domain manifest](domain/mcp-executable-manifest.json), not a
duplicated list in this README. SQLite files are created from checked-in seeds
and ignored by Git.

Origin checks and MCP session IDs are not a production authentication system.
Keep the development listener local. A hosted adapter must supply suitable
authentication, authorization, and shared persistence while preserving the
[storage contract](storage-contract.md) and existing tool envelopes.
