# Finbook browser host

Private React/Vite composition root for the Finbook reference app.
It is a workspace package, not a separately published GIK library.

[`FinbookHost.tsx`](src/FinbookHost.tsx) composes the app Blueprint, explicit
primitive/finance component providers, and application-owned service host.
The host authorizes the Blueprint-declared MCP endpoint; it does not rewrite
that endpoint from deployment environment variables.

For dependency installation, local component prerequisites, the browser URL,
and starting both processes, use the [Finbook guide](../../README.md).
From the Finbook app workspace root:

```sh
npm run dev:browser
npm run build
npm run typecheck
```

`dev:browser` starts only Vite; the app's MCP server must be running separately.
The app's `build` also validates the Blueprint before building this workspace.
See the [server guide](../../mcp-server/README.md) for its process boundary.

The browser projects committed data and emits events; it is not the finance
database, a durable agent scheduler, or a store for provider credentials.
