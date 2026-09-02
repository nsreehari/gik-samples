import assert from "node:assert/strict";
import { test } from "vitest";
import { createBlueprintDurableBootstrapEvent } from "gik-blueprint";
import { SyncJsonataExpressionProvider, type Json } from "gik-kernel";

import { getSampleBlueprintCatalog } from "../bootstrap/catalog/blueprint-catalog";
import {
  createRequestSettlementEvent,
  createSourceSettlementEvent,
  openHeadlessBlueprint,
  openHeadlessDurableBlueprint,
  type HeadlessDurableBlueprintSession,
} from "./blueprint-harness";

interface PendingRequest {
  status: string;
  revision: number;
  riskTolerance?: string;
  approved?: boolean;
  annualTargetPercent?: number;
  purposeConfirmed?: boolean;
}

interface PurposeParticipantSnapshot {
  purpose: {
    revision: string;
    statement: string;
    successMeasures: string[];
    constraints: string[];
  };
  cadences: {
    operational: { generation: number; lastAt: string | null };
    progress: { generation: number; lastAt: string | null };
    strategy: { generation: number; lastAt: string | null };
    purposeReview: { generation: number; lastAt: string | null };
  };
  strategy: { revision: number };
  plan: {
    revision: number;
    actions: Array<{ id: string; status: string; correlationId: string }>;
  };
  investigation: {
    revision: number;
    riskFlags: string[];
    concentrationTicker: string | null;
    concentrationWeightPercent: number;
    unrealizedLossPercent: number;
    lastAssessedAt: string | null;
  };
  pendingRequests: {
    riskConstraint: PendingRequest | null;
    rebalanceDecision: PendingRequest | null;
    targetReturn: PendingRequest | null;
    purposeReview: PendingRequest | null;
  };
  purposeReview: {
    status: string;
    lastReviewedAt: string | null;
    lastConfirmed: boolean | null;
    notes: string | null;
  };
  settledRequestIds: string[];
}

function purposeParticipant(session: HeadlessDurableBlueprintSession): PurposeParticipantSnapshot {
  const value = session.snapshot().purposeParticipant;
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as unknown as PurposeParticipantSnapshot;
}

/** Advances holdings valuation to a real settled portfolio value by settling the
 * market-prices source effect the same way the real market-data host would,
 * so `portfolio.value.summary.marketValue > 0` and outcome reconciliation can
 * be exercised against an authored plan action instead of the placeholder. */
async function settlePortfolioValuation(session: HeadlessDurableBlueprintSession) {
  const synced = await session.transition([createBlueprintDurableBootstrapEvent()]);
  const sourceEffect = synced.effects.find((e) => e.kind === "invoke" && e.control.sourceRequestToken);
  assert.ok(sourceEffect, "expected the market-prices source invoke effect");
  await session.transition([
    createSourceSettlementEvent(sourceEffect!, {
      quotes: { AAPL: { price: 150 }, MSFT: { price: 200 } },
      provider: "mock",
    }),
  ]);
}

test("headless harness opens every catalog Blueprint with authored defaults", () => {
  for (const id of getSampleBlueprintCatalog().blueprints) {
    const session = openHeadlessBlueprint(id);
    assert.equal(session.runtime.blueprintId, id);
    assert.deepEqual(session.snapshot(), session.runtime.state);
  }
});

test("headless harness selects the Incident Analysis agent-generated presentation model by default", () => {
  const session = openHeadlessBlueprint("incident-analysis-new-shell");
  assert.equal(session.runtime.definition.payload.kind, "incident-analysis-shell");
  assert.ok("incident" in session.snapshot());
});

test("portfolio purpose participant advances independent heartbeat cadences", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");

  await session.transition([{
    node: "portfolio-purpose-observation",
    name: "operational-heartbeat",
    payload: { at: "2026-08-31T12:00:00.000Z" },
  }]);
  await session.transition([{
    node: "portfolio-purpose-assessment",
    name: "progress-heartbeat",
    payload: { at: "2026-08-31T13:00:00.000Z" },
  }]);
  await session.transition([{
    node: "portfolio-purpose-planning",
    name: "strategy-heartbeat",
    payload: { at: "2026-08-31T14:00:00.000Z" },
  }]);
  await session.transition([{
    node: "portfolio-purpose-planning",
    name: "strategy-heartbeat",
    payload: { at: "2026-08-31T15:00:00.000Z" },
  }]);

  const participant = purposeParticipant(session);
  assert.equal(participant.cadences.operational.generation, 1);
  assert.equal(participant.cadences.progress.generation, 1);
  assert.equal(participant.cadences.strategy.generation, 2);
  assert.equal(participant.strategy.revision, 2);
  assert.equal(participant.plan.revision, 1);
  assert.deepEqual(participant.plan.actions.map(({ id }) => id), ["await-settled-valuation"]);
  assert.equal(participant.purpose.revision, "portfolio-purpose/v1");
});

test("portfolio purpose participant ignores a byte-identical replayed heartbeat", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const heartbeat = {
    node: "portfolio-purpose-observation",
    name: "operational-heartbeat",
    payload: { at: "2026-08-31T12:00:00.000Z" },
  };

  await session.transition([heartbeat]);
  // Redelivering the exact same heartbeat event (e.g. an at-least-once durable
  // redelivery after a crash before the ack was recorded) must be a no-op: the
  // Cell-level guard compares $event.at against the recorded lastAt, which is
  // the only replay-detection available to a plain (non-request) event.
  await session.transition([heartbeat]);
  await session.transition([heartbeat, heartbeat]);

  const participant = purposeParticipant(session);
  assert.equal(participant.cadences.operational.generation, 1);
  assert.equal(participant.cadences.operational.lastAt, "2026-08-31T12:00:00.000Z");

  // A genuinely new heartbeat still advances normally afterward.
  await session.transition([{
    node: "portfolio-purpose-observation",
    name: "operational-heartbeat",
    payload: { at: "2026-08-31T13:00:00.000Z" },
  }]);
  assert.equal(purposeParticipant(session).cadences.operational.generation, 2);
});

test("portfolio clarification settles via a real Kernel settlement receipt and ignores stale or duplicate settlements", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const node = "portfolio-purpose-requests";

  const staleRequest = await session.transition([{
    node,
    name: "request-risk-clarification",
    payload: { revision: 1 },
  }]);
  const staleEffect = staleRequest.effects[0];
  assert.equal(staleEffect?.kind, "request");
  if (staleEffect?.kind !== "request") assert.fail("Expected a stale request effect.");

  const requested = await session.transition([{
    node,
    name: "request-risk-clarification",
    payload: { revision: 2 },
  }]);
  assert.equal(requested.effects.length, 1);
  const effect = requested.effects[0];
  assert.equal(effect?.kind, "request");
  if (effect?.kind !== "request") assert.fail("Expected a request effect.");
  assert.equal(effect.control.kind, "clarification");
  assert.equal(effect.data.requestType, "portfolio-risk-constraint");
  assert.ok(effect.effectId, "the Kernel must assign a real effectId to the request effect");

  // A stale settlement (revision doesn't match the currently pending revision)
  // must be ignored by the Cell's own guard, independent of the durable
  // adapter's messageId dedup.
  await session.transition([
    createRequestSettlementEvent(staleEffect, "resolved", { revision: 1 }, { riskTolerance: "moderate" }, {
      messageId: "settlement-stale",
    }),
  ]);
  let participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint?.status, "pending");
  assert.deepEqual(participant.settledRequestIds, []);

  // The real settlement for the current revision resolves the request and
  // records the Kernel-assigned effectId as the settlement receipt.
  const resolution = createRequestSettlementEvent(
    effect,
    "resolved",
    { revision: 2 },
    { riskTolerance: "moderate" },
    { messageId: "settlement-current" },
  );
  await session.transition([resolution]);
  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint?.status, "resolved");
  assert.equal(participant.pendingRequests.riskConstraint?.riskTolerance, "moderate");
  assert.deepEqual(participant.settledRequestIds, [effect.effectId]);

  // Redelivering the identical settlement (duplicate messageId) is deduped by
  // the durable adapter before it ever reaches the reducer.
  await session.transition([resolution]);
  participant = purposeParticipant(session);
  assert.deepEqual(participant.settledRequestIds, [effect.effectId]);

  // Even a settlement with a *different* messageId (bypassing adapter dedup)
  // is still a no-op, because the Cell-level guard requires the pending
  // request to still be 'pending' at the matching revision.
  await session.transition([
    createRequestSettlementEvent(effect, "resolved", { revision: 2 }, { riskTolerance: "aggressive" }, {
      messageId: "settlement-current-again",
    }),
  ]);
  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint?.riskTolerance, "moderate");
  assert.deepEqual(participant.settledRequestIds, [effect.effectId]);

  // A follow-up clarification request supersedes the old one; only its own
  // settlement (matching the new revision) can resolve it.
  const followUp = await session.transition([{
    node,
    name: "request-risk-clarification",
    payload: { revision: 3 },
  }]);
  const followUpEffect = followUp.effects[0];
  assert.equal(followUpEffect?.kind, "request");
  if (followUpEffect?.kind !== "request") assert.fail("Expected a follow-up request.");
  assert.ok(followUpEffect.effectId, "the Kernel must assign an effectId to the follow-up request too");
  // Note: effect.effectId is only unique *within* a single transition() call --
  // the Kernel assigns it from in-memory rev/seq counters on the materialized
  // instance for that call, and the durable adapter rematerializes a fresh
  // Kernel from persisted state on every call. A request issued in a separate
  // transition() may legitimately reuse the same effectId as an earlier one;
  // durable identity/dedup instead comes from revision guards (Cell-level) and
  // a host-generated messageId (adapter-level), never from effectId alone.

  // The follow-up request re-opens the pending slot (status back to 'pending',
  // no answer recorded yet). A stale settlement referencing the *original*
  // revision must still be ignored now that the pending request has moved on
  // to revision 3, so it must not seed the still-unresolved slot.
  let participantMidFlight = purposeParticipant(session);
  assert.equal(participantMidFlight.pendingRequests.riskConstraint?.status, "pending");
  assert.equal(participantMidFlight.pendingRequests.riskConstraint?.riskTolerance, undefined);
  await session.transition([
    createRequestSettlementEvent(effect, "resolved", { revision: 2 }, { riskTolerance: "should-not-apply" }),
  ]);
  participantMidFlight = purposeParticipant(session);
  assert.equal(participantMidFlight.pendingRequests.riskConstraint?.status, "pending");
  assert.equal(participantMidFlight.pendingRequests.riskConstraint?.riskTolerance, undefined);

  await session.transition([
    createRequestSettlementEvent(
      followUpEffect,
      "resolved",
      { revision: 3 },
      { riskTolerance: "moderate with a five-year horizon" },
      { messageId: "settlement-follow-up" },
    ),
  ]);
  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint?.riskTolerance, "moderate with a five-year horizon");
  assert.deepEqual(participant.settledRequestIds, [effect.effectId, followUpEffect.effectId]);
});

test("portfolio participant uses native decision and data request effects and settles both", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const node = "portfolio-purpose-requests";
  await settlePortfolioValuation(session);
  await session.transition([{
    node: "portfolio-purpose-planning",
    name: "strategy-heartbeat",
    payload: { at: "2026-08-31T14:00:00.000Z" },
  }]);

  const decision = await session.transition([{
    node,
    name: "request-rebalance-decision",
    payload: { revision: 1 },
  }]);
  const decisionEffect = decision.effects[0];
  assert.equal(decisionEffect?.kind, "request");
  if (decisionEffect?.kind !== "request") assert.fail("Expected a decision request.");
  assert.equal(decisionEffect.control.kind, "decision");
  assert.equal(decisionEffect.data.requestType, "portfolio-rebalance-proposal");

  const dataRequest = await session.transition([{
    node,
    name: "request-target-return-data",
    payload: { revision: 1 },
  }]);
  const dataEffect = dataRequest.effects[0];
  assert.equal(dataEffect?.kind, "request");
  if (dataEffect?.kind !== "request") assert.fail("Expected a data request.");
  assert.equal(dataEffect.control.kind, "data");
  assert.equal(dataEffect.data.requestType, "portfolio-target-return");

  let participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.rebalanceDecision?.status, "pending");
  assert.equal(participant.pendingRequests.targetReturn?.status, "pending");

  await session.transition([
    createRequestSettlementEvent(decisionEffect, "resolved", { revision: 1 }, { approved: false }),
  ]);
  await session.transition([
    createRequestSettlementEvent(dataEffect, "resolved", { revision: 1 }, { annualTargetPercent: 8 }),
  ]);

  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.rebalanceDecision?.status, "resolved");
  assert.equal(participant.pendingRequests.rebalanceDecision?.approved, false);
  assert.equal(participant.pendingRequests.targetReturn?.status, "resolved");
  assert.equal(participant.pendingRequests.targetReturn?.annualTargetPercent, 8);
});

test("portfolio request commands are monotonic and replay-safe", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const command = {
    node: "portfolio-purpose-requests",
    name: "request-risk-clarification",
    payload: { revision: 2 },
  };

  const first = await session.transition([command]);
  assert.equal(first.effects.filter((effect) => effect.kind === "request").length, 1);
  const replay = await session.transition([command]);
  assert.equal(replay.effects.filter((effect) => effect.kind === "request").length, 0);
  const stale = await session.transition([{
    ...command,
    payload: { revision: 1 },
  }]);
  assert.equal(stale.effects.filter((effect) => effect.kind === "request").length, 0);
  assert.equal(purposeParticipant(session).pendingRequests.riskConstraint?.revision, 2);

  const newer = await session.transition([{
    ...command,
    payload: { revision: 3 },
  }]);
  assert.equal(newer.effects.filter((effect) => effect.kind === "request").length, 1);
  assert.equal(purposeParticipant(session).pendingRequests.riskConstraint?.revision, 3);
});

test("portfolio requests respect rejected, cancelled, and failed Kernel outcomes", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const node = "portfolio-purpose-requests";

  const clarification = await session.transition([{
    node,
    name: "request-risk-clarification",
    payload: { revision: 1 },
  }]);
  const clarificationEffect = clarification.effects[0];
  assert.equal(clarificationEffect?.kind, "request");
  if (clarificationEffect?.kind !== "request") assert.fail("Expected a clarification request.");
  await session.transition([createRequestSettlementEvent(clarificationEffect, "rejected", { revision: 1 })]);
  assert.equal(purposeParticipant(session).pendingRequests.riskConstraint?.status, "rejected");

  await settlePortfolioValuation(session);
  await session.transition([{
    node: "portfolio-purpose-planning",
    name: "strategy-heartbeat",
    payload: { at: "2026-08-31T14:00:00.000Z" },
  }]);
  const decision = await session.transition([{
    node,
    name: "request-rebalance-decision",
    payload: { revision: 1 },
  }]);
  const decisionEffect = decision.effects[0];
  assert.equal(decisionEffect?.kind, "request");
  if (decisionEffect?.kind !== "request") assert.fail("Expected a decision request.");
  await session.transition([createRequestSettlementEvent(decisionEffect, "cancelled", { revision: 1 })]);
  assert.equal(purposeParticipant(session).pendingRequests.rebalanceDecision?.status, "cancelled");

  const dataRequest = await session.transition([{
    node,
    name: "request-target-return-data",
    payload: { revision: 1 },
  }]);
  const dataEffect = dataRequest.effects[0];
  assert.equal(dataEffect?.kind, "request");
  if (dataEffect?.kind !== "request") assert.fail("Expected a data request.");
  await session.transition([createRequestSettlementEvent(dataEffect, "failed", { revision: 1 })]);
  assert.equal(purposeParticipant(session).pendingRequests.targetReturn?.status, "failed");

  // None of these terminal-but-not-resolved outcomes ever touch settledRequestIds
  // differently than resolved ones -- they are still real settlement receipts.
  assert.equal(purposeParticipant(session).settledRequestIds.length, 3);
});

test("portfolio purpose-review cadence and decision remain advisory-only and never mutate purpose itself", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const originalPurpose = purposeParticipant(session).purpose;

  await session.transition([{
    node: "portfolio-purpose-requests",
    name: "purpose-review-heartbeat",
    payload: { at: "2027-01-01T00:00:00.000Z" },
  }]);
  assert.equal(purposeParticipant(session).cadences.purposeReview.generation, 1);
  // Replayed purpose-review heartbeat is idempotent like the other cadences.
  await session.transition([{
    node: "portfolio-purpose-requests",
    name: "purpose-review-heartbeat",
    payload: { at: "2027-01-01T00:00:00.000Z" },
  }]);
  assert.equal(purposeParticipant(session).cadences.purposeReview.generation, 1);

  const review = await session.transition([{
    node: "portfolio-purpose-requests",
    name: "request-purpose-review",
    payload: { revision: 1 },
  }]);
  const reviewEffect = review.effects[0];
  assert.equal(reviewEffect?.kind, "request");
  if (reviewEffect?.kind !== "request") assert.fail("Expected a purpose-review decision request.");
  assert.equal(reviewEffect.control.kind, "decision");
  assert.equal(reviewEffect.data.requestType, "portfolio-purpose-review");

  await session.transition([
    createRequestSettlementEvent(
      reviewEffect,
      "resolved",
      { revision: 1 },
      { purposeConfirmed: true, notes: "Owner confirmed the purpose still holds." },
    ),
  ]);

  const participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.purposeReview?.status, "resolved");
  assert.equal(participant.purposeReview.status, "confirmed");
  assert.equal(participant.purposeReview.lastConfirmed, true);
  assert.equal(participant.purposeReview.lastReviewedAt, "2027-01-01T00:00:00.000Z");
  assert.equal(participant.purposeReview.notes, "Owner confirmed the purpose still holds.");
  // The participant can never apply a purpose change itself: the purpose
  // statement/successMeasures/constraints are untouched by any review outcome.
  assert.deepEqual(participant.purpose, originalPurpose);

  // A flagged review is recorded distinctly, still without touching purpose.
  const secondReview = await session.transition([{
    node: "portfolio-purpose-requests",
    name: "request-purpose-review",
    payload: { revision: 2 },
  }]);
  const secondReviewEffect = secondReview.effects[0];
  assert.equal(secondReviewEffect?.kind, "request");
  if (secondReviewEffect?.kind !== "request") assert.fail("Expected a second purpose-review request.");
  await session.transition([
    createRequestSettlementEvent(
      secondReviewEffect,
      "resolved",
      { revision: 2 },
      { purposeConfirmed: false, notes: "Owner wants constraints re-examined." },
    ),
  ]);
  const reviewed = purposeParticipant(session);
  assert.equal(reviewed.purposeReview.status, "flagged");
  assert.equal(reviewed.purposeReview.lastConfirmed, false);
  assert.deepEqual(reviewed.purpose, originalPurpose);
});

test("portfolio bounded investigation compute and rebalance decision outcome reconciliation flip the plan action", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  await settlePortfolioValuation(session);

  await session.transition([{
    node: "portfolio-purpose-planning",
    name: "strategy-heartbeat",
    payload: { at: "2026-08-31T14:00:00.000Z" },
  }]);

  let participant = purposeParticipant(session);
  assert.deepEqual(participant.plan.actions.map(({ id, status }) => ({ id, status })), [
    { id: "review-portfolio-condition", status: "proposed" },
  ]);
  // Bounded typed investigation: deterministic JSONata compute over the
  // settled valuation, not an invented agentic/runtime service.
  assert.equal(participant.investigation.concentrationTicker, "MSFT");
  assert.equal(participant.investigation.concentrationWeightPercent, 66.7);
  assert.deepEqual(participant.investigation.riskFlags, ["concentration-risk"]);

  const decision = await session.transition([{
    node: "portfolio-purpose-requests",
    name: "request-rebalance-decision",
    payload: { revision: 1 },
  }]);
  const decisionEffect = decision.effects[0];
  assert.equal(decisionEffect?.kind, "request");
  if (decisionEffect?.kind !== "request") assert.fail("Expected a decision request.");

  await session.transition([
    createRequestSettlementEvent(decisionEffect, "resolved", { revision: 1 }, { approved: true }),
  ]);

  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.rebalanceDecision?.status, "resolved");
  assert.equal(participant.pendingRequests.rebalanceDecision?.approved, true);
  // Outcome reconciliation: the owner's decision is reconciled onto the plan
  // action it answered, without the participant ever placing a trade itself.
  assert.deepEqual(participant.plan.actions.map(({ id, status }) => ({ id, status })), [
    { id: "review-portfolio-condition", status: "accepted" },
  ]);

  const acceptedPlanRevision = participant.plan.revision;
  await session.transition([{
    node: "portfolio-purpose-planning",
    name: "strategy-heartbeat",
    payload: { at: "2026-08-31T15:00:00.000Z" },
  }]);
  participant = purposeParticipant(session);
  assert.equal(participant.plan.revision, acceptedPlanRevision);
  assert.deepEqual(participant.plan.actions.map(({ id, status }) => ({ id, status })), [
    { id: "review-portfolio-condition", status: "accepted" },
  ]);
});

test("rebalance requests cannot target a nonexistent plan action", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const requested = await session.transition([{
    node: "portfolio-purpose-requests",
    name: "request-rebalance-decision",
    payload: { revision: 1 },
  }]);
  assert.equal(requested.effects.filter((effect) => effect.kind === "request").length, 0);
  const participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.rebalanceDecision, null);
});

// The headless durable harness only exercises Blueprint *state* (Cells,
// requests, settlements) and never renders the projected presentation
// document, so it cannot see whether the new `portfolio-purpose-status`
// markdown view actually renders correctly. To still validate that binding
// for real (not just "the JSON parses"), this test reads the fully merged
// `potentialViews.primary` off the *materialized terminal Blueprint's*
// `portfolio-purpose-status` Cell (projection recipes are consumed/merged
// away by materialization, so this is the authoritative final capability +
// expression after `desktop-base`'s view override wins) and evaluates its
// `expression` with the same `SyncJsonataExpressionProvider` the platform's
// presentation compiler uses, against representative `purposeParticipant`
// state shapes.
test("portfolio purpose-status presentation view renders a markdown summary from live and empty participant state", () => {
  const session = openHeadlessBlueprint("portfolio-tracker-new");
  const payload = session.runtime.definition.payload as unknown as {
    cells: Record<string, { potentialViews?: { primary?: { capability: string; region: string; bindings: { value: { expression: string } } } } }>;
  };
  const cell = payload.cells["portfolio-purpose-status"];
  assert.ok(cell, "expected the portfolio-purpose-status Cell on the materialized terminal Blueprint");
  const view = cell.potentialViews?.primary;
  assert.ok(view, "expected a primary potentialView on portfolio-purpose-status");
  assert.equal(view!.capability, "primitive:markdown");
  assert.equal(view!.region, "purpose");
  const expression = view!.bindings.value.expression;

  const provider = new SyncJsonataExpressionProvider();

  const liveState: Record<string, Json> = {
    purposeParticipant: {
      purpose: { statement: "Grow retirement savings while limiting concentration risk" },
      assessment: { status: "on-track", marketValue: 1000, gainLoss: 50 },
      strategy: { posture: "balanced", rationale: "diversified across sectors" },
      plan: { actions: [{ id: "a1", description: "Rebalance MSFT", status: "proposed" }] },
      investigation: { riskFlags: ["concentration-risk"] },
      pendingRequests: {
        riskConstraint: { status: "pending", requestType: "clarification" },
        rebalanceDecision: null,
        targetReturn: null,
        purposeReview: null,
      },
      purposeReview: { status: "confirmed", lastReviewedAt: "2024-01-01T00:00:00Z" },
    },
  };
  const liveMarkdown = provider.eval(expression, liveState) as string;
  assert.match(liveMarkdown, /Grow retirement savings while limiting concentration risk/);
  assert.match(liveMarkdown, /on-track/);
  assert.match(liveMarkdown, /Rebalance MSFT.*proposed/);
  assert.match(liveMarkdown, /concentration-risk/);
  assert.match(liveMarkdown, /clarification/);
  assert.match(liveMarkdown, /confirmed/);

  // Freshly bootstrapped state (no plan actions, no risk flags, no pending
  // requests, no review yet) must render without throwing and fall back to
  // the authored empty-state copy instead of producing `null`/`undefined`.
  const emptyState: Record<string, Json> = {
    purposeParticipant: {
      purpose: { statement: "Grow retirement savings while limiting concentration risk" },
      assessment: { status: "pending", marketValue: 0, gainLoss: 0 },
      strategy: { posture: "unset", rationale: "not yet assessed" },
      plan: { actions: [] },
      investigation: { riskFlags: [] },
      pendingRequests: {
        riskConstraint: null,
        rebalanceDecision: null,
        targetReturn: null,
        purposeReview: null,
      },
      purposeReview: { status: "not-reviewed", lastReviewedAt: null },
    },
  };
  const emptyMarkdown = provider.eval(expression, emptyState) as string;
  assert.match(emptyMarkdown, /No plan actions yet/);
  assert.match(emptyMarkdown, /\*\*Risk flags:\*\* none/);
  assert.match(emptyMarkdown, /\*\*Awaiting owner input:\*\* none/);
  assert.match(emptyMarkdown, /not-reviewed/);
});

test("portfolio purpose participant survives a durable restart mid-request and rejects duplicate settlement after reload", async () => {
  let session = openHeadlessDurableBlueprint("portfolio-tracker-new");

  await session.transition([{
    node: "portfolio-purpose-observation",
    name: "operational-heartbeat",
    payload: { at: "2026-08-31T12:00:00.000Z" },
  }]);
  const requested = await session.transition([{
    node: "portfolio-purpose-requests",
    name: "request-risk-clarification",
    payload: { revision: 1 },
  }]);
  const effect = requested.effects[0];
  assert.equal(effect?.kind, "request");
  if (effect?.kind !== "request") assert.fail("Expected a clarification request.");

  // Simulate a process restart *before* the clarification response arrives:
  // a fresh in-memory materialization is seeded from the persisted state and
  // spec (as a real durable host would rehydrate from storage).
  session = session.restart();
  let participant = purposeParticipant(session);
  assert.equal(participant.cadences.operational.generation, 1);
  assert.equal(participant.pendingRequests.riskConstraint?.status, "pending");

  // The pending request settles normally after restart, against the same
  // effectId captured before the restart -- proving the effect identity and
  // the Cell's guard both survive rehydration.
  const settlement = createRequestSettlementEvent(effect, "resolved", { revision: 1 }, { riskTolerance: "moderate" }, {
    messageId: "settlement-post-restart",
  });
  await session.transition([settlement]);
  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint?.status, "resolved");
  assert.deepEqual(participant.settledRequestIds, [effect.effectId]);

  // Restart again *after* settlement, then redeliver the identical settlement
  // messageId: the persisted settledEffectMessageIds must still dedup it.
  session = session.restart();
  await session.transition([settlement]);
  participant = purposeParticipant(session);
  assert.deepEqual(participant.settledRequestIds, [effect.effectId]);

  // A replayed heartbeat after restart is still idempotent against the
  // persisted cadence lastAt.
  await session.transition([{
    node: "portfolio-purpose-observation",
    name: "operational-heartbeat",
    payload: { at: "2026-08-31T12:00:00.000Z" },
  }]);
  assert.equal(purposeParticipant(session).cadences.operational.generation, 1);
});
