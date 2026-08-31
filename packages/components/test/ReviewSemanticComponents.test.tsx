import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  assessmentDefinition,
  changeProposalDefinition,
  consistencyCaseDefinition,
  findingSetDefinition,
  describeSemanticComponent,
  getSemanticComponentAgentKit,
  listSemanticComponents,
  semanticComponentCapabilities,
  semanticComponentDefinitions,
  semanticComponentViews,
} from "../src/semantic";

const definitions = {
  "finding-set": findingSetDefinition,
  "consistency-case": consistencyCaseDefinition,
  assessment: assessmentDefinition,
  "change-proposal": changeProposalDefinition,
} as const;

test("finding, consistency, assessment, and change-proposal definitions validate and render every declared variant", () => {
  for (const [name, definition] of Object.entries(definitions)) {
    for (const variant of definition.variants.map((entry) => entry.value)) {
      const trial = definition.materializeTrial();
      trial.props.variant = variant;
      assert.equal(definition.validate(trial.props).ok, true, `${name}:${variant}`);
      const markup = renderToStaticMarkup(<definition.component node={trial} emit={() => {}} children={undefined} />);
      assert.ok(markup.length > 0, `${name}:${variant}`);
    }
  }
});

test("new semantic components are registered with capabilities and views", () => {
  for (const name of Object.keys(definitions)) {
    assert.equal(semanticComponentViews[name], semanticComponentDefinitions[name as keyof typeof semanticComponentDefinitions].component);
    assert.ok(semanticComponentCapabilities[name].propsSchema);
    assert.equal(
      (semanticComponentCapabilities[name].propsSchema as { additionalProperties?: boolean }).additionalProperties,
      false,
    );
  }
  const catalog = listSemanticComponents().map((entry) => entry.capability);
  assert.ok(catalog.includes("semantic:finding-set"));
  assert.ok(catalog.includes("semantic:consistency-case"));
  assert.ok(catalog.includes("semantic:assessment"));
  assert.ok(catalog.includes("semantic:change-proposal"));
});

test("agent-facing tools describe and scope the new capabilities", () => {
  const description = describeSemanticComponent("semantic:assessment");
  assert.equal(description.capability, "semantic:assessment");
  assert.equal(description.propsSchema.additionalProperties, false);
  assert.ok(description.authoring.rules.length > 0);

  const kit = getSemanticComponentAgentKit([
    "finding-set",
    "consistency-case",
    "assessment",
    "change-proposal",
  ]);
  assert.deepEqual([...kit.capabilities].sort(), [
    "semantic:assessment",
    "semantic:change-proposal",
    "semantic:consistency-case",
    "semantic:finding-set",
  ]);
});

test("finding-set rejects duplicate finding identifiers and unknown properties", () => {
  const trial = findingSetDefinition.materializeTrial();
  const duplicate = { ...trial.props, findings: [trial.props.findings[0], trial.props.findings[0]] };
  assert.equal(findingSetDefinition.validate(duplicate).ok, false);
  assert.equal(findingSetDefinition.validate({ ...trial.props, extra: true }).ok, false);
});

test("consistency-case represents contradictory outcomes with subjects and evidence", () => {
  const trial = consistencyCaseDefinition.materializeTrial();
  assert.equal((trial.props.case as Record<string, unknown>).verdict, "contradictory");
  assert.ok(Array.isArray(trial.props.subjects));
  assert.ok(Array.isArray(trial.props.evidence));
  assert.equal(consistencyCaseDefinition.validate({ ...trial.props, case: {} }).ok, false);
});

test("assessment reports overall status derived from contributing checks", () => {
  const trial = assessmentDefinition.materializeTrial();
  assert.equal((trial.props.assessment as Record<string, unknown>).state, "not-ready");
  assert.ok(Array.isArray(trial.props.checks));
  assert.equal((trial.props.checks as Array<Record<string, unknown>>).length, 3);
});

test("change-proposal exposes approve, reject, and requestChanges review intents", () => {
  assert.deepEqual([...changeProposalDefinition.events].sort(), ["approve", "reject", "requestChanges"].sort());
  const trial = changeProposalDefinition.materializeTrial();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  renderToStaticMarkup(
    <changeProposalDefinition.component
      node={trial}
      emit={(event: string, payload: unknown) => {
        emitted.push({ event, payload });
        return Promise.resolve();
      }}
      children={undefined}
    />,
  );
  // Static markup cannot trigger click handlers, but the declared contract must exist for the Blueprint to bind to.
  assert.ok(changeProposalDefinition.eventContracts.approve);
  assert.ok(changeProposalDefinition.eventContracts.reject);
  assert.ok(changeProposalDefinition.eventContracts.requestChanges);
  assert.equal(changeProposalDefinition.eventContracts.approve.payloadSchema.additionalProperties, false);
});
