import type { BlueprintArtifact, ExternalContext } from "@gik/blueprint";
import { deriveCellEventOwners } from "@gik/blueprint";
import { evalAsyncJsonata } from "@gik/evaluators";
import { validateJsonValue, type GIKEvent, type Json } from "@gik/kernel";

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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Scenario '${field}' must be a non-empty string.`);
  }
  return value;
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
  if (!isRecord(value)) throw new Error(`Scenario '${field}' must be a GIK event object.`);
  const payload = value.payload;
  if (payload !== undefined && !isRecord(payload)) {
    throw new Error(`Scenario '${field}.payload' must be an object.`);
  }
  if (value.actorId !== undefined && typeof value.actorId !== "string") {
    throw new Error(`Scenario '${field}.actorId' must be a string.`);
  }
  return {
    node: requiredString(value.node, `${field}.node`),
    name: requiredString(value.name, `${field}.name`),
    ...(payload === undefined
      ? {}
      : { payload: structuredClone(payload) as Record<string, Json> }),
    ...(value.actorId === undefined
      ? {}
      : { actorId: requiredString(value.actorId, `${field}.actorId`) }),
  };
}

function parseAct(value: unknown, field: string): ScenarioAct {
  if (!isRecord(value)) throw new Error(`Scenario '${field}' must be an object.`);
  const hasEvent = Object.prototype.hasOwnProperty.call(value, "event");
  const hasWait = Object.prototype.hasOwnProperty.call(value, "wait");
  const hasObservation = Object.prototype.hasOwnProperty.call(value, "observe");
  if (Number(hasEvent) + Number(hasWait) + Number(hasObservation) !== 1) {
    throw new Error(`Scenario '${field}' must contain exactly one event, wait, or observation.`);
  }
  const base = {
    id: requiredString(value.id, `${field}.id`),
    title: requiredString(value.title, `${field}.title`),
    ...optionalDescription(value.description, `${field}.description`),
  };
  if (hasEvent) return { ...base, event: parseEvent(value.event, `${field}.event`) };
  if (hasWait) {
    if (!isRecord(value.wait)) {
      throw new Error(`Scenario '${field}.wait' must contain a condition.`);
    }
    return {
      ...base,
      wait: {
        when: requiredString(value.wait.when, `${field}.wait.when`),
      },
    };
  }
  if (!isRecord(value.observe) || !isRecord(value.observe.select)) {
    throw new Error(`Scenario '${field}.observe' must contain a non-empty select map.`);
  }
  const select = Object.fromEntries(
    Object.entries(value.observe.select).map(([name, expression]) => [
      requiredString(name, `${field}.observe.select.name`),
      requiredString(expression, `${field}.observe.select.${name}`),
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
  if (!isRecord(value) || !Array.isArray(value.acts) || value.acts.length === 0) {
    throw new Error(`Scenario '${field}' must contain a non-empty acts array.`);
  }
  const acts = value.acts.map((act, index) => parseAct(act, `${field}.acts.${index}`));
  if (new Set(acts.map(({ id }) => id)).size !== acts.length) {
    throw new Error(`Scenario '${field}' contains duplicate act IDs.`);
  }
  return {
    id: requiredString(value.id, `${field}.id`),
    title: requiredString(value.title, `${field}.title`),
    ...optionalDescription(value.description, `${field}.description`),
    acts,
  };
}

export function parseScenarioDocument(value: unknown): ScenarioDocument {
  if (!isRecord(value) || value.format !== "gik-scenarios/1") {
    throw new Error("Unsupported scenario document format.");
  }
  const blueprint = requiredString(value.blueprint, "blueprint");
  if (!isRecord(value.contextPresets)) {
    throw new Error(`Scenario document for '${blueprint}' contextPresets must be an object.`);
  }
  const contextPresets = Object.fromEntries(
    Object.entries(value.contextPresets).map(([id, preset]) => {
      if (!isRecord(preset) || !isRecord(preset.context)) {
        throw new Error(`Scenario context preset '${id}' is invalid.`);
      }
      return [
        requiredString(id, "contextPresets.id"),
        {
          label: requiredString(preset.label, `contextPresets.${id}.label`),
          context: structuredClone(preset.context) as ExternalContext,
        },
      ];
    }),
  );
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    throw new Error(`Scenario document for '${blueprint}' must define scenarios.`);
  }
  const scenarios = value.scenarios.map((candidate, index): ScenarioDefinition => {
    if (!isRecord(candidate) || !Array.isArray(candidate.steps) || candidate.steps.length === 0) {
      throw new Error(`Scenario definition ${index} for '${blueprint}' is invalid.`);
    }
    const id = requiredString(candidate.id, `scenarios.${index}.id`);
    const steps = candidate.steps.map((step, stepIndex) =>
      parseStep(step, `scenarios.${id}.steps.${stepIndex}`));
    if (new Set(steps.map((step) => step.id)).size !== steps.length) {
      throw new Error(`Scenario '${id}' contains duplicate step IDs.`);
    }
    const applicableContexts = candidate.applicableContexts === undefined
      ? undefined
      : stringArray(candidate.applicableContexts, `scenarios.${id}.applicableContexts`);
    const contextPreset = candidate.contextPreset === undefined
      ? undefined
      : requiredString(candidate.contextPreset, `scenarios.${id}.contextPreset`);
    return {
      id,
      title: requiredString(candidate.title, `scenarios.${id}.title`),
      ...optionalDescription(candidate.description, `scenarios.${id}.description`),
      ...(contextPreset === undefined ? {} : { contextPreset }),
      ...(applicableContexts === undefined ? {} : { applicableContexts }),
      ...(candidate.resetAtStart === undefined
        ? {}
        : {
            resetAtStart: typeof candidate.resetAtStart === "boolean"
              ? candidate.resetAtStart
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
