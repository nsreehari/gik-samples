import type { ExternalContext } from "@gik/blueprint";
import type { BlueprintRuntime } from "@gik/controlface/blueprint";
import { InMemoryStateModel, type Json } from "@gik/kernel";

import {
  openSampleBlueprint,
  resolveSampleLaunchExternalContext,
} from "../bootstrap/catalog/blueprint-catalog";

export interface HeadlessBlueprintSession {
  runtime: BlueprintRuntime;
  state: InMemoryStateModel;
  snapshot(): Record<string, Json>;
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
