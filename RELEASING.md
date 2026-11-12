# Releasing `gik-components`

Package publication occurs only when a GitHub Release is published. Direct local
npm publication is not supported. Workflow dispatch supports Pages-only
deployment/refresh; it never publishes an npm package.

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
consumed from npm and must never be republished from this repository. Repository
consumers keep `gik-components` linked to its local source directory.

## Pages package downloads

For Components releases, Pages builds and deploys independently of npm
publication, using the currently published npm `latest` Components version.
After successful publication, the npm job dispatches this same workflow with
the release tag as both the workflow ref and `release_ref`. The existing release
concurrency group queues that Pages-only refresh after the initial release run.
This second deployment uses the exact Components version declared by that tag.
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

Pages-only dispatches collect the versions declared by the selected ref, which
must already exist on npm. Older refs that predate this collector retain their
original deployment behavior. A failed Components publication does not block the
independent initial Pages deployment or trigger a refresh; its download manifest
continues to identify the actual previously published Components archive.
