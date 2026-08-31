import assert from "node:assert/strict";
import { test } from "vitest";

import { getSampleBlueprintCatalog } from "../bootstrap/catalog/blueprint-catalog";
import {
  openHeadlessBlueprint,
  openHeadlessDurableBlueprint,
  type HeadlessDurableBlueprintSession,
} from "./blueprint-harness";

interface PurposeParticipantSnapshot {
  purpose: { revision: string };
  cadences: {
    operational: { generation: number };
    progress: { generation: number };
    strategy: { generation: number };
  };
  strategy: { revision: number };
  plan: {
    revision: number;
    actions: Array<{ id: string }>;
  };
  pendingRequests: {
    riskConstraint: {
      status: string;
      riskTolerance?: string;
    };
    rebalanceDecision: { status: string };
    targetReturn: { status: string };
  };
  settledRequestIds: string[];
}

function purposeParticipant(session: HeadlessDurableBlueprintSession): PurposeParticipantSnapshot {
  const value = session.snapshot().purposeParticipant;
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as unknown as PurposeParticipantSnapshot;
}

test("headless harness opens every catalog Blueprint with authored defaults", () => {
  for (const id of getSampleBlueprintCatalog().blueprints) {
    const session = openHeadlessBlueprint(id);
    assert.equal(session.runtime.blueprintId, id);
    assert.deepEqual(session.snapshot(), session.runtime.state);
  }
});

test("headless harness selects the Incident Analysis semantic model by default", () => {
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
  assert.equal(participant.plan.revision, 2);
  assert.deepEqual(participant.plan.actions.map(({ id }) => id), ["await-settled-valuation"]);
  assert.equal(participant.purpose.revision, "portfolio-purpose/v1");
});

test("portfolio clarification emits an explicit request and ignores stale or duplicate responses", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const node = "portfolio-purpose-requests";
  const requested = await session.transition([{
    node,
    name: "request-risk-clarification",
    payload: { revision: 2 },
  }]);

  assert.equal(requested.effects.length, 1);
  assert.equal(requested.effects[0]?.kind, "request");
  if (requested.effects[0]?.kind !== "request") assert.fail("Expected a request effect.");
  assert.equal(requested.effects[0].control.kind, "clarification");
  assert.equal(requested.effects[0].data.requestType, "portfolio-risk-constraint");

  await session.transition([{
    node,
    name: "risk-clarification-resolved",
    payload: {
      requestRevision: 1,
      settlementId: "settlement-stale",
      riskTolerance: "moderate",
    },
  }]);
  let participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint.status, "pending");
  assert.deepEqual(participant.settledRequestIds, []);

  const resolution = {
    node,
    name: "risk-clarification-resolved",
    payload: {
      requestRevision: 2,
      settlementId: "settlement-current",
      riskTolerance: "moderate",
    },
  };
  await session.transition([resolution, resolution]);
  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint.status, "resolved");
  assert.equal(participant.pendingRequests.riskConstraint.riskTolerance, "moderate");
  assert.deepEqual(participant.settledRequestIds, ["settlement-current"]);

  const followUp = await session.transition([{
    node,
    name: "request-risk-clarification",
    payload: { revision: 3 },
  }]);
  assert.equal(followUp.effects[0]?.kind, "request");
  await session.transition([{
    node,
    name: "risk-clarification-resolved",
    payload: {
      requestRevision: 3,
      settlementId: "settlement-follow-up",
      riskTolerance: "moderate with a five-year horizon",
    },
  }]);
  participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.riskConstraint.riskTolerance, "moderate with a five-year horizon");
  assert.deepEqual(participant.settledRequestIds, ["settlement-current", "settlement-follow-up"]);
});

test("portfolio participant uses native decision and data request effects", async () => {
  const session = openHeadlessDurableBlueprint("portfolio-tracker-new");
  const node = "portfolio-purpose-requests";

  const decision = await session.transition([{
    node,
    name: "request-rebalance-decision",
    payload: { revision: 1 },
  }]);
  assert.equal(decision.effects[0]?.kind, "request");
  if (decision.effects[0]?.kind !== "request") assert.fail("Expected a decision request.");
  assert.equal(decision.effects[0].control.kind, "decision");
  assert.equal(decision.effects[0].data.requestType, "portfolio-rebalance-proposal");

  const data = await session.transition([{
    node,
    name: "request-target-return-data",
    payload: { revision: 1 },
  }]);
  assert.equal(data.effects[0]?.kind, "request");
  if (data.effects[0]?.kind !== "request") assert.fail("Expected a data request.");
  assert.equal(data.effects[0].control.kind, "data");
  assert.equal(data.effects[0].data.requestType, "portfolio-target-return");

  const participant = purposeParticipant(session);
  assert.equal(participant.pendingRequests.rebalanceDecision.status, "pending");
  assert.equal(participant.pendingRequests.targetReturn.status, "pending");
});
