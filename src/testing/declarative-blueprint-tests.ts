import {
  evaluateBlueprintCellId,
  materializeBlueprint,
  type BlueprintArtifact,
  type BlueprintReferenceResolver,
  type ExternalContext,
} from "@gik-ai/blueprint";
import type { Json } from "@gik-ai/kernel";

import { openHeadlessBlueprint } from "../headless/blueprint-harness";
import { isRecord, jsonValuesEqual, readJsonPath } from "../shared/json-path";

export interface BlueprintTestAssertion {
  path: string;
  exists?: boolean;
  equals?: Json;
}

export interface BlueprintTestCase {
  id: string;
  context?: ExternalContext;
  evaluation?: {
    cell: string;
    state: Record<string, Json>;
  };
  assertions: BlueprintTestAssertion[];
}

export interface BlueprintTestDocument {
  format: "gik-blueprint-tests/1";
  blueprint: string;
  cases: BlueprintTestCase[];
}

export interface BlueprintTestResult {
  blueprint: string;
  caseId: string;
  passed: boolean;
  errors: string[];
}

export function parseBlueprintTestDocument(value: unknown): BlueprintTestDocument {
  if (!isRecord(value)
    || value.format !== "gik-blueprint-tests/1"
    || typeof value.blueprint !== "string"
    || !value.blueprint
    || !Array.isArray(value.cases)
    || value.cases.length === 0) {
    throw new Error("Invalid declarative Blueprint test document.");
  }
  const cases = value.cases.map((candidate) => {
    if (!isRecord(candidate)
      || typeof candidate.id !== "string"
      || !candidate.id
      || (candidate.context !== undefined && !isRecord(candidate.context))
      || (candidate.evaluation !== undefined
        && (!isRecord(candidate.evaluation)
          || typeof candidate.evaluation.cell !== "string"
          || !candidate.evaluation.cell
          || !isRecord(candidate.evaluation.state)))
      || !Array.isArray(candidate.assertions)
      || candidate.assertions.length === 0) {
      throw new Error(`Invalid test case in Blueprint '${value.blueprint}'.`);
    }
    const assertions = candidate.assertions.map((assertion) => {
      if (!isRecord(assertion)
        || typeof assertion.path !== "string"
        || !assertion.path
        || (assertion.exists !== undefined && typeof assertion.exists !== "boolean")
        || (assertion.exists === undefined && !Object.prototype.hasOwnProperty.call(assertion, "equals"))) {
        throw new Error(`Invalid assertion in Blueprint test '${candidate.id}'.`);
      }
      return {
        path: assertion.path,
        ...(assertion.exists === undefined ? {} : { exists: assertion.exists }),
        ...(Object.prototype.hasOwnProperty.call(assertion, "equals")
          ? { equals: structuredClone(assertion.equals) as Json }
          : {}),
      };
    });
    return {
      id: candidate.id,
      ...(candidate.context === undefined
        ? {}
        : { context: structuredClone(candidate.context) as ExternalContext }),
      ...(candidate.evaluation === undefined
        ? {}
        : {
            evaluation: {
              cell: candidate.evaluation.cell as string,
              state: structuredClone(candidate.evaluation.state) as Record<string, Json>,
            },
          }),
      assertions,
    };
  });
  if (new Set(cases.map(({ id }) => id)).size !== cases.length) {
    throw new Error(`Blueprint '${value.blueprint}' contains duplicate test case IDs.`);
  }
  return { format: "gik-blueprint-tests/1", blueprint: value.blueprint, cases };
}

export function runBlueprintTestDocument(
  document: BlueprintTestDocument,
  options?: {
    blueprint: BlueprintArtifact;
    resolveBlueprint: BlueprintReferenceResolver;
  },
): BlueprintTestResult[] {
  return document.cases.map((testCase) => {
    const session = openHeadlessBlueprint(document.blueprint, testCase.context);
    const evaluation = testCase.evaluation
      ? (() => {
          if (!options) {
            throw new Error(`Blueprint test '${testCase.id}' requires a Blueprint resolver for Cell evaluation.`);
          }
          const materialized = materializeBlueprint({
            blueprint: options.blueprint,
            externalContext: testCase.context,
            resolveBlueprint: options.resolveBlueprint,
          });
          return evaluateBlueprintCellId({
            blueprint: materialized.payload.terminalBlueprint,
            state: {
              ...structuredClone(materialized.payload.initialState),
              ...structuredClone(testCase.evaluation.state),
            },
            cellId: testCase.evaluation.cell,
            externalContext: materialized.payload.externalContext,
          });
        })()
      : undefined;
    const subject = {
      runtime: {
        blueprintId: session.runtime.blueprintId,
        revision: session.runtime.revision,
      },
      state: session.snapshot(),
      ...(evaluation === undefined ? {} : { evaluation }),
    };
    const errors = testCase.assertions.flatMap((assertion) => {
      const actual = readJsonPath(subject, assertion.path);
      if (assertion.exists !== undefined && actual.found !== assertion.exists) {
        return [`Expected '${assertion.path}' existence to be ${assertion.exists}.`];
      }
      if (Object.prototype.hasOwnProperty.call(assertion, "equals")
        && (!actual.found || !jsonValuesEqual(actual.value, assertion.equals))) {
        return [`Expected '${assertion.path}' to equal ${JSON.stringify(assertion.equals)}.`];
      }
      return [];
    });
    return {
      blueprint: document.blueprint,
      caseId: testCase.id,
      passed: errors.length === 0,
      errors,
    };
  });
}
