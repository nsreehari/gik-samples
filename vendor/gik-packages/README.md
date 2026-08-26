# Vendored GIK packages

These package archives temporarily decouple `gik-samples` from a sibling GIK
checkout while the first public `@gik` packages are prepared.

Run `npm run vendor:gik` with a clean `../gik-fresh` checkout, or set
`GIK_SOURCE_DIR` to another GIK checkout. The generated manifest records the
source commit and SHA-256 checksum of every archive.

Source maps are excluded to keep the committed binary payload small. Runtime
JavaScript, declarations, schemas, package metadata, documentation, licenses,
and third-party notices remain in their package archives.

This is a rollout bridge, not the long-term distribution model. Replace these
archives with published package versions after the controlled `next` release.
