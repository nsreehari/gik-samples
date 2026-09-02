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

## 2. Validate the vendored packages

```sh
npm run validate:vendor
```

This verifies the provenance, checksums, and contents of the committed archives
under `vendor/gik-packages`. Vendored package integrity is also checked during
the production build, so this step is a fast standalone check that fails early
before the longer build.

## 3. Build

```sh
npm run build
```

The build compiles `gik-components`, validates the bootstrap catalog and the
vendored packages, and produces the browser app and Storybook output.

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
