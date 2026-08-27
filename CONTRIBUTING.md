# Contributing to GIK Samples

Thank you for improving GIK's public components, Blueprints, and browser
experiences.

## Before starting

1. Search existing issues and pull requests.
2. Open an issue for behavior changes or substantial samples.
3. Keep credentials, private endpoints, customer data, proprietary prompts, and
   private repository references out of all contributions.
4. Use the security advisory process in [SECURITY.md](SECURITY.md) for
   vulnerabilities.

## Development

Use Node.js 22 or later:

```sh
npm ci --no-audit --no-fund
npm run dev
```

Do not replace vendored `@gik/*` packages with sibling checkout dependencies.
Do not regenerate vendored archives unless a maintainer explicitly approves the
provenance change.

## Pull requests

- Create a focused branch and link the issue with `Closes #<number>`.
- Preserve public component and Blueprint compatibility unless the issue
  explicitly approves a breaking change.
- Add focused tests for behavioral changes.
- Do not combine dependency, workflow, release, security, endpoint, vendoring,
  or governance changes with unrelated work.
- Complete the pull-request template and disclose anything that could not be
  validated.

Before requesting review, run:

```sh
npm run build
npm run typecheck
npm test
```

The required `validate` check, a current branch, and resolved conversations are
enforced before merge. The sole maintainer performs the human review and merge
decision; independent approving reviews become required when another maintainer
is available.

## Official and community samples

Content already shipped in the bootstrap catalog and maintained by the
repository owner is official GIK sample content. New contributed Blueprints and
components begin as community contributions. Acceptance does not imply a
support SLA, compatibility guarantee, hosted backend, or promotion into the
official curated catalog.

Promotion to the official catalog is an explicit maintainer decision based on
quality, licensing, security, accessibility, maintenance cost, and usefulness.
