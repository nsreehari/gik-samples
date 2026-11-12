# Validation

Run the steps in the order below; each step assumes the previous one succeeded.
With explicit maintainer approval, use the PR CI workflow to run validation
entirely on GitHub-hosted runners instead of installing or building locally.
CI uses public npm and does not change the local corporate registry mirror.

Use Node.js 24.

## 1. Install dependencies

```sh
npm install --no-audit --no-fund
npm install --prefix apps/finbook --no-audit --no-fund
```

All external GIK packages resolve from published npm versions. `gik-components`
uses the local source directory through `file:` dependencies for Studio;
Finbook and its browser host use the published package. This repository
does not commit npm lockfiles. Finbook retains its separate compatible XYFlow
archives; there are no vendored GIK archives.

## 2. Build

```sh
npm run build
```

The build first compiles `gik-components`, validates the bootstrap catalog, and
produces the Finbook app, browser app, and Storybook output.

## 3. Typecheck

```sh
npm run typecheck
```

Runs `tsc --noEmit` for the components package, the browser host, the headless
host, the testing helpers, Storybook, and Finbook.

## 4. Test

```sh
npm test
npm test --prefix apps/finbook
npm run test:pages
```

Runs the root Vitest suite, standalone Finbook tests/server checks, and the
built-browser smoke test (which requires Chrome).

The MCP server in `packages/mcp-server` has its own install and test command.
CI also runs these when validating the migration:

```sh
npm install --prefix packages/mcp-server --no-audit --no-fund
npm test --prefix packages/mcp-server
```

See [`packages/mcp-server/README.md`](packages/mcp-server/README.md).

CI additionally archives only `apps/finbook` into a temporary directory outside
the checkout, installs dependencies from npm, and runs its existing `check`
script. This verifies app typechecking, Blueprint validation, browser build,
and domain/server tests without a local Components workspace or parent
`node_modules`.

Do not weaken, skip, or make failing validation non-blocking. Report every
command you ran and anything that could not be run. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution requirements.
