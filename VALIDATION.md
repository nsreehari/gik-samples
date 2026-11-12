# Validation

Run the steps in the order below; each step assumes the previous one succeeded.
With explicit maintainer approval, use the PR CI workflow to run validation
entirely on GitHub-hosted runners instead of installing or building locally.
CI uses public npm and does not change the local corporate registry mirror.

Use Node.js 24.

## Change-aware CI

The required `validate` job always reports a result; the PR workflow has no
path-level trigger filter. It checks patch hygiene and runs the dependency-free
distribution/documentation/policy tests for every change.

Root documentation-only PRs avoid dependency installs. MCP-only changes install
and test that standalone package; Finbook-only changes run its complete check
and isolated extraction check. Components, browser/bootstrap, Storybook, shared
scripts, workflow, dependency/configuration, and unknown build-input changes
take the full applicable path. Shared policy/configuration changes also test
both standalone consumers. Manual dispatch selects all checks.

The checked-in classifier is conservative for unknown build inputs. If a
required step fails, the job fails; skipped unrelated steps do not turn a failed
check into success. npm caches reuse downloads, not installed dependencies.
Components release inputs also require the expected patch/minor/major version
in the existing implementation PR; see [release automation](RELEASING.md#automatic-stable-releases).

## 1. Install dependencies

```sh
npm install --no-audit --no-fund
npm install --prefix apps/finbook --no-audit --no-fund
npm install --prefix packages/mcp-server --no-audit --no-fund
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
Bootstrap validation, Finbook, and Storybook run concurrently after Components
compilation; the browser build waits for all required outputs. Storybook resolves
local Components source to avoid docgen parsing minified distribution bundles.
Autodocs and accessibility support remain enabled. Studio and extracted Finbook
still validate their normal built/published package entry points.

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

CI additionally archives only `apps/finbook` into a temporary directory outside
the checkout, installs dependencies from npm, and runs its existing `check`
script. This verifies app typechecking, Blueprint validation, browser build,
and domain/server tests without a local Components workspace or parent
`node_modules`.

Do not weaken, skip, or make failing validation non-blocking. Report every
command you ran and anything that could not be run. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution requirements.
