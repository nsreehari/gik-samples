# Security policy

## Reporting a vulnerability

Do not report suspected vulnerabilities in public issues, discussions, or pull
requests.

Use GitHub's **Report a vulnerability** form on the repository Security page:

<https://github.com/nsreehari/gik-samples/security/advisories/new>

Include affected routes or components, reproduction steps, impact, and any
suggested mitigation. Do not include credentials, personal data, customer data,
or production service details.

You should receive an acknowledgement through the private advisory. Disclosure
timing and remediation will be coordinated there.

## Supported code

Security fixes target the current `main` branch and the live Pages deployment.
Historical tags and generated archives are retained for reference and do not
receive guaranteed backports.

The vendored `@gik-ai/*` archives are temporary, checksum-verified build inputs.
Changes to them, dependency manifests, workflows, endpoint configuration, or
security policy always require human review.
