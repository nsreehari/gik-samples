import type { BlueprintArtifact, ExternalContext } from "@gik-ai/blueprint";
import { deriveCellEventOwners } from "@gik-ai/blueprint";
import { evalAsyncJsonata, validateJsonataExpression } from "@gik-ai/evaluators";
import { validateJsonValue, type GIKEvent, type Json } from "@gik-ai/kernel";

import { isRecord } from "../shared/json-path";

export interface ScenarioContextPreset {
  label: string;
  context: ExternalContext;
}

interface ScenarioActBase {
  id: string;
  title: string;
  description?: string;
}

export interface ScenarioEventAct extends ScenarioActBase {
  event: GIKEvent;
}

export interface ScenarioWaitAct extends ScenarioActBase {
  wait: {
    when: string;
  };
}

export interface ScenarioObservationAct extends ScenarioActBase {
  observe: {
    select: Record<string, string>;
  };
}

export type ScenarioAct = ScenarioEventAct | ScenarioWaitAct | ScenarioObservationAct;

export interface ScenarioExpressionScope {
  state: Record<string, Json>;
  context: ExternalContext;
}

export interface ScenarioStep {
  id: string;
  title: string;
  description?: string;
  acts: ScenarioAct[];
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  description?: string;
  contextPreset?: string;
  applicableContexts?: string[];
  resetAtStart?: boolean;
  steps: ScenarioStep[];
}

export interface ScenarioDocument {
  format: "gik-scenarios/1";
  blueprint: string;
  contextPresets: Record<string, ScenarioContextPreset>;
  scenarios: ScenarioDefinition[];
}

export type FlatScenarioAct = ScenarioAct & {
  stepId: string;
  stepTitle: string;
  stepIndex: number;
  actIndex: number;
  globalIndex: number;
  isStepStart: boolean;
  isStepEnd: boolean;
};

function strictRecord(
  value: unknown,
  field: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Scenario '${field}' must be an object.`);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Scenario '${field}' contains unknown field(s): ${unknownKeys.join(", ")}.`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Scenario '${field}' must be a non-empty string.`);
  }
  return value;
}

function expressionString(value: unknown, field: string): string {
  const expression = requiredString(value, field);
  const validation = validateJsonataExpression(expression, { mode: "full" });
  if (!validation.ok) {
    throw new Error(
      `Scenario '${field}' must be a valid JSONata expression: ${validation.error ?? "invalid expression"}.`,
    );
  }
  return expression;
}

function assertJsonValue(value: unknown, field: string, ancestors = new Set<object>()): asserts value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(`Scenario '${field}' must contain JSON values.`);
  }
  if (typeof value !== "object") {
    throw new Error(`Scenario '${field}' must contain JSON values.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Scenario '${field}' must not contain circular values.`);
  }
  const nestedAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${field}.${index}`, nestedAncestors));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assertJsonValue(child, `${field}.${key}`, nestedAncestors);
  }
}

function jsonRecord(value: unknown, field: string): Record<string, Json> {
  if (!isRecord(value)) throw new Error(`Scenario '${field}' must be an object.`);
  assertJsonValue(value, field);
  return structuredClone(value) as Record<string, Json>;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Scenario '${field}' must be a non-empty string array.`);
  }
  const values = value.map((item, index) => requiredString(item, `${field}.${index}`));
  if (new Set(values).size !== values.length) {
    throw new Error(`Scenario '${field}' must not contain duplicates.`);
  }
  return values;
}

function optionalDescription(value: unknown, field: string): { description?: string } {
  return value === undefined ? {} : { description: requiredString(value, field) };
}

function parseEvent(value: unknown, field: string): GIKEvent {
  const event = strictRecord(value, field, ["node", "name", "payload", "actorId"]);
  const payload = event.payload;
  if (event.actorId !== undefined && typeof event.actorId !== "string") {
    throw new Error(`Scenario '${field}.actorId' must be a string.`);
  }
  return {
    node: requiredString(event.node, `${field}.node`),
    name: requiredString(event.name, `${field}.name`),
    ...(payload === undefined
      ? {}
      : { payload: jsonRecord(payload, `${field}.payload`) }),
    ...(event.actorId === undefined
      ? {}
      : { actorId: requiredString(event.actorId, `${field}.actorId`) }),
  };
}

function parseAct(value: unknown, field: string): ScenarioAct {
  const act = strictRecord(value, field, [
    "id",
    "title",
    "description",
    "event",
    "wait",
    "observe",
  ]);
  const hasEvent = Object.prototype.hasOwnProperty.call(act, "event");
  const hasWait = Object.prototype.hasOwnProperty.call(act, "wait");
  const hasObservation = Object.prototype.hasOwnProperty.call(act, "observe");
  if (Number(hasEvent) + Number(hasWait) + Number(hasObservation) !== 1) {
    throw new Error(`Scenario '${field}' must contain exactly one event, wait, or observation.`);
  }
  const base = {
    id: requiredString(act.id, `${field}.id`),
    title: requiredString(act.title, `${field}.title`),
    ...optionalDescription(act.description, `${field}.description`),
  };
  if (hasEvent) return { ...base, event: parseEvent(act.event, `${field}.event`) };
  if (hasWait) {
    const wait = strictRecord(act.wait, `${field}.wait`, ["when"]);
    return {
      ...base,
      wait: {
        when: expressionString(wait.when, `${field}.wait.when`),
      },
    };
  }
  const observe = strictRecord(act.observe, `${field}.observe`, ["select"]);
  if (!isRecord(observe.select)) {
    throw new Error(`Scenario '${field}.observe' must contain a non-empty select map.`);
  }
  const select = Object.fromEntries(
    Object.entries(observe.select).map(([name, expression]) => [
      requiredString(name, `${field}.observe.select.name`),
      expressionString(expression, `${field}.observe.select.${name}`),
    ]),
  );
  if (Object.keys(select).length === 0) {
    throw new Error(`Scenario '${field}.observe.select' must not be empty.`);
  }
  return {
    ...base,
    observe: { select },
  };
}

function parseStep(value: unknown, field: string): ScenarioStep {
  const step = strictRecord(value, field, ["id", "title", "description", "acts"]);
  if (!Array.isArray(step.acts) || step.acts.length === 0) {
    throw new Error(`Scenario '${field}' must contain a non-empty acts array.`);
  }
  const acts = step.acts.map((act, index) => parseAct(act, `${field}.acts.${index}`));
  if (new Set(acts.map(({ id }) => id)).size !== acts.length) {
    throw new Error(`Scenario '${field}' contains duplicate act IDs.`);
  }
  return {
    id: requiredString(step.id, `${field}.id`),
    title: requiredString(step.title, `${field}.title`),
    ...optionalDescription(step.description, `${field}.description`),
    acts,
  };
}

export function parseScenarioDocument(value: unknown): ScenarioDocument {
  if (!isRecord(value) || value.format !== "gik-scenarios/1") {
    throw new Error("Unsupported scenario document format.");
  }
  const document = strictRecord(value, "document", [
    "format",
    "blueprint",
    "contextPresets",
    "scenarios",
  ]);
  const blueprint = requiredString(document.blueprint, "blueprint");
  if (!isRecord(document.contextPresets)) {
    throw new Error(`Scenario document for '${blueprint}' contextPresets must be an object.`);
  }
  const contextPresets = Object.fromEntries(
    Object.entries(document.contextPresets).map(([id, preset]) => {
      const parsedPreset = strictRecord(preset, `contextPresets.${id}`, ["label", "context"]);
      return [
        requiredString(id, "contextPresets.id"),
        {
          label: requiredString(parsedPreset.label, `contextPresets.${id}.label`),
          context: jsonRecord(parsedPreset.context, `contextPresets.${id}.context`) as ExternalContext,
        },
      ];
    }),
  );
  if (!Array.isArray(document.scenarios) || document.scenarios.length === 0) {
    throw new Error(`Scenario document for '${blueprint}' must define scenarios.`);
  }
  const scenarios = document.scenarios.map((candidate, index): ScenarioDefinition => {
    const definition = strictRecord(candidate, `scenarios.${index}`, [
      "id",
      "title",
      "description",
      "contextPreset",
      "applicableContexts",
      "resetAtStart",
      "steps",
    ]);
    if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
      throw new Error(`Scenario definition ${index} for '${blueprint}' is invalid.`);
    }
    const id = requiredString(definition.id, `scenarios.${index}.id`);
    const steps = definition.steps.map((step, stepIndex) =>
      parseStep(step, `scenarios.${id}.steps.${stepIndex}`));
    if (new Set(steps.map((step) => step.id)).size !== steps.length) {
      throw new Error(`Scenario '${id}' contains duplicate step IDs.`);
    }
    const actIds = steps.flatMap((step) => step.acts.map((act) => act.id));
    if (new Set(actIds).size !== actIds.length) {
      throw new Error(`Scenario '${id}' contains duplicate act IDs.`);
    }
    const applicableContexts = definition.applicableContexts === undefined
      ? undefined
      : stringArray(definition.applicableContexts, `scenarios.${id}.applicableContexts`);
    const contextPreset = definition.contextPreset === undefined
      ? undefined
      : requiredString(definition.contextPreset, `scenarios.${id}.contextPreset`);
    return {
      id,
      title: requiredString(definition.title, `scenarios.${id}.title`),
      ...optionalDescription(definition.description, `scenarios.${id}.description`),
      ...(contextPreset === undefined ? {} : { contextPreset }),
      ...(applicableContexts === undefined ? {} : { applicableContexts }),
      ...(definition.resetAtStart === undefined
        ? {}
        : {
            resetAtStart: typeof definition.resetAtStart === "boolean"
              ? definition.resetAtStart
              : (() => { throw new Error(`Scenario '${id}' resetAtStart must be boolean.`); })(),
          }),
      steps,
    };
  });
  if (new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) {
    throw new Error(`Scenario document for '${blueprint}' contains duplicate scenario IDs.`);
  }
  for (const scenario of scenarios) {
    for (const contextId of [
      ...(scenario.contextPreset ? [scenario.contextPreset] : []),
      ...(scenario.applicableContexts ?? []),
    ]) {
      if (!contextPresets[contextId]) {
        throw new Error(`Scenario '${scenario.id}' references unknown context preset '${contextId}'.`);
      }
    }
    if (scenario.contextPreset && scenario.applicableContexts
      && !scenario.applicableContexts.includes(scenario.contextPreset)) {
      throw new Error(
        `Scenario '${scenario.id}' contextPreset '${scenario.contextPreset}' must be applicable.`,
      );
    }
  }
  return {
    format: "gik-scenarios/1",
    blueprint,
    contextPresets,
    scenarios,
  };
}

export function flattenScenarioActs(scenario: ScenarioDefinition): FlatScenarioAct[] {
  let globalIndex = 0;
  return scenario.steps.flatMap((step, stepIndex) =>
    step.acts.map((act, actIndex) => ({
      ...act,
      stepId: step.id,
      stepTitle: step.title,
      stepIndex,
      actIndex,
      globalIndex: globalIndex++,
      isStepStart: actIndex === 0,
      isStepEnd: actIndex === step.acts.length - 1,
    })));
}

async function evaluateScenarioExpression(
  expression: string,
  scope: ScenarioExpressionScope,
): Promise<Json> {
  return await evalAsyncJsonata(expression, {}, {
    state: scope.state,
    context: scope.context,
  }) as Json;
}

export async function evaluateScenarioWait(
  act: ScenarioWaitAct,
  scope: ScenarioExpressionScope,
): Promise<boolean> {
  return await evaluateScenarioExpression(act.wait.when, scope) === true;
}

export async function collectScenarioObservation(
  act: ScenarioObservationAct,
  scope: ScenarioExpressionScope,
): Promise<Record<string, Json>> {
  const observations: Record<string, Json> = {};
  for (const [name, expression] of Object.entries(act.observe.select)) {
    observations[name] = await evaluateScenarioExpression(expression, scope);
  }
  return observations;
}

export function validateScenarioDocumentTarget(
  document: ScenarioDocument,
  blueprint: BlueprintArtifact,
): void {
  if (document.blueprint !== blueprint.payload.id) {
    throw new Error(
      `Scenarios for Blueprint '${document.blueprint}' cannot target '${blueprint.payload.id}'.`,
    );
  }
  const cells = blueprint.payload.cells ?? {};
  const owners = deriveCellEventOwners({
    cells,
    ...(blueprint.payload.presentation ? { presentation: blueprint.payload.presentation } : {}),
  });
  for (const scenario of document.scenarios) {
    for (const act of flattenScenarioActs(scenario)) {
      if (!("event" in act)) continue;
      const ownerId = owners[act.event.node];
      if (!ownerId) {
        throw new Error(
          `Scenario act '${act.id}' targets unknown or non-dispatchable event node '${act.event.node}' in Blueprint '${document.blueprint}'.`,
        );
      }
      const cell = cells[ownerId];
      if (!cell) throw new Error(`Blueprint '${document.blueprint}' has no event owner '${ownerId}'.`);
      const contract = cell.events?.[act.event.name];
      if (!contract) {
        throw new Error(
          `Scenario act '${act.id}' targets unknown event '${act.event.name}' on cell '${ownerId}'.`,
        );
      }
      validateJsonValue(
        contract.payloadSchema,
        act.event.payload ?? {},
        `Invalid payload for scenario act '${act.id}' event '${ownerId}.${act.event.name}'`,
      );
    }
  }
}
