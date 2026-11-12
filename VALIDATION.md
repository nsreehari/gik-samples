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
npm install --prefix packages/mcp-server --no-audit --no-fund
```

All external GIK packages resolve from published npm versions. `gik-components`
uses the local source directory through `file:` dependencies. This repository
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
npm run test:distribution
npm test --prefix apps/finbook
npm test --prefix packages/mcp-server
npm run test:pages
```

Runs root Vitest, distribution-script regressions, standalone Finbook/server
checks, MCP companion tests, and the built-browser smoke test (requires Chrome).
The [MCP guide](packages/mcp-server/README.md#validate) owns its narrower checks;
the [Finbook guide](apps/finbook/README.md) owns app-only setup.

## 5. Exercise the Sense host

```sh
node --import tsx src/headless/senses-clock-demo.ts
```

This bounded timer demo closes its worker and observer after reporting
correlated results. CI also collects published package archives before its
browser smoke test and sets `CHECK_PACKAGE_DOWNLOADS=true` to verify served
downloads. See [Pages package downloads](RELEASING.md#pages-package-downloads)
for the collector's release responsibilities.

Documentation-only changes need link/hygiene checks rather than local
installation or builds; existing required PR checks still apply.

Do not weaken, skip, or make failing validation non-blocking. Report every
command you ran and anything that could not be run. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution requirements.
