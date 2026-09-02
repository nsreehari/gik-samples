import "../bootstrap/catalog/test-setup";

import {
  materializeBlueprint,
  parseBlueprintReference,
  type ExternalContext,
} from "gik-blueprint";
import { createInMemoryBlueprintProposalStore } from "gik-blueprint-agent-host";
import type { Json } from "gik-kernel";

import {
  getSampleBlueprintCatalog,
  resolveSampleBlueprintSource,
} from "../bootstrap/catalog/blueprint-catalog";
import {
  collectScenarioObservation,
  evaluateScenarioWait,
  flattenScenarioActs,
} from "../scenarios/scenario-document";
import { runScenarioTransition } from "../scenarios/scenario-runner";
import { createBrowserBlueprintStorageConnectionFactory } from "../browser-host/src/runtime/blueprint-storage";
import type { UseProposal } from "../browser-host/src/runtime/blueprint-agent-lifecycle";
import { createSampleBlueprintHostRegistry } from "../browser-host/src/runtime/hosted-blueprint-registry";
import { resolveBlueprintNativeFromMaterialized } from "../browser-host/src/runtime/blueprint-runtime";

export interface RunAuthoredScenarioOptions {
  blueprint?: string;
  scenario?: string;
  context?: string;
}

function logAct(status: "started" | "done", title: string): void {
  const time = new Date().toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`${time} ${status} ${title}`);
}

export async function runAuthoredScenario(options: RunAuthoredScenarioOptions = {}): Promise<{
  blueprint: string;
  scenario: string;
  context: string;
  observations: Record<string, Record<string, Json>>;
}> {
  const catalog = getSampleBlueprintCatalog();
  const blueprintId = options.blueprint ?? Object.keys(catalog.scenarios)[0];
  const document = catalog.scenarios[blueprintId];
  if (!document) throw new Error(`Blueprint '${blueprintId}' has no authored scenarios.`);

  const scenarioId = options.scenario ?? document.scenarios[0]?.id;
  const scenario = document.scenarios.find(({ id }) => id === scenarioId);
  if (!scenario) throw new Error(`Scenario '${scenarioId}' was not found for '${blueprintId}'.`);

  const contextId = options.context ?? scenario.contextPreset
    ?? scenario.applicableContexts?.[0] ?? Object.keys(document.contextPresets)[0];
  const context = structuredClone(
    document.contextPresets[contextId]?.context ?? {},
  ) as ExternalContext;
  const blueprintStorage = createBrowserBlueprintStorageConnectionFactory(false);
  const proposalStore = createInMemoryBlueprintProposalStore<UseProposal>();
  const blueprintRegistry = createSampleBlueprintHostRegistry({
    createProposalStore: () => createInMemoryBlueprintProposalStore<UseProposal>(),
    blueprintStorage,
    blueprintStorageRootInstanceId: `${blueprintId}:scenario`,
  });
  const blueprint = resolveSampleBlueprintSource(blueprintId);
  const materialized = materializeBlueprint({
    blueprint,
    externalContext: context,
    resolveBlueprint: (reference, childContext) =>
      blueprintRegistry.resolveArtifact(parseBlueprintReference(reference), {
        ...childContext,
        parentInstanceId: `scenario:${scenario.id}`,
      }),
  });
  const native = resolveBlueprintNativeFromMaterialized(blueprintId, materialized, {
    proposalStore,
    blueprintStorage,
    instanceId: `${blueprintId}:scenario`,
    registryOptions: {
      resolveCredential: async (reference) => {
        const accessKey = process.env.FOUNDRY_PROXY_KEY;
        if (!accessKey) {
          throw new Error(
            `Credential '${reference}' requires the FOUNDRY_PROXY_KEY environment variable.`,
          );
        }
        return accessKey;
      },
    },
  });
  let state = structuredClone(materialized.payload.initialState) as Record<string, Json>;
  const observations: Record<string, Record<string, Json>> = {};
  state = await runScenarioTransition({
    state,
    materializedBlueprint: materialized,
    native,
  });

  for (const act of flattenScenarioActs(scenario)) {
    logAct("started", act.title);
    if ("event" in act) {
      state = await runScenarioTransition({
        state,
        materializedBlueprint: materialized,
        native,
        event: act.event,
      });
    } else if ("wait" in act) {
      const timeoutMs = 10_000;
      const started = Date.now();
      while (!await evaluateScenarioWait(act, { state, context })) {
        if (Date.now() - started >= timeoutMs) {
          throw new Error(`Act '${act.id}' timed out after ${timeoutMs}ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } else {
      observations[act.id] = await collectScenarioObservation(act, { state, context });
    }
    logAct("done", act.title);
  }

  return {
    blueprint: blueprintId,
    scenario: scenario.id,
    context: contextId,
    observations,
  };
}
