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

The versioning App updates `packages/components/package.json` and the matching
workspace version in `package-lock.json` in the
**existing implementation PR**. It compares with the PR base, so reruns and its
own commits do not repeatedly bump the version. Normal required CI checks the
expected version and reruns on the App commit. Update a stale PR before merging;
the version bot recomputes against its updated base.

A manifest-only catch-up release may set the version manually in the reviewed PR.
CI requires a valid, increasing stable version even when no published inputs changed.
Prerelease changes still require the explicit label described below.

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
6. Publish the exact core `gik-*` dependency versions first. Locked installs and
   the clean registry consumer must resolve published packages successfully.
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

For Components releases, the version-changing push does **not** deploy Pages.
The release event owns the one canonical path: validate/build/pack, environment
approval, OIDC publication, clean npm consumer verification, exact-version archive
collection, smoke test, deployment. Publication failure prevents Pages deployment.
There is no post-publication workflow dispatch. Publication and Pages have
separate concurrency groups; neither cancels an in-flight publish/deployment.

The unprivileged validation job builds Components and the site once. It packs
the built Components output with lifecycle scripts disabled and inspects the
**actual** tarball: identity, dependency metadata, declared export files, safe
paths, SHA-256, and npm SHA-512 integrity. The protected job installs no project
dependencies and never rebuilds or repacks. It rechecks tag/main, source
fingerprint and archive contents, then publishes those exact bytes with
`--ignore-scripts --provenance`. The normal developer `prepack` remains intact.
The existing dispatch-only `bootstrap-first-components-publish.yml` remains
unchanged for one-time npm package registration. It is not a recurring release
or Pages path and must not be used after registration.

After publication, a fresh consumer installs the exact registry version with
scripts disabled, runs `npm audit signatures`, imports every public export, and
compares registry bytes/integrity against the candidate. Missing provenance,
integrity mismatch or consumer failure blocks Pages. If publication succeeded
but a later step failed, rerun verification/collection as appropriate; never
change the contents of an already published version.
Consumer verification runs in a separate read-only job without publication/OIDC
authority. Candidate and manifest digests are handed off through validation job
outputs; the publisher rejects a missing handoff rather than trusting hashes
contained only inside the downloaded artifact.

Pages runs `npm run pages:collect-packages` after building the site to download
all ten pinned stable core GIK packages and the selected published Components
version from public npm into `src/browser-host/dist/vendor/`. The collector verifies
each archive against npm integrity metadata and generates an HTML index,
`manifest.json` (versions, filenames, original npm URLs, sizes, integrity, and
SHA-256), and `SHA256SUMS`. Downloads never enter Git or alter dependencies.

The core version set is maintained in `scripts/pages-core-versions.json`.
Update it when adopting another core release. Missing newly published metadata
or tarballs are retried briefly for npm propagation; integrity failures,
unexpected hosts, and other HTTP errors fail the deployment.

Pages-only dispatches accept a `components-v...` tag or a complete 40-character
commit SHA, never mutable `main`/`latest`. They collect exact versions declared
by that ref, which must already exist on npm. Dispatch the workflow from current
`main` so current guards apply, and set `release_ref` to the rollback target.
The target must be an ancestor of `main`. Rollback never republishes npm.
Supported rollback refs include a committed root lock matching their manifests
and `scripts/pages-core-versions.json`; pre-rollout lockless refs fail explicitly
rather than silently re-resolving a different dependency graph. Site source comes
from the pinned ref, while collection/smoke tooling comes from the current workflow
commit. All eleven package versions still come from the pinned ref as validated
data, not from current defaults.

npm caches contain downloaded packages, never `node_modules`; every job still
installs against its manifests and lockfiles. All eleven archive integrity
checks and the dependency-free built-site smoke remain mandatory before deployment.

## Artifact classes, fingerprints and rollout

- **Download cache:** npm content-addressed downloads, partitioned by OS,
  architecture, Node major, npm resolver, lane and all manifests/locks. Restored
  downloads still undergo npm integrity checks. No installed dependency tree is
  shared between PR, standalone, publication or privileged jobs.
- **Validation evidence:** `validation-evidence` records the successful required
  aggregate and complete input fingerprint (14-day retention).
- **Build outputs:** `release-candidate` contains the inspected `.tgz`, hashes and
  source manifest; `site-build` contains the already-built site without registry
  downloads (14-day retention). These are immutable Actions artifacts, not caches.
- **Deployment output:** `github-pages` contains the assembled site and verified,
  exact-version npm downloads. It is not a package source for downstream builds.
- **Dependency proposal:** `verified-dependency-plan` records upstream identity,
  immutable-by-validation manifest digest, explicit package versions and proposed
  file contents before the maintainer App receives write authority (7 days).

The evidence fingerprint includes the full checked-out Git tree, workflow/helper
policy identity, exact Node version, npm resolver/packer 11.19.0,
OS/architecture, runner image
OS/version, validation recipe
and `VITE_BASE=/gik-samples/`. The tree includes source, configuration, vendored
Finbook inputs and every resolution lock. Even documentation changes currently
invalidate it deliberately; unsafe approximate/PR-head-only reuse is unsupported.

Unrelated label/title/body events still report `validate`, but may reuse a prior
successful same-tree CI aggregate with exactly the same selected lane scope.
Release-intent label changes recheck version
policy and run validation normally. Missing/expired evidence falls back to fresh
validation. Policy and patch checks always run before considering reuse.
Artifact availability is queried first: absent/expired proof is a logged cache
miss, and valid input/scope drift is a logged fallback. API/download/filesystem
errors, malformed matching evidence, and checksum corruption fail the run rather
than silently rebuilding. Candidate format 2 binds the site with a deterministic
path/size/SHA-256 file-tree digest, including all hidden files.
Promotion verifies the staged and restored site; validation verifies it again
before upload, without requiring `node_modules`.
Pages deployment explicitly tolerates intentionally skipped publication or site
jobs, but runs only after successful archive collection and assembled-site smoke.

Release artifact promotion is **off by default**. Before merging the workflow
rollout, commit all three resolution lockfiles and pass
`node scripts/check-locks.mjs`; missing/stale locks deliberately block CI/release
instead of falling back to an unrecorded resolution. After human review and merge:
1. Run `node scripts/actions-evidence.mjs policy` from a clean approved checkout
   and set repository variable `GIK_SAMPLES_POLICY_SHA256` to its output.
2. Set `GIK_SAMPLES_REUSE_PR_ARTIFACTS=true` to opt in. Every workflow/helper
   change invalidates that policy identity and needs renewed human review.
3. Eligible CI must be successful, same-repository `ci.yml` PR validation, have
   an approval on the PR head, and belong to the PR merged as this release
   commit. A current trusted human (owner/member/collaborator) must approve that
   PR head, with no outstanding trusted changes-requested review; bots, outsiders,
   dismissed/stale approvals and incomplete review pages do not qualify. The
   candidate must record that run's synthetic merge tree (not merely
   its PR head SHA), with the complete matching fingerprint and inspected bytes.
4. Promotion re-attests the unchanged candidate to the release commit. If any
   condition is absent, validation rebuilds rather than trusting a green badge.

`npm-publish` and `github-pages` environment protections, trusted publisher
configuration, normal branch protection, required `validate`, and review remain
mandatory. Never enable reuse by copying a hash from an unreviewed PR. Disable
reuse by setting `GIK_SAMPLES_REUSE_PR_ARTIFACTS=false`; fresh validation continues.

## Verified upstream GIK release contract

The trusted `verified-gik-release.yml` runs only from this repository's default
branch. It accepts `repository_dispatch` type `gik-release-verified` or manual
`tag`, `commit`, `manifestSha256` inputs as **untrusted data**, never executable
code. The source contract is:

```json
{
  "format": "gik-release-manifest/1",
  "repository": "nsreehari/generative-interaction-kernel",
  "commit": "<40 lowercase hex>",
  "tag": "<release tag>",
  "verificationRunId": "<numeric string>",
  "packages": [
    {
      "name": "gik-kernel",
      "version": "<exact stable version>",
      "integrity": "<npm SHA-512 SRI>",
      "tarball": "https://registry.npmjs.org/gik-kernel/-/gik-kernel-<version>.tgz"
    }
  ]
}
```

GIK attaches public release asset `gik-release-manifest.json` **after** its clean
npm verification. Dispatch payload is `{tag, commit, manifestSha256}`. Enable
GIK's `GIK_SAMPLES_RELEASE_DISPATCH=true` only **after both implementation PRs
merge and remote validation succeeds**. The receiver defaults to the exact
consumer job name `Verify published stable packages / Consume published packages`;
no new configuration is required. `GIK_VERIFICATION_JOB` is an optional reviewed
override if the upstream display name changes; a mismatched/missing successful
job still fails closed. The source run must be a successful `release` event from that
workflow, source repository and exact tag commit; the source asset digest and tag
target are independently checked. Source job/workflow identity changes require
review and configuration updates, not a bypass.
Because GIK dispatches from its final announce job, the receiver retries an
in-progress source run for up to six 10-second waits, then still requires complete
workflow success and the successful consumer job. Pending is never accepted as
success; timeout or a failed final announce requires a later retry.

The planner independently checks npm metadata/integrity/provenance, installs
registry packages with scripts disabled, and runs `npm audit signatures`.
Upstream manifest hashes **do not substitute for** signature/provenance checks.
Provenance must identify the expected repository and publishing workflow with
one exact source commit. Independently versioned unchanged GIK packages may
identify older publishing commits: cached source compare API results must prove
each is an ancestor of (or equal to) the manifest release commit. Newly published
Components still require the exact candidate commit. Incompatible, unrelated or
missing attestations fail closed.
No upstream build outputs replace registry packages.

The resulting job summary exposes every proposed package/version and changed
path. Structured updates raise existing published pins/minima and Pages core
versions without downgrading, replacing Studio's local Components workspace,
changing package versions, or editing application source. Three lock graphs are
regenerated with npm 11.19.0 and lifecycle scripts disabled.

Only after planning, the `dependency-updates` environment grants the existing
maintainer App Contents/Pull requests write permission. Configure required human
reviewers and main-only deployment restrictions on this environment. It updates
one branch/PR, `automation/verified-gik-release`; it never pushes to `main` or
merges. Normal version automation, CI and review apply. Repeated digests are
idempotent; stale signals older than the newest published manifest are ignored,
and newer verified releases coalesce into the same PR. No dependency PR dispatches
another upstream event, preventing self-trigger loops. If `main` advances during
planning, rerun to replan; never force through a stale plan.
Coalescing appends history with the existing automation head and current main
base as parents and updates the ref with `force:false`. It checks exact branch/PR
identity, expected App bot author and source-base/digest message markers first.
Human edits, closed-unmerged PRs, identity drift or concurrent branch movement
require explicit human action; they are never overwritten.

## Operational checks

Compare Actions job durations, total runner minutes per merge, number of Pages
deployments per Components version, npm cache hit rate, promotion/fallback rate,
and registry propagation/verification failures before and after rollout. Existing
audit baselines: root install ~44s, Finbook ~33s, build ~87–365s, tests ~105s,
extracted Finbook ~77s, Pages ~109–120s. Expected Components merges produce one
Pages deployment, one Components build/pack, and zero project installs in the
publisher. Do not equate fewer jobs or a cache hit with successful validation.
Retain run URLs and artifact digests when investigating discrepancies.
