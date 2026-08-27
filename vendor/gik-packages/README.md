# Vendored GIK packages

Most `@gik-ai` packages are now consumed as published prerelease versions from
npm. Only `@gik-ai/agent-lifecycle-exp` and `@gik-ai/blueprint-agent-host`
remain vendored here: they are private/unpublished packages that gik-samples
still depends on.

Run `npm run vendor:gik` with a clean `../gik-fresh` checkout, or set
`GIK_SOURCE_DIR` to another GIK checkout, to refresh these two archives. The
generated manifest records the source commit and SHA-256 checksum of every
archive.

Source maps are excluded to keep the committed binary payload small. Runtime
JavaScript, declarations, schemas, package metadata, documentation, licenses,
and third-party notices remain in their package archives.

Once `@gik-ai/agent-lifecycle-exp` and `@gik-ai/blueprint-agent-host` are
published, remove this vendoring bridge entirely.
