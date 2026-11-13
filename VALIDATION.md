# Validation

Run the steps in the order below; each step assumes the previous one succeeded.
With explicit maintainer approval, use the PR CI workflow to run validation
entirely on GitHub-hosted runners instead of installing or building locally.
CI uses public npm and does not change the local corporate registry mirror.

Use Node.js 24.

## Change-aware CI

The required `validate` job always reports a result; the PR workflow has no
path-level trigger filter. It checks patch hygiene and release policy before
selecting up to three independent isolated lanes. Dependency-free distribution,
documentation and policy tests run once in planning unless complete same-input
evidence is reused.

Root documentation-only PRs avoid dependency installs. MCP-only changes install
and test that standalone package; Finbook-only changes run its complete check
in an extracted standalone checkout. Components, browser/bootstrap, Storybook, shared
scripts, workflow, dependency/configuration, and unknown build-input changes
take the full applicable path. Shared policy/configuration changes also test
both standalone consumers. Manual dispatch selects all checks.

Studio/Components builds the site, typechecks Studio, runs root tests excluding
`apps/finbook/**` and browser smoke. The standalone Finbook
lane runs all four files under `apps/finbook/test` through that app's own Vitest
configuration, plus browser build/typecheck, Blueprint validation and server/domain
checks. Those four files import only Finbook-local implementation and published
packages; none depends on the root bootstrap catalog setup. They are the same
test files included by root Vitest, so CI does not run them twice. Local `npm test`
and `npm run typecheck` still preserve their complete original coverage.

The checked-in classifier is conservative for unknown build inputs. If a
required step fails, the job fails; skipped unrelated steps do not turn a failed
check into success. `validate` uses `always()` and checks that every selected lane
succeeded, rejecting failed, cancelled or inappropriately skipped lanes.
npm caches reuse downloads, not installed dependencies. Metadata-only events can
reuse complete, identical-tree successful evidence; missing evidence runs normal
validation. See [fingerprints and rollout](RELEASING.md#artifact-classes-fingerprints-and-rollout).
Components release inputs also require the expected patch/minor/major version
in the existing implementation PR; see [release automation](RELEASING.md#automatic-stable-releases).

## 1. Install dependencies

```sh
npm exec --yes --package=npm@11.19.0 -- npm install --no-audit --no-fund
npm exec --yes --package=npm@11.19.0 -- npm install --prefix apps/finbook --no-audit --no-fund
npm exec --yes --package=npm@11.19.0 -- npm install --prefix packages/mcp-server --no-audit --no-fund
```

All external GIK packages resolve from published npm versions. `gik-components`
uses the local source directory through `file:` dependencies for Studio;
Finbook and its browser host use the published package. This repository
requires committed separate npm v3 lockfiles for root, Finbook (including its workspaces)
and MCP. Do not change dependency ranges while refreshing reproducible resolution.
Generate and commit all three before rolling out these workflows;
`node scripts/check-locks.mjs` fails closed if any is absent or stale.
CI retains standard `npm install` and rejects lock drift, rather than switching to
`npm ci` before Linux optional-dependency behavior has been proven. No global npm
installation is needed. Finbook retains its separate compatible XYFlow
archives; there are no vendored GIK archives.

### Resolve locks on a GitHub-hosted runner

When local public-npm access is unavailable, the maintenance workflow
`dependency-locks.yml` provides the same three resolutions without publication,
deployment, write permissions, secrets, lifecycle scripts or dependency-range
changes. It uses Node 24 and npm 11.19.0, runs standard
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` for each
root, checks lock/schema/workspace consistency and rejects non-lock tracked edits.
It uploads **only** the three lockfiles in `dependency-locks`; source commit,
toolchain and SHA-256 digests are recorded in the job summary.

After review and pushing the implementation branch, a maintainer can run:

```sh
gh workflow run ci.yml --repo nsreehari/gik-samples --ref automation/actions-efficiency -f generate_locks=true
gh run list --repo nsreehari/gik-samples --workflow ci.yml --limit 5
gh run download <run-id> --repo nsreehari/gik-samples --name dependency-locks --dir .artifacts/resolution
```

The already-registered CI workflow calls the branch-local maintenance workflow;
no prerequisite default-branch merge is needed. Only an explicit manual dispatch
with boolean `generate_locks=true` selects generation instead of normal manual
CI. Its planning, lanes, aggregate and evidence jobs are skipped; this is not an
application-validation result. PR events cannot select this mode and retain
all mandatory guards/checks. Omit the input (default `false`) to run normal CI.
The maintenance workflow also retains a direct manual entrypoint once registered.
Confirm the run checked out the intended branch commit, verify artifact digests
against the summary, copy the three files to their
corresponding repository paths, review them and commit through the normal branch.
No automatic commits or pushes occur.

Then run the required PR CI lanes remotely and the release-equivalent build,
typecheck, root tests, distribution tests and affected standalone checks. Lock
generation success is **not** evidence that builds/tests passed. This maintenance
workflow neither enables cross-repository dispatch/promotion flags nor substitutes
for required `validate`.

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
correlated results. Release assembly collects published package archives before
its browser smoke test and sets `CHECK_PACKAGE_DOWNLOADS=true` to verify served
downloads. PR smoke checks the site without registry archive collection.
See [Pages package downloads](RELEASING.md#pages-package-downloads)
for the collector's release responsibilities.

Documentation-only changes need link/hygiene checks rather than local
installation or builds; existing required PR checks still apply.

CI archives only `apps/finbook` into an ignored `.artifacts/finbook` directory,
installs dependencies from npm using its committed lock, and runs its existing `check`
script. This verifies app typechecking, Blueprint validation, browser build,
and domain/server tests without a local Components workspace or parent
`node_modules`. The Studio lane does not install Finbook.

Do not weaken, skip, or make failing validation non-blocking. Report every
command you ran and anything that could not be run. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution requirements.
