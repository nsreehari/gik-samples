# Local validation

This repository uses a deterministic local validation sequence. Run the steps in
the order below; each step assumes the previous one succeeded.

Use Node.js 22 or later.

## 1. Install locked dependencies

```sh
npm ci --no-audit --no-fund
```

`npm ci` installs exactly the versions recorded in `package-lock.json`, so the
same commit always produces the same dependency tree.

## 2. Validate vendored and published GIK package resolution

```sh
npm run validate:vendor
```

This verifies that only the still-unpublished `gik-agent-lifecycle-exp` and
`gik-blueprint-agent-host` packages resolve from vendored tarballs, that those
archives match the committed manifest, and that the rest of the `gik-*`
workspace stays on published package versions.

## 3. Build

```sh
npm run build
```

The build compiles `gik-components`, validates the bootstrap catalog and GIK
package resolution, and produces the browser app and Storybook output.

## 4. Typecheck

```sh
npm run typecheck
```

Runs `tsc --noEmit` for the components package, the browser host, the headless
host, the testing helpers, and Storybook.

## 5. Test

```sh
npm test
```

Runs the Vitest suite configured in `vitest.config.ts`.

The MCP server in `packages/mcp-server` has its own lockfile and test command;
see [`packages/mcp-server/README.md`](packages/mcp-server/README.md).

Do not weaken, skip, or make failing validation non-blocking. Report every
command you ran and anything that could not be run. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution requirements.
