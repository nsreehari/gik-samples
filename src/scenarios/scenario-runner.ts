import {
  InMemoryStateModel,
  type GIKEvent,
  type InvocationControl,
  type Json,
  type Orchestrator,
  type OrchestratorEffect,
  type OrchestratorResult,
  type StateModel,
} from "gik-kernel";
import {
  runMaterializedTransition,
  type MaterializedBlueprint,
} from "gik-blueprint";
import type { BundleNative } from "gik-react";

export function scenarioTransitionOrchestrator(
  native: BundleNative,
): ((state: StateModel) => Orchestrator) | undefined {
  return native.wrapOrchestrator
    ? (state) => native.wrapOrchestrator!({}, state)
    : undefined;
}

async function executeScenarioEffect(
  effect: OrchestratorEffect,
  state: Record<string, Json>,
  native: BundleNative,
): Promise<OrchestratorResult> {
  const store = new InMemoryStateModel();
  store.apply(Object.entries(state).map(([path, value]) => ({ op: "set", path, value })));
  const orchestrator = native.wrapOrchestrator?.({}, store);
  if (!orchestrator) throw new Error(`Scenario cannot execute '${effect.kind}' without an orchestrator.`);

  let emitted: OrchestratorResult | undefined;
  const control: InvocationControl = {
    id: crypto.randomUUID(),
    signal: new AbortController().signal,
    emitProgress: async () => undefined,
    emit: async (result = {}) => {
      emitted = result;
    },
  };
  const returned = effect.kind === "invoke"
    ? await orchestrator.invoke?.(effect, control)
    : effect.kind === "request"
      ? await orchestrator.request?.(effect)
      : await orchestrator.route?.(effect);
  return returned ?? emitted ?? {};
}

export async function runScenarioTransition(options: {
  state: Record<string, Json>;
  materializedBlueprint: MaterializedBlueprint;
  native: BundleNative;
  event?: GIKEvent;
}): Promise<Record<string, Json>> {
  let result = await runMaterializedTransition({
    state: options.state,
    materializedBlueprint: options.materializedBlueprint,
    events: options.event ? [options.event] : [],
    syncExternal: options.event ? undefined : true,
    createOrchestrator: scenarioTransitionOrchestrator(options.native),
  });
  let pending = result.effects ?? [];
  let rounds = 0;

  while (pending.length > 0) {
    if (++rounds > 64) throw new Error("Scenario effect lifecycle exceeded 64 settlement rounds.");
    const effect = pending[0];
    const settlement = await executeScenarioEffect(effect, result.state, options.native);
    result = await runMaterializedTransition({
      state: result.state,
      materializedBlueprint: options.materializedBlueprint,
      events: [],
      createOrchestrator: scenarioTransitionOrchestrator(options.native),
      ...(effect.kind === "invoke" && effect.control.sourceRequestToken
        ? { sourceSettlements: [{ effect, result: settlement }] }
        : effect.kind === "request"
          ? { requestSettlements: [{ effect, result: settlement }] }
          : { serviceSettlements: [settlement] }),
    });
    pending = result.effects ?? [];
  }

  return result.state;
}
