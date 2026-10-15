# ADR-0001: Reference purpose-participant organisms and constrained agent authoring

**Status:** Accepted - 2026-09-01

## Context

`gik-samples` hosts the reference material that exercises GIK's Durable Purpose Participant model (see the design note in `gik-maintainer` `TODO.md`, and `generative-interaction-kernel` ADR-0050). Two sample-host concerns needed a recorded decision:

1. The first reference organism — a **portfolio purpose participant** (TODO.md section 20, "Reference A") — needs to demonstrate the participant model concretely: durable purpose/plan/outcome state, governed human requests, and settlement-driven continuation, all as a Blueprint rather than bespoke sample code.
2. Some sample services (notably the Foundry-agent incident-analysis flow) let an agent *author* a presentation Blueprint. Allowing an agent to emit an arbitrary Blueprint would be an open authority and materialization risk. A bounded pattern was needed for constrained generative authoring.

## Decision

### Portfolio participant as a Blueprint organism

The portfolio sample is a Blueprint organism whose settlement handlers read the triggering context from the namespaced `$event.requestContext` (request type, correlation id, revision, effect id) and read response data from top-level fields, consistent with the kernel's request/settlement contract (ADR-0049, ADR-0050). Settlement handlers are guarded on request type, existence, `status = 'pending'`, and `revision = $event.requestContext.revision` (plus plan revision where relevant) so stale and duplicate settlements are rejected. Request-emitting handlers supply dynamic request data through an explicit `args.from` expression rather than relying on implicit event-payload forwarding.

### Constrained agent response authoring (host-owned scaffold, bounded slots)

Agent authoring of a presentation Blueprint is confined to a request-scoped **response workspace**:

- The **host owns a trusted scaffold** (the enclosing Blueprint). The agent authors only a small set of named **slots** targeted by JSON Pointers into that scaffold.
- Pointer traversal blocks `__proto__`, `prototype`, and `constructor` segments and requires each pointer to reference a path the scaffold already defines (no arbitrary creation) — a prototype-pollution and structure-escape guard.
- Capabilities used by authored views are **allow-listed**: composition rejects any capability outside the accepted set, and derived capability tiers/imports are written back into host-owned pointers.
- The composed candidate is **validated and materialized by the host** before acceptance; a candidate that is not a valid or materializable Blueprint is rejected.
- The workspace is request-scoped, opened at service-execution start and closed in a `finally` (no leak across requests), and the agent's tools return typed results/proposals only — the agent never emits kernel effects.

## Consequences

- The portfolio sample is a faithful, inspectable instance of the participant model, usable as a copyable reference rather than one-off host code.
- Generative UI authoring is bounded: an agent can shape only the content of a host-owned scaffold, cannot inject arbitrary capabilities or escape the document structure, and cannot bypass validation/materialization.
- Because the pattern returns a typed proposal (never an effect) and closes its workspace deterministically, it stays consistent with the kernel's "agents are bounded effect executors" rule (ADR-0050) even though it lives at the sample-host layer.
- These are sample-host decisions; enforcement of participant *authority* still belongs to the host invocation-authorization model (ADR-0050), which the samples currently exercise in allow-by-default form.

## Alternatives considered

### Let the agent return a complete Blueprint directly

Rejected. It grants open authoring authority, risks structure escape and prototype pollution, and defers all validation to materialization time. A host-owned scaffold with bounded slots and pre-acceptance validation keeps the trust boundary explicit.

### Implement the portfolio participant as bespoke sample code

Rejected. The point of the reference organism is to demonstrate the participant model *as a Blueprint*; bespoke code would not validate the model or serve as a copyable reference.

### Allow any capability the authored views reference

Rejected. Capabilities must be allow-listed so an authored view cannot pull in host capabilities outside the accepted set.

## References

- `gik-maintainer` `TODO.md` - Durable Purpose Participants in GIK (section 20, reference organisms).
- `generative-interaction-kernel` ADR-0049 - Stable event contracts and effect settlements.
- `generative-interaction-kernel` ADR-0050 - Host-owned invocation authorization and governed participant requests.
- `generative-interaction-kernel` issue #54 - deferred revocation epoch on authorization snapshots.
