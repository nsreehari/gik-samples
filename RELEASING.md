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
6. Approve the protected `npm-publish` environment after reviewing the release
   commit, version, channel, package contents, and validation results.

The first publication needs a narrowly scoped npm bootstrap token stored only as
the `NPM_TOKEN` environment secret, with the environment variable
`NPM_TOKEN_BOOTSTRAP_ENABLED=true`. After the package exists, register
`nsreehari/gik-samples`, `.github/workflows/publish.yml`, and the `npm-publish`
environment as its npm trusted publisher, remove the bootstrap token, and set
`NPM_TOKEN_BOOTSTRAP_ENABLED=false`.

This repository publishes only `@gik/components`. Its vendored `@gik/*` archives
are build inputs and must never be published from this repository.
