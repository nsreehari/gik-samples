# Vendored GIK packages

These package archives temporarily decouple `gik-samples` from a sibling GIK
checkout for the GIK packages that are not published to the public registry.
Every published `@gik-ai/*` dependency now resolves from npm; only
`@gik-ai/agent-lifecycle-exp` and `@gik-ai/blueprint-agent-host` remain
vendored here.

Run `npm run vendor:gik` with a clean `../gik-fresh` checkout, or set
`GIK_SOURCE_DIR` to another GIK checkout. The generated manifest records the
source commit and SHA-256 checksum of every archive.

Source maps are excluded to keep the committed binary payload small. Runtime
JavaScript, declarations, schemas, package metadata, documentation, licenses,
and third-party notices remain in their package archives.

This is a rollout bridge, not the long-term distribution model. Replace each
remaining archive with a published package version once that package is
released publicly.
