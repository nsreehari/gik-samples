# Release ownership and Pages

## Independent libraries

Samples consumes published npm packages. It does not build, version or publish
the reusable libraries:

- [gik-components](https://github.com/nsreehari/gik-components) owns Components,
  generated catalogs, unit tests and publication.
- [gik-service-providers](https://github.com/nsreehari/gik-service-providers)
  owns individually imported providers, integration tests and publication.

Studio and Storybook declare `latest` for their GIK npm dependencies, including
Components and Service Providers. Committed locks retain concrete versions for
reproducible PR validation; normal Pages builds deliberately refresh the root
GIK graph in CI before testing and building. Standalone Finbook/MCP retain their
separate dependency constraints and locks. Existing official npm archives retain their original metadata
and provenance. Moving source does not authorize republishing immutable versions.
Future releases require a reviewed later version in the owning repository.
Package owners must register its `publish.yml`/`npm-publish` trusted publisher
through an approved channel; never copy tokens or App private keys.

The old Samples library release/version/bootstrap workflows are retired.
Do not restore library workspaces, source aliases or local directory dependencies.
Corporate-machine installations, builds, typechecks, tests and npm registry
operations must run only in CI.

## Pages package downloads

`publish.yml` deploys the npm-backed Studio and Storybook site. Main pushes
deploy consumer changes; they never publish npm packages. Verified stable
publications from core, Components, or Service Providers also trigger this same
workflow, without a dependency-update PR or an extra deployment workflow.
The whole refresh is serialized with `cancel-in-progress: false`, so an older
build cannot finish deployment after a newer concurrent build.

`resolve-latest-gik.mjs` uses pinned npm 11.19.0 to update only declared root GIK
dependencies, without changing their selectors or unrelated direct dependencies.
It independently compares concrete resolved versions, tarball URLs and SRI with
registry `latest` metadata. Changed tags, source links and identity/integrity
mismatches fail explicitly. The resolved lock and resolution receipt are retained
as `pages-resolution`. The site is built only after distribution tests, Studio
typechecking and application tests pass against this graph.

The collector downloads twelve official npm archives: ten core packages,
Components and Service Providers. Every Pages mirror refresh resolves npm's
`latest` tag independently of the site's dependency pins. Core package names
come from `scripts/pages-core-versions.json`; its version values remain site
release inputs, not mirror selectors. No version-list update is needed to
refresh the mirror.
It verifies registry identity, HTTPS registry origin and strong SRI before
writing anything. Only npm visibility 404 responses receive bounded retries;
authorization, identity and integrity errors fail explicitly.

The site exposes `/gik-samples/vendor/` with the original `.tgz` bytes,
`manifest.json`, `SHA256SUMS` and a download index. The manifest records exact
versions, npm/tarball sources, byte counts, integrity and SHA-256. This directory
is not an npm registry or a dependency-resolution fallback. No source copies
or repacked substitute archives are vendored.

The readonly site job hashes the complete built site before upload. The
readonly assembly job verifies that independently handed-off digest before
refreshing the latest-package mirror, then browser-smokes the assembled artifact and
checks every archive's served bytes and download indexes. Only the protected
`github-pages` deployment job receives Pages write/OIDC authority.

## Pinned rollback

Manual dispatch without `release_ref` refreshes current trusted main. Supplying
`release_ref` requires a full commit SHA or historical `components-v` tag,
not `main` or `latest`. The source must be an ancestor of main and include a
matching committed root lock and complete exact core version map.

Modern source refs select concrete library versions from their committed
locked `node_modules` entries. Historical workspace-era refs may select their
two tracked library manifests and matching workspace lock entries. This is
explicit historical metadata compatibility, not a current source-link fallback.
These pinned versions govern the site build, not the mirror downloads. The
current reviewed collector still refreshes all packages from npm's `latest`
tag. The mirror manifest records concrete versions and verified archive
identities, never `latest` as an archive version. A site rollback does not roll
back the package mirror.

## Artifact classes, fingerprints and rollout

Required CI validation keeps isolated Studio, extracted Finbook and MCP lanes.
Studio tests npm consumers, the actual provider archive and all twelve vendor
downloads. Library unit tests run in their owning repositories, not twice here.
Missing/stale root, Finbook or MCP locks block validation.
When migrating an existing lock, the CI generator removes obsolete library
workspace links before npm resolves the current selectors. The mandatory lock
guard rejects retained library workspaces or source-linked dependencies, even
when the root dependency constraints match.

Metadata-only PR events (label/body edits and ready-for-review) may reuse complete
identical-tree successful validation
evidence. Fingerprints bind the Git tree, workflows/scripts, Node/npm resolver,
runner platform/image, build base and recipe. Missing or mismatched evidence
runs fresh validation; caches reuse downloads, not installed dependencies.
Pages builds fresh and does not promote a former library release candidate.
Retain workflow URLs and artifact digests when investigating discrepancies.

## Verified publication-driven refresh

The default-branch `publish.yml` accepts `repository_dispatch` types
`gik-release-verified` (core) and `gik-library-release-verified` (the two standalone
libraries). Payloads are untrusted identities, never executable refs or code.
The old automatic dependency-PR workflow is retired; publication now rebuilds
Pages immediately after read-only verification.

Core attaches `gik-release-manifest.json` only after clean npm verification.
The receiver requires format `gik-release-manifest/1`, expected source repository,
an exact lowercase commit SHA, stable tag, numeric verification run ID and
package name/version/SHA-512 integrity records. It independently verifies the
asset digest, tag target, successful source release workflow and exact consumer
job `Verify published stable packages / Consume published packages`.
`GIK_VERIFICATION_JOB` is a reviewed override, never a missing-check bypass.
The bounded wait for a pending final announce still requires complete workflow
and consumer-job success; pending, timeout or failure is not accepted.

The planner independently checks registry metadata, integrity, signatures and
provenance, installs with lifecycle scripts disabled and audits signatures.
Unchanged independently versioned core packages may identify older publishing
commits only when cached source comparisons prove ancestry to the announced
release. Unrelated or missing attestations fail closed. Upstream artifacts do
not replace registry packages.

Library signals carry the source repository, commit, stable release tag and run
ID. The receiver permits only the two official repositories, verifies the tag's
commit, exact `publish.yml` release run and successful `Verify published package`
job, then checks the source package identity, registry metadata, provenance and
signatures. Forks, prereleases, skipped checks and failed/incomplete runs cannot
authorize deployment. Signals may briefly wait for the notifying run to finish.

Both library publishers notify only after successful stable registry verification,
using the existing maintainer App with a token scoped to `gik-samples` Contents
write (required by repository dispatch). Configure variable
`GIK_MAINTAINER_APP_ID` and secret `GIK_MAINTAINER_APP_PRIVATE_KEY` in each publisher
through an approved owner channel; never copy or expose key material. The App
installation must include Samples. Missing configuration fails the notification
job explicitly. Core's existing `GIK_SAMPLES_RELEASE_DISPATCH=true` notification
is reused unchanged. No npm publish or live deployment is needed to test the
receiver's rejection cases.
