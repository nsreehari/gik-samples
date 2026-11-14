# ADR-0001: Purpose-bearing portfolio Cells and constrained agent authoring

**Status:** Proposed - 2026-09-01; updated 2026-11-12 for the released DPP contract.
Acceptance is subject to maintainer review of this ADR.

## Context

The portfolio sample demonstrates durable purpose participants (DPPs) within
ordinary Blueprints. It must distinguish the released purpose-bearing Cell
contract from application-owned purpose, plan, outcome, and human-review state.
The Foundry adapter also supports request-scoped authoring of presentation
Blueprints. That mode needs bounded composition and validation, rather than
treating model output as execution authority.

## Decision

### Purpose-bearing Cells use the native DPP contract

The existing `portfolio-intelligence` Cell declares `dpp.manifest` and
`dpp.context.sources`; there is no separate `kind: dpp`, scheduler, or mandatory
AI provider. It adopts the released
[core DPP contract](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/dpp.md),
including its manifest, context operations, `fetched_sources` expression root,
and lifecycle semantics; this ADR does not redefine that contract.

The sample binds the portfolio context store to instance-owned durable storage.
Its [portfolio cases](../../src/bootstrap/blueprints/portfolio-tracker-new/TEST_CASES.md#durable-purpose-and-context)
own the detailed retrieval, immutable-launch correlation, saved-report envelope,
retry, and withdrawal guarantees. The backend's first-write behavior is not
transactional across concurrent writers. We select this bounded evidence model
rather than conflating retrieved context, execution journals, and review state.

### Portfolio review state remains application-owned

The Blueprint's separate `purposeParticipant` state records the sample's
purpose, strategy, plan, pending human requests, and outcomes. It is not the
native DPP manifest or a required kernel workflow.

Human-request settlement handlers read correlation metadata from
`$event.requestContext` and response data from top-level event fields. Guards
check request type, pending-request existence/status, matching revision, and
plan revision where applicable. Request-emitting handlers supply dynamic data
through explicit `args.from` expressions. These application guards complement,
but do not replace, host authorization.

### Response workspaces constrain the requests that select them

When a Foundry request supplies `authoringWorkspace`, its response authoring is
confined to a request-scoped workspace:

- The request's host/Blueprint-authored scaffold supplies the enclosing
  document; the agent supplies exactly the declared fragment fields.
- JSON-Pointer slots must address existing scaffold paths. Traversal rejects
  `__proto__`, `prototype`, and `constructor` segments.
- When `capabilityDerivation` is configured, composition rejects capabilities
  outside its accepted set and derives tiers/imports into configured scaffold
  pointers. This is not an unconditional guarantee for every workspace.
- The composed candidate must pass authoring validation and host
  materialization before it can become the stored response proposal.
- The adapter opens the workspace by request ID and closes it in `finally`.
  A workspace-mode request must set a validated proposal before completion.

This decision does not remove other adapter modes: requests without
`authoringWorkspace` may still return structured JSON or parsed JSON replies.
Do not claim that every agent-authored response uses bounded slots.

### Hosts retain execution authority

Manifest boundaries and valid proposals do not authorize execution. Hosts own
endpoint approval, secret resolution, invocation authority, and proposal
application. The browser host applies trusted endpoint checks, and Blueprint
authoring/use lifecycles have their own actor authorization and admission
policies. This ADR does not characterize all samples as allow-by-default or
claim that materialization establishes permission to execute a candidate.

## Consequences

- The portfolio remains an inspectable Blueprint, with stable semantic Cells
  and independently selected service/projection implementations.
- Current facts, selected historical evidence, and human-review state have
  distinct roles. Purpose-bearing intelligence does not grant trading authority.
- Withdrawing intelligence leaves independent holdings, price retrieval, and
  valuation responsibilities intact. External context retention and already
  performed effects remain host/backend responsibilities.
- Bounded response composition applies only to its declared mode and configured
  controls. Host authorization remains necessary after candidate validation.

## Alternatives considered

- **A special DPP Cell kind or scheduler:** rejected; purpose and context
  declarations extend the existing Cell and effect/settlement mechanisms.
- **Bespoke imperative portfolio orchestration:** rejected; the sample should
  exercise Blueprint composition, state, events, and effects.
- **Unrestricted complete-Blueprint output in workspace mode:** rejected for
  that mode; bounded fragments preserve the configured scaffold. Other adapter
  response modes remain supported and are outside this bounded-mode guarantee.
- **Accept every capability in a derived view:** rejected when capability
  derivation is configured; its explicit accepted set is the boundary.

## References

- [Core purpose-bearing Cell contract](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/dpp.md).
- [Core ADR-0049: Stable event contracts and effect settlements](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/decisions/ADR-0049-stable-event-contracts-and-effect-settlements.md).
- [Core ADR-0050: Host-owned invocation authorization](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/decisions/ADR-0050-host-owned-invocation-authorization.md).
- [Portfolio Blueprint](../../src/bootstrap/blueprints/portfolio-tracker-new/blueprint.json)
  and [behavioral cases](../../src/bootstrap/blueprints/portfolio-tracker-new/TEST_CASES.md).
- [Context backend](../../src/service-kinds/context-store/runtime.ts)
  and [host storage binding](../../src/shared/blueprint-storage.ts).
- [Response workspace composition](../../src/service-kinds/agent-response-workspace.ts)
  and [Foundry provider](../../packages/service-providers/src/foundry.ts).
- [Browser service host](../../src/browser-host/src/runtime/service-host.ts)
  and [Blueprint lifecycle policies](../../src/browser-host/src/runtime/blueprint-agent-lifecycle.ts).
