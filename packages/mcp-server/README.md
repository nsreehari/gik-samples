# GIK Samples MCP server

This package is the local execution companion for the GIK Blueprint Studio. It
is also a normal Model Context Protocol server that can be used without the
browser.

The package keeps complete, reusable units for:

- 14 durable filesystem and runtime tools;
- all 9 local Copilot CLI tools, including agent discovery, source roots,
  synchronous/asynchronous runs, sessions, output, cancellation, and timeouts;
- 6 scoped Lore tools with atomic local persistence;
- the GIK capability `describe` authoring tool;
- optional remote MCP proxy registration with local Azure CLI bearer support;
- reviewed Copilot workspace provisioning;
- optional Azure AI Foundry plan, create/version, verify, and smoke-test flows.

No credential is accepted from or returned to the browser.

## Install

The directory is a standalone package with its own lockfile, so it can be
copied independently from the rest of this repository.

```sh
cd packages/mcp-server
npm ci
```

Foundry is optional. Install its SDK peers only when it is needed:

```sh
npm install @azure/ai-projects@^2.3.0 @azure/identity@^4.13.1
```

Node.js 24 or newer is required.

## Use as an MCP server

For a local MCP client such as Copilot CLI, use stdio:

```sh
node src/index.js --transport stdio
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "gik": {
      "command": "node",
      "args": [
        "C:\\path\\to\\gik-samples\\packages\\mcp-server\\src\\index.js",
        "--transport",
        "stdio"
      ]
    }
  }
}
```

The default registry loads filesystem, Copilot, Lore, and GIK authoring
manifests. Set `DISABLE_HANDLERS` to a comma-separated list of registry IDs to
remove a unit, for example `gik-agent-authoring`.

## Configuration

`.env.template` is the single inventory of user-configurable environment
variables for the MCP server and its provisioning scripts. Copy it to `.env`
in this package and set only the values you need. The server, Copilot
provisioner, and Foundry provisioner all load that file automatically.

Existing process environment variables take precedence over `.env`. Explicit
command-line arguments take precedence over both for the standalone
provisioning scripts. Operating-system and npm-provided variables are not
duplicated in the template.

## Pair Blueprint Studio

1. Copy `.env.template` to `.env`.
2. Set `GIK_WORKSPACE_ROOTS` to locally approved `id=absolute-path` entries.
3. Set `GIK_ALLOWED_ORIGINS` to the exact Blueprint Studio origin. Add the
   GitHub Pages origin when using the hosted Studio.
4. Start the loopback server:

   ```sh
   node src/index.js --transport streamable-http
   ```

5. Open `/provisioning/` in Blueprint Studio and enter the one-use code printed
   by the server.
6. Generate the portable plan, preview it, apply it, and verify it.

The HTTP host always binds to `127.0.0.1`. Wildcard origins are rejected.
Pairing tokens are random, short-lived, held in browser memory, and bound to
the pairing origin. Browser requests use configured workspace IDs, never
browser-supplied filesystem paths. Plans are size-bounded, expire, and are
bound to their reviewed content by SHA-256. Writes reject traversal and
symlinks and use atomic replacement. Audit records are written under
`.data/audit`.

The official stateful Streamable HTTP MCP endpoint remains available at
`http://127.0.0.1:7801/mcp`. Pairing protects the browser provisioning API; it
does not alter trusted local stdio clients.

## Portable plans and script-only use

Blueprint Studio exports `gik-project/1`. The file contains the selected
Blueprint artifact and the agent declarations derived from the user-owned
profile. It contains no credentials or absolute local paths.

The examples below use command-line arguments. The same paths can be supplied
through `COPILOT_PROVISIONING_PLAN`, `GIK_TARGET_WORKSPACE`, and
`FOUNDRY_PROVISIONING_PLAN` in `.env`.

Copilot workspace:

```sh
node scripts/provision-copilot-agents.mjs \
  --plan C:\path\to\project.json \
  --target-dir C:\path\to\repo \
  --dry-run

node scripts/provision-copilot-agents.mjs \
  --plan C:\path\to\project.json \
  --target-dir C:\path\to\repo
```

Changed existing files are preserved unless `--force` is explicitly supplied.

Foundry:

```sh
node scripts/provision-foundry-agents.mjs \
  --plan C:\path\to\project.json \
  --endpoint https://example.services.ai.azure.com/api/projects/example \
  --dry-run

node scripts/provision-foundry-agents.mjs \
  --plan C:\path\to\project.json \
  --endpoint https://example.services.ai.azure.com/api/projects/example \
  --verify
```

Foundry uses `AzureCliCredential`; run `az login` locally first. There is no
default Azure endpoint and no live Azure call in the test suite. Infrastructure
deployment is intentionally not part of the default server.

## Copilot

Install and authenticate Copilot CLI before calling `copilot.run_agent`.
Provisioned agents live under `.github/agents` in the selected workspace.
The complete Copilot surface supports:

- environment and custom-agent discovery;
- Lore-backed additional source roots;
- models and reasoning effort;
- attachments, additional directories, and extra MCP configurations;
- named sessions, session IDs, continue, and resume;
- synchronous and asynchronous execution;
- run listing, output retrieval, cancellation, and timeout cleanup.

Active runs are bounded by `GIK_MAX_ACTIVE_COPILOT_RUNS` (default `2`) to
prevent unbounded nested Copilot invocation.

## Lore and durable filesystem data

Lore defaults to `.data/lore` and supports these scopes:

- `global`
- `board/<id>`
- `user/<id>`
- `app/<id>`

The Copilot source-root registry is stored in `app/copilot` Lore, so the same
memory mechanism remains useful to other agents. Durable filesystem state
defaults to `.data/filesystem-storage`. Both locations are ignored by Git.

Set `LORE_ROOT_DIR` or `GIK_FILESYSTEM_STORAGE_ROOT` to relocate mutable data.

## GIK capability authoring

The `describe` tool reads `.gik/capability-catalog.json` from
`GIK_SAMPLES_WORKSPACE_ROOT`, or the path in `GIK_CAPABILITY_CATALOG`. Export a
catalog from the project before using the tool.

## Extend with a remote MCP server

The retained proxy catalog can expose an upstream Streamable HTTP or stdio MCP
server. Add a `kind: "mcp-proxy"` registry entry with `proxy.connection`.
Azure CLI bearer auth is available for public Azure MCP endpoints, but no
product endpoint is configured by default.

## Validate

```sh
node scripts/smoke-registered-services.js
node --test test/*.test.js
```

`@gik-ai/durable-runtime` is consumed as a published `@gik-ai` prerelease
version, matching the version used by GIK Samples.
