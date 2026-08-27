# Releasing `@gik/components`

Package publication occurs only when a GitHub Release is published. Direct local
publication and manual workflow dispatch are not supported.

1. Change `packages/components/package.json` through a reviewed pull request.
2. Merge only after the required `validate` check succeeds.
3. Create a GitHub Release targeting the current `main` commit.
4. Use the tag `components-v<package-version>`.
5. Mark versions containing a prerelease suffix, such as `-next.0`, as GitHub
   prereleases. They publish to npm's `next` dist-tag. Stable versions publish to
   `latest`.
6. During the first staged bootstrap, dependency publication is deferred. For
   every later release, publish the exact core `@gik/*` dependency versions
   first; the Components release gate verifies that each one exists on npm.
7. Approve the protected `npm-publish` environment after reviewing the release
   commit, version, channel, package contents, and validation results.

The first publication uses npm staged publishing with the bootstrap `NPM_TOKEN`
and `NPM_TOKEN_BOOTSTRAP_ENABLED=true`. The GitHub Actions job stages the
validated package but does not make it public. Review it under **Staged
Packages** on npmjs.com and approve it with 2FA. The initial Components bootstrap
may precede its core dependencies; do not announce or validate it for consumers
until those exact core versions are published.

After the package exists, register `nsreehari/gik-samples`,
`.github/workflows/publish.yml`, and the `npm-publish` environment as its npm
trusted publisher. Then remove the bootstrap token and set
`NPM_TOKEN_BOOTSTRAP_ENABLED=false`. Later releases publish directly only after
the release gate confirms that every exact core dependency already exists.

This repository publishes only `@gik/components`. Its vendored `@gik/*` archives
are build inputs and must never be published from this repository.
