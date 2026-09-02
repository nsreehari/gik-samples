# Releasing `gik-components`

Package publication occurs only when a GitHub Release is published. Direct local
publication and manual workflow dispatch are not supported.

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

This repository publishes only `gik-components`. Its vendored `gik-*` archives
are build inputs and must never be published from this repository.
