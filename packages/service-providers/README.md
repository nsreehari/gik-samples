# GIK service providers

```sh
npm install gik-service-providers
```

```ts
import { createSchedulerServiceKind } from "gik-service-providers/scheduler";
import { createGmailServiceKind } from "gik-service-providers/gmail";
```

There is deliberately **no package-root export or index barrel**. Applications
explicitly import and register the providers they choose. Gmail does not import
Croner or scheduler code. Both use the published `gik-controlface/services`
contracts; there are no private sibling-checkout dependencies.

## Ownership and setup

Native Blueprint declarations own concrete non-secret configuration, such as
the cron expression/timezone and Gmail endpoint/opaque `credentialRef`. Providers
own config schemas and operation semantics. Hosts own provider enablement,
literal secrets, OAuth sessions/refresh, endpoint admission and invocation
authority. Do not substitute environment-based endpoint bindings for Blueprint
config, or put tokens in config, events, journals, setup reports or logs.

`registry.describe()` supplies provider config schemas.
`host.describeServiceSetup(id)` supplies non-secret dependencies, readiness and
host-implemented setup action descriptions without fetching credentials.
Gmail derives OAuth scopes from declared operations; send also declares a
`gmail-send-authority` dependency. Hosts inspect these using the full service
identity, not a global credential-reference string. Disabling a provider is a
host readiness/authorization decision, not an inferred Blueprint state change.

[Host/headless wiring](examples/host.ts) explicitly registers both chosen
providers and requires a host authorization evaluator. [Settings rendering](examples/settings.ts)
uses the same setup reports and trusted action handlers. It supports string
action inputs (including transient password fields); extend unsupported schemas
explicitly, never silently ignore them. The example displays the provider config
schema; an application's authoring UI persists non-secret config in its Blueprint,
not a parallel host override table.
Enablement checkboxes call trusted application handlers. On disable, those
handlers must stop the old host's active Senses and deny further invocations;
when enabling, rebuild/register the chosen host providers before rerendering.
Pass the selected service IDs to headless inspection as well. Toggling a checkbox
alone does not cancel runtime work or confer execution authority.

Browser OAuth action handlers can use Google Identity Services and retain the
user gesture. A headless host provisions an appropriately consented, refreshable
connection through an operator CLI/deployment tool. Neither provider opens login
windows or stores refresh tokens. Gmail scopes may require Google's sensitive/
restricted-scope verification; see [Google's scope guide](https://developers.google.com/workspace/gmail/api/auth/scopes).
The examples are integration seams, not a bundled OAuth application or token vault.

## Scheduler

Kind `cron-scheduler`, version `1`, config:

```json
{ "expression": "0 9 * * *", "timezone": "Asia/Kolkata" }
```

Declare `tick`, contract `scheduler.cron/v1`, as an immediate timer Sense with a
`due` signal. Input is `{}`. Signals contain `firedAt`, `expression`, and
`timezone`. Croner interprets the explicit timezone including daylight saving.

This is **process-local**, not a durable OS scheduler. Restarting schedules only
future occurrences; offline occurrences are skipped, never caught up. Busy
deliveries do not overlap. Closing/aborting cancels the timer, and close waits for
an in-flight delivery. The Blueprint's committed Sense intent can be reconciled
after restart through the normal GIK host.

## Gmail

Kind `gmail`, version `1`, config:

```json
{
  "endpoint": "https://gmail.googleapis.com",
  "credentialRef": "google/main",
  "pollIntervalMs": 60000
}
```

The endpoint is intentionally limited to Google's canonical Gmail origin.
`authorizeEndpoint` must admit every concrete request before credential
resolution. `resolveCredential` returns a `GmailConnection`, not a raw token.
Its `request` method adds authorization inside host state and honors the supplied
abort signal. `clearCredential` invalidates a session on HTTP 401.

| Operation | Contract | Input |
| --- | --- | --- |
| `search` | `gmail.search/v1` | Optional `query`, `maxResults` (1-100), `pageToken` |
| `get` | `gmail.get/v1` | `id`; optional `format`: metadata/minimal/full/raw |
| `send` | `gmail.send/v1` | `raw`: RFC 2822 message encoded as base64url |
| `watch` | `gmail.watch/v1` | Optional `query`, `maxResults` (1-100) |

`search`/`get` return Gmail JSON data. `watch` is an immediate feed Sense with a
`message` signal containing message ID and optional thread ID; fetch bodies with
`get`. Initial polling emits currently matching IDs. Polls are serialized and
bounded to one page; no complete mailbox-history, webhook, exactly-once or gap-free
guarantee is implied. The latest 256 emitted IDs are deduplicated in memory;
restart can emit existing IDs again. Use normal durable GIK delivery IDs and
application-level deduplication/cursors when stronger guarantees are required.
Close aborts outstanding work, suppresses late signals, and waits for the poll.
Expiry/revocation is rechecked for the actual service on every request/delivery.

### Sending is not authorized by credential readiness

The host must supply the **separate `GmailConnection.send` port**. It receives the
full invocation context and must use the host's existing sole authorization
evaluator, including confirmation and idempotency policy, before issuing POST.
The host example wires this port back through `DefaultServiceHost.authorizeInvocation`.
Keep the same evaluator on the outer host so `confirmation-required` is a normal
typed settlement before provider execution, not a surprise login or hidden write.
The host must inspect recipients/content in the decoded raw message when deciding
authority. Possessing Gmail OAuth send scope alone is not permission to send.

Send declarations must be immediate and must not request transport/guardrail
retries or correction attempts. The provider never retries POST. Network failure,
HTTP 408/5xx, or an unreadable success response produces
`GmailSendUncertainError` (`gmail-send-uncertain`), not a safe-to-retry result.
Investigate Sent mail and require fresh host authority before a new attempt;
Gmail does not provide a general idempotent-send guarantee.

## Distribution and release

Both subpaths are independently built and smoke-tested from the actual npm
tarball in a clean consumer, including TypeScript and the absent root export.
GitHub Actions performs all installation, build, typecheck and tests for this
repository. Publishing remains a protected maintainer-approved action; see the
provider release workflow and its first-package bootstrap instructions.

The first release cannot use npm trusted publishing until the package exists.
A maintainer must provision a narrowly scoped `NPM_TOKEN` in the protected
`npm-publish` environment, dispatch `release-service-providers.yml` with the exact
`providers-v0.1.0` tag, `bootstrap: true` and
`confirm: PUBLISH gik-service-providers`, then approve the environment. Validation
and tarball creation run without that token; publication consumes the inspected
bytes with lifecycle scripts disabled. Signature/provenance and clean-consumer
verification remain mandatory. Afterward configure npm's trusted publisher for
this repository's `release-service-providers.yml` workflow and `npm-publish`
environment, and revoke the bootstrap token. Normal releases use OIDC only.

Future production/package changes are versioned in the same PR by a trusted-base
App workflow (patch by default, explicit `release:minor`/`release:major` labels).
Test-only changes do not bump this package. Immutable `providers-v` release tags
must match the package version and current main commit. Publishing never builds
or repacks while credentials are available and always rechecks source/tag/digest
after the protected approval gate.
