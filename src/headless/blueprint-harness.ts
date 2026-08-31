import {
  createBlueprintDurableTransitionAdapter,
  type ExternalContext,
} from "@gik-ai/blueprint";
import type { BlueprintRuntime } from "@gik-ai/controlface/blueprint";
import {
  InMemoryStateModel,
  type GIKEvent,
  type Json,
  type OrchestratorEffect,
} from "@gik-ai/kernel";

import {
  materializeSampleBlueprint,
  openSampleBlueprint,
  resolveSampleLaunchExternalContext,
  resolveSampleBlueprintSource,
} from "../bootstrap/catalog/blueprint-catalog";

export interface HeadlessBlueprintSession {
  runtime: BlueprintRuntime;
  state: InMemoryStateModel;
  snapshot(): Record<string, Json>;
}

export interface HeadlessDurableTransition {
  state: Record<string, Json>;
  effects: readonly OrchestratorEffect[];
}

export interface HeadlessDurableBlueprintSession {
  snapshot(): Record<string, Json>;
  transition(events: readonly GIKEvent[]): Promise<HeadlessDurableTransition>;
}

export function openHeadlessBlueprint(
  id: string,
  externalContext: ExternalContext | undefined = resolveSampleLaunchExternalContext(id),
): HeadlessBlueprintSession {
  const runtime = openSampleBlueprint(id, externalContext);
  const state = new InMemoryStateModel(Object.keys(runtime.state));
  state.apply(
    Object.entries(runtime.state).map(([path, value]) => ({
      op: "set" as const,
      path,
      value,
    })),
  );
  return {
    runtime,
    state,
    snapshot: () => structuredClone(state.snapshot()),
  };
}

export function openHeadlessDurableBlueprint(
  id: string,
  externalContext: ExternalContext | undefined = resolveSampleLaunchExternalContext(id),
): HeadlessDurableBlueprintSession {
  const adapter = createBlueprintDurableTransitionAdapter({
    blueprint: resolveSampleBlueprintSource(id),
    externalContext,
    materializedBlueprint: materializeSampleBlueprint(id, externalContext),
  });
  let state = adapter.initialState();
  let spec = adapter.initialSpec();
  return {
    snapshot: () => structuredClone(state),
    async transition(events) {
      const result = await adapter.transition({ state, spec, events });
      state = result.state;
      if (result.specUpdates?.length) {
        spec = adapter.applySpecUpdates({ spec, updates: result.specUpdates });
      }
      return {
        state: structuredClone(state),
        effects: structuredClone(result.effects),
      };
    },
  };
}
