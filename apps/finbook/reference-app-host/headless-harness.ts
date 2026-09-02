import { openBlueprint } from "gik-controlface/blueprint";
import {
  InMemoryStateModel,
  type Json,
} from "gik-kernel";
import {
  validateBlueprintArtifact,
  type BlueprintArtifact,
} from "gik-react";

export function openReferenceAppHeadless(blueprint: BlueprintArtifact) {
  validateBlueprintArtifact(blueprint);
  const runtime = openBlueprint(blueprint);
  const state = new InMemoryStateModel(Object.keys(runtime.state));
  state.apply(Object.entries(runtime.state).map(([path, value]) => ({
    op: "set" as const,
    path,
    value,
  })));
  return {
    runtime,
    state,
    snapshot: (): Record<string, Json> => structuredClone(state.snapshot()),
  };
}
