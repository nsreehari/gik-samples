# Sample guide

Use the [documentation hub](https://nsreehari.github.io/gik-samples/docs/#samples)
to choose a sample, or the [walkthrough](https://nsreehari.github.io/gik-samples/getting-started/)
to build a standalone application.

## Choose an example

| Example | Runs where / prerequisites | Source and behavior |
| --- | --- | --- |
| Mock portfolio | Browser; no external service setup | [Blueprint and tests](../src/bootstrap/blueprints/portfolio-tracker-mock) |
| Finbook | Local Node.js 24 browser/server workspace; SQLite sample backend | [App-owned setup, extraction, and hosting](../apps/finbook/README.md) |
| Portfolio intelligence | Studio host with authorized market/intelligence integrations | [DPP behavior cases](../src/bootstrap/blueprints/portfolio-tracker-new/TEST_CASES.md) |
| Continuous timer observation | Headless Node.js host, not a hosted browser route | [Sense host](../src/headless/senses-clock-host.ts) and [continuous-awareness commands](#continuous-awareness) |
| Incident analysis | Studio host with configured agent endpoints and credentials | [Blueprint, scenarios, and tests](../src/bootstrap/blueprints/incident-analysis-new-shell) |

The [bootstrap catalog](../src/bootstrap/catalog.json) owns the full set of
seeded Blueprints and launch profiles. Not every seed is a user-facing
application: some provide assets, test fixtures, or nested composition.
Selected Blueprints use `?b=<id>` on the Studio root. The
[Scenario Explorer](https://nsreehari.github.io/gik-samples/scenarios/)
shows declared scenarios; it does not provision external services.

Finbook is independent of Studio and consumes published GIK packages, including
Components. Studio develops against local Components. Dependency ranges belong
in the consumer manifests; setup commands belong in the app/package READMEs.

## Purpose before DPP machinery

Not every agent, conversation, or stateful Cell is a purpose participant.
Establish the enduring responsibility, beneficiaries, value, and boundaries
before choosing a DPP implementation. Its manifest expresses that reference
frame; context storage is useful only insofar as selected evidence helps the
Cell serve its purpose. Neither creates a purpose by itself.

The portfolio intelligence purpose is to **improve the owner's ability to make
informed portfolio decisions consistent with their objectives**, not merely
generate a report. Its native DPP can use prior observations to make its
contribution more relevant while respecting uncertainty and missing objectives.
It still participates through ordinary inputs, outputs, and effects; there is
no mandatory observe/assess/plan topology or separate participant scheduler.

The generic AI Agent example's conversation ID does not establish a durable
purpose. Finbook's current query/display flow and the mock portfolio do not
need DPP machinery. Incident Analysis currently treats the selected report as
the closed factual boundary; retained cross-case investigation context must
not be silently introduced into that contract. A new DPP role requires a
grounded value case, not a relabeling of an existing task.

## Browser host and service authority

Blueprints own application composition and cross-Cell behavior; components
render declared data and emit intents. Hosts own external execution, endpoint
authorization, credentials, observer lifecycle, and shutdown.

Service declarations own concrete non-secret configuration, including endpoints
and logical `credentialRef` values. The browser host authorizes endpoints
declared by repository-seeded Blueprints and resolves referenced credentials
when a service is used. Do not put literal keys, tokens, or passwords in a
Blueprint or Vite variable. The public Pages site cannot supply a trusted
Node backend or grant access to external services.

The portfolio intelligence Cell declares `dpp.manifest` and context query/ingest
sources. Its host stores scoped observations in the instance's durable storage
and supplies selected history alongside the current valuation. Its
[behavior cases](../src/bootstrap/blueprints/portfolio-tracker-new/TEST_CASES.md)
own correlation, retry, and lifecycle guarantees; the
[core DPP guide](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/dpp.md)
owns the contract. Manifest text does not start an agent or grant permission.

## Continuous awareness

The [Senses clock Blueprint](../src/bootstrap/blueprints/senses-clock/blueprint.json)
declares a timer Sense and a bounded report source in the same Cell.
The [headless host](../src/headless/senses-clock-host.ts) registers existing
service kinds, reconciles committed bindings, journals each Signal, and executes
the resulting source effects. Generic workers and React mounts do not
automatically create Sense observers.

After following the [repository prerequisites](../VALIDATION.md), run from
the repository root:

```sh
npm exec -- tsx src/headless/senses-clock-demo.ts
npm test -- src/headless/senses-clock-host.test.ts
```

The bounded demo prints counter and report snapshots, then closes its worker
and timer. It uses the published memory storage provider; callers can supply
another compatible durable provider and references. The integration test
reuses storage across host restart and checks repeated delivery, source
settlement, disable, re-enable, recovery, and cleanup. The timer uses fixed-delay
intervals, skips missed occurrences, and starts a fresh interval after reconnect.
See the [core Sense guide](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/senses.md)
for runtime contracts.

## Provisioning is a separate capability

`/provisioning/` and `/in-memory/provisioning/` use the repository/user Blueprint
catalog and store user-owned provisioning profiles in IndexedDB or memory.
They export portable `gik-project/1` plans with the chosen Blueprint and derived
agent declarations. Curated seeds remain immutable.

Plans may be downloaded and applied with copied scripts, or reviewed and
applied through the optional loopback companion. Pairing, approved origins,
workspace boundaries, credentials, and script-only setup are owned by the
[MCP companion README](../packages/mcp-server/README.md). A valid plan or
component does not itself authorize execution.
