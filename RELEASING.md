# Releasing `gik-components`

Package publication occurs only when a GitHub Release is published. Direct local
npm publication is not supported. Workflow dispatch supports Pages-only
deployment/refresh; it never publishes an npm package.

## Automatic stable releases

Changes to published Components inputs default to a patch release. Add
`release:minor` or `release:major` to the implementation PR for a larger change;
the labels are mutually exclusive. Test-only changes and changes to other apps,
root documentation, or workflows do not request a Components release.
The package README is shipped, so changes to it do request a patch.

The versioning App updates only `packages/components/package.json` in the
**existing implementation PR**. It compares with the PR base, so reruns and its
own commits do not repeatedly bump the version. Normal required CI checks the
expected version and reruns on the App commit. Update a stale PR before merging;
the version bot recomputes against its updated base.

The trusted `pull_request_target` workflow checks out the base only, reads the
PR tree as data, and never installs dependencies or executes PR code with its
write token. Forks must be adopted onto a maintainer branch or have their
expected version updated manually. Draft PRs are not edited.

After the reviewed version merges, the release App creates
`components-v<version>` at that merge commit. The existing release workflow
revalidates it, then waits for `npm-publish` environment approval and publishes
with OIDC. No separate version PR or direct default-branch version push is
needed. Branch protection and review rules are unchanged.

Both automation workflows require the existing `GIK_MAINTAINER_APP_ID` variable
and `GIK_MAINTAINER_APP_PRIVATE_KEY` secret, with the App installed on this
repository and Contents write permission. Do not copy secret values into code.
App-created commits/releases trigger normal CI/release events; the built-in
workflow token would suppress those follow-up events. Missing authorization,
conflicting labels, stale branch heads, non-increasing versions, and mismatched
existing releases fail explicitly rather than weakening checks.

If `main` advances before a release is created or validated, the run fails closed:
do not move an existing release tag. Reconcile the current package version and
create a reviewed follow-up release. Publication can be retried on the same
validated release; release creation is idempotent for the same tag and commit.

## Manual releases and prereleases

Automatic versioning accepts stable versions only. Prerelease authoring and
promotion require the `release:prerelease` label and manually reviewed version
metadata in the implementation PR; the bot does not edit or publish that channel:

1. Change `packages/components/package.json` through a reviewed pull request.
2. Merge only after the required `validate` check succeeds.
3. Create a GitHub Release targeting the current `main` commit.
4. Use the tag `components-v<package-version>`.
5. Mark versions containing a prerelease suffix, such as `-next.0`, as GitHub
   prereleases. They publish to npm's `next` dist-tag. Stable versions publish to
   `latest`.
6. Publish the exact core `gik-*` dependency versions first. The Components
   release gate verifies that each one exists on npm.
7. Approve the protected `npm-publish` environment after reviewing the release
   commit, version, channel, package contents, and validation results.

`gik-components` uses npm trusted publishing with GitHub owner
`nsreehari`, repository `gik-samples`, workflow `publish.yml`, environment
`npm-publish`, and permission to run `npm publish`. The workflow obtains
short-lived OIDC credentials and does not use an npm token.

This repository publishes only `gik-components`. External `gik-*` packages are
consumed from npm and must never be republished from this repository.
Studio keeps `gik-components` linked to its local source directory. Finbook and
its browser host consume the published package, independently of local builds.

## Pages package downloads

Relevant pushes to `main` automatically build and deploy Pages: browser/bootstrap
source, Storybook, Components, root package manifests, build/distribution scripts,
or the Pages workflow. Root Markdown, MCP-only changes, and standalone Finbook
changes do not rebuild the site. Pages uses `npm run build -- --site-only`, which
keeps Components, bootstrap validation, Storybook, and the browser build but
does not install or bundle the separate Finbook app.

For Components releases, Pages builds and deploys independently of npm
publication, using the currently published npm `latest` Components version.
After successful publication, the npm job dispatches this same workflow with
`main` as the workflow ref and `release_ref`, keeping the current site instead
of rolling it back to an older release's sources. The existing release
concurrency group queues that Pages-only refresh after the initial release run.
This second deployment resolves the published npm `latest` Components version.
It does not publish to npm again.

Pages runs `npm run pages:collect-packages` after building the site to download
all ten pinned stable core GIK packages and the selected published Components
version from public npm into `src/browser-host/dist/vendor/`. The collector verifies
each archive against npm integrity metadata and generates an HTML index,
`manifest.json` (versions, filenames, original npm URLs, sizes, integrity, and
SHA-256), and `SHA256SUMS`. Downloads never enter Git or alter dependencies.

The core version set is maintained in `scripts/collect-pages-packages.mjs`.
Update it when adopting another core release. Missing newly published metadata
or tarballs are retried briefly for npm propagation; integrity failures,
unexpected hosts, and other HTTP errors fail the deployment.

Pages-only dispatches to a tag/commit collect the versions declared by that ref, which
must already exist on npm. Older refs that predate this collector retain their
original deployment behavior. A failed Components publication does not block the
independent initial Pages deployment or trigger a refresh; its download manifest
continues to identify the actual previously published Components archive.

npm caches contain downloaded packages, never `node_modules`; every job still
installs against its manifests. All eleven archive integrity checks and the
built-site smoke remain mandatory before deployment.
