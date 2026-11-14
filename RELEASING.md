# Release ownership and Pages

## Independent libraries

Samples consumes published npm packages. It does not build, version or publish
the reusable libraries:

- [gik-components](https://github.com/nsreehari/gik-components) owns Components,
  generated catalogs, unit tests and publication.
- [gik-service-providers](https://github.com/nsreehari/gik-service-providers)
  owns individually imported providers, integration tests and publication.

The migration pins Samples to Components **0.3.2** and Service Providers
**0.3.0**. Their existing official npm archives retain their original metadata
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
deploy consumer changes, including library dependency updates; they never
publish npm packages. Library publication and Pages deployment are independent.

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

Manual dispatch requires a full commit SHA or historical `components-v` tag,
not `main` or `latest`. The source must be an ancestor of main and include a
matching committed root lock and complete exact core version map.

Modern source refs select library versions from exact npm dependencies and
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
workspace links before npm resolves the exact package pins. The mandatory lock
guard rejects retained library workspaces or source-linked dependencies, even
when the root dependency constraints match.

Metadata-only PR events may reuse complete identical-tree successful validation
evidence. Fingerprints bind the Git tree, workflows/scripts, Node/npm resolver,
runner platform/image, build base and recipe. Missing or mismatched evidence
runs fresh validation; caches reuse downloads, not installed dependencies.
Pages builds fresh and does not promote a former library release candidate.
Retain workflow URLs and artifact digests when investigating discrepancies.

## Verified upstream GIK release contract

The default-branch `verified-gik-release.yml` still accepts
`repository_dispatch` type `gik-release-verified` or manual `tag`, `commit` and
`manifestSha256` as untrusted data, never executable code.

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

Structured updates raise existing core pins/minima and Pages core versions
without downgrading, changing independently owned library pins or application
source. Three lock graphs are generated with pinned npm and scripts disabled.
The job summary exposes proposed versions and changed paths.

Only after planning, the protected `dependency-updates` environment grants the
existing maintainer App narrow Contents/Pull requests write permission. Required
human reviewers and main-only restrictions remain mandatory. It updates one
`automation/verified-gik-release` branch/PR, never main and never merges.
Repeated digests are idempotent; stale signals are ignored and newer verified
releases coalesce without self-trigger loops.

Coalescing appends history with the automation head and current main as parents
and updates the ref with `force:false`. Exact branch/PR identity, expected App
author and source-base/digest markers are checked first. Human edits,
closed-unmerged PRs, identity drift or concurrent movement require human action;
they are never overwritten. If main advances, replan rather than force.
