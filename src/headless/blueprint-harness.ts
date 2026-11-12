import {
  createBlueprintDurableEffectSettlementEvent,
  createBlueprintDurableTransitionAdapter,
  type DurableBlueprintSpec,
  type ExternalContext,
} from "gik-blueprint";
import type { BlueprintRuntime } from "gik-controlface/blueprint";
import {
  InMemoryStateModel,
  type GIKEvent,
  type Json,
  type OrchestratorEffect,
} from "gik-kernel";

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
  /**
   * Simulates a process restart: builds a brand-new durable transition adapter
   * (a fresh in-memory materialization, matching what a real host would rebuild
   * on reload) but seeds it with this session's *persisted* state and spec
   * (including `settledEffectMessageIds`), exactly as a durable host would
   * rehydrate from storage. Use this to assert that pending requests, cadence
   * generations, and settlement dedup all survive a restart mid-flow.
   */
  restart(): HeadlessDurableBlueprintSession;
}

export type RequestSettlementOutcome = "resolved" | "rejected" | "cancelled" | "failed";

/**
 * Builds a real Kernel settlement event for a `request`-kind effect, wrapping
 * `createBlueprintDurableEffectSettlementEvent` the same way a real host would
 * after a clarification/decision/data request is answered out of band. This
 * intentionally mirrors production settlement instead of authoring a fake
 * "resolved" domain event: the Cell only ever reacts to the Kernel's own
 * `resolved`/`rejected`/`cancelled`/`failed` outcome events.
 *
 * Correlation metadata is not synthesized here. The Kernel copies the
 * triggering command payload into request-effect data and projects that
 * immutable request context onto the settlement event.
 *
 * NOTE on `effect.effectId`: the Kernel assigns it as `effect-<rev>-<seq>`
 * from *in-memory* counters on the Kernel instance materialized for a single
 * `transition()` call; the durable adapter rematerializes a fresh Kernel from
 * persisted state on every call, so those counters restart each time. Two
 * requests issued in different `transition()` calls can therefore legitimately
 * end up with the exact same `effectId` (e.g. both `effect-1-0`). A real host
 * provides the actual globally-unique dedup key via its own durable-runtime
 * message/queue infrastructure (see `execution.messageId` in
 * `blueprint/src/worker.ts`), never by deriving it from `effect.effectId`. We
 * mirror that here with `randomUUID()` rather than defaulting to a
 * `effect.effectId`-derived id, which would be unsafe.
 */
export function createRequestSettlementEvent(
  effect: OrchestratorEffect,
  outcome: RequestSettlementOutcome,
  detail: { revision: number; [key: string]: Json },
  data?: Json,
  options: { messageId?: string } = {},
): GIKEvent {
  if (effect.kind !== "request") {
    throw new Error("createRequestSettlementEvent requires a request effect.");
  }
  if (!effect.effectId) {
    throw new Error("createRequestSettlementEvent requires the effect to carry an effectId.");
  }
  const { revision, ...settlementDetail } = detail;
  if (effect.data.revision !== revision) {
    throw new Error(
      `Settlement revision '${revision}' does not match request revision '${String(effect.data.revision)}'.`,
    );
  }
  return createBlueprintDurableEffectSettlementEvent(
    options.messageId ?? globalThis.crypto.randomUUID(),
    {
      settlement: {
        effectId: effect.effectId,
        outcome,
        ...(data !== undefined ? { data } : {}),
        ...(Object.keys(settlementDetail).length > 0 ? { detail: settlementDetail } : {}),
      },
    },
    effect,
  );
}

/**
 * Builds a real Kernel settlement event for a Cell-declared `sources` (async
 * data-fetch) invoke effect, wrapping `createBlueprintDurableEffectSettlementEvent`
 * the same way a real host would after the backing service call completes.
 * `sourceOutput` is the raw operation response before the Cell's own
 * `sourceOutputTransform` JSONata expression extracts the value it assigns.
 */
export function createSourceSettlementEvent(
  effect: OrchestratorEffect,
  sourceOutput: Json,
  options: { messageId?: string } = {},
): GIKEvent {
  if (effect.kind !== "invoke" || !effect.control.sourceRequestToken) {
    throw new Error("createSourceSettlementEvent requires a source invoke effect (control.sourceRequestToken).");
  }
  return createBlueprintDurableEffectSettlementEvent(
    options.messageId ?? globalThis.crypto.randomUUID(),
    { sourceOutput },
    effect,
  );
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

function buildHeadlessDurableSession(
  id: string,
  externalContext: ExternalContext | undefined,
  persisted?: { state: Record<string, Json>; spec: DurableBlueprintSpec },
): HeadlessDurableBlueprintSession {
  const adapter = createBlueprintDurableTransitionAdapter({
    blueprint: resolveSampleBlueprintSource(id),
    externalContext,
    materializedBlueprint: materializeSampleBlueprint(id, externalContext),
  });
  let state = persisted ? structuredClone(persisted.state) : adapter.initialState();
  let spec = persisted ? structuredClone(persisted.spec) : adapter.initialSpec();
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
    restart() {
      return buildHeadlessDurableSession(id, externalContext, {
        state: structuredClone(state),
        spec: structuredClone(spec),
      });
    },
  };
}

export function openHeadlessDurableBlueprint(
  id: string,
  externalContext: ExternalContext | undefined = resolveSampleLaunchExternalContext(id),
): HeadlessDurableBlueprintSession {
  return buildHeadlessDurableSession(id, externalContext);
}
