import { readFileSync } from "node:fs";
import {
  BlueprintSenseReconciler,
  createBlueprintDurableBootstrapEvent,
  createBlueprintDurableTransitionAdapter,
  parseBlueprintJson,
  type DurableBlueprintSpec,
} from "gik-blueprint";
import { createBlueprintWorker, executeQueuedBlueprintEffect, queuedBlueprintEffectFailureEvents } from "gik-blueprint/worker";
import { DefaultServiceHost, ServiceKindRegistry, createIntervalTimerServiceKind } from "gik-controlface/services";
import { createDurableRuntime, type DurableProvider, type TransitionRefs } from "gik-durable-runtime";
import { InMemoryStateModel, JsonataExpressionProvider, type Json, type OrchestratorEffect } from "gik-kernel";

export async function openSenseClockHost(options: {
  runtimeId: string;
  refs: TransitionRefs;
  providerKind: string;
  provider: DurableProvider;
  onError(error: unknown): void;
}) {
  const blueprint = parseBlueprintJson(readFileSync(
    new URL("../bootstrap/blueprints/senses-clock/blueprint.json", import.meta.url), "utf8",
  ));
  const registry = new ServiceKindRegistry();
  registry.register(createIntervalTimerServiceKind());
  registry.register({
    manifest: {
      id: "sample-review-report", version: "1",
      configSchema: { type: "object", additionalProperties: false },
      executionModes: ["immediate"], subjects: ["cell"],
    },
    create: () => ({
      provider: { id: "sample-review-report", version: "1" },
      async discover() { return { provider: { id: "sample-review-report", version: "1" }, revision: "1", discoveredAt: new Date().toISOString(), capabilities: [] }; },
      async execute(request) {
        const input = request.input;
        if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.tick !== "number") {
          throw new Error("Review report requires a numeric tick");
        }
        return { output: { reviewedThroughTick: input.tick } };
      },
    }),
  });
  let fault: { error: unknown } | undefined;
  let stopped = false;
  const pending = new Set<Promise<unknown>>();
  const fail = (error: unknown) => { fault = { error }; options.onError(error); };
  const serviceHost = (state: Record<string, Json>, spec: DurableBlueprintSpec) => {
    const model = new InMemoryStateModel();
    model.apply(Object.entries(state).map(([path, value]) => ({ op: "set", path, value })));
    return new DefaultServiceHost({
      blueprintId: blueprint.payload.id, blueprintRevision: blueprint.payload.version,
      declarations: spec.materializedBlueprint.payload.terminalBlueprint.payload.services ?? {},
      registry, state: model, expression: new JsonataExpressionProvider({ safe: true }),
    });
  };
  const runtime = createDurableRuntime({
    runtimeId: options.runtimeId,
    providers: { [options.providerKind]: options.provider },
    transitionAdapter: createBlueprintDurableTransitionAdapter({ blueprint, instanceId: options.runtimeId }),
    effectHandlers: {
      "*": async (effect, execution) => {
        const saved = await snapshot();
        return executeQueuedBlueprintEffect(effect as OrchestratorEffect, saved.state, execution.messageId,
          (prepared) => serviceHost(saved.state, saved.spec).invoke(prepared));
      },
    },
    effectFailureHandler: (effect, failure) => queuedBlueprintEffectFailureEvents(effect as OrchestratorEffect, failure),
  });
  const snapshot = () => runtime.readSnapshot<Record<string, Json>, DurableBlueprintSpec>(options.refs);
  const senses = new BlueprintSenseReconciler({
    async open(binding, emit) {
      const saved = await snapshot();
      const contract = binding.declaration.operations[binding.sense.operation]?.sense;
      if (!contract) throw new Error("Missing Sense contract");
      if (!binding.input || typeof binding.input !== "object" || Array.isArray(binding.input)) throw new Error("Sense sample requires object inputs");
      return serviceHost(saved.state, saved.spec).observe({
        kind: "invoke", node: binding.cellId,
        control: { serviceRef: binding.sense.service, tool: binding.sense.operation },
        data: binding.input,
      }, { kind: contract.kind, emit, onError: fail });
    },
    async append(event) {
      await runtime.appendJournal({ ...options.refs, entry: event });
      worker.notify();
    },
    onError: fail,
  });
  const track = <T>(promise: Promise<T>) => {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const worker = createBlueprintWorker({
    runtime: {
      processEngineWake: (request) => track((async () => {
        const result = await runtime.processEngineWake(request);
        if (result.status === "committed" && !stopped) {
          const saved = await snapshot();
          if (saved.spec.senses) await senses.reconcile(saved.spec.senses);
        }
        return result;
      })()),
      processQueueLaneItem: (request) => track(runtime.processQueueLaneItem(request)),
    },
    request: { ...options.refs, maxAttempts: 1 },
    subscribe(notify, signal) {
      const interval = setInterval(notify, 10);
      signal.addEventListener("abort", () => clearInterval(interval), { once: true });
      return () => clearInterval(interval);
    },
    onError: fail,
  });
  try {
    const initialized = await runtime.initializeRuntime(options.refs);
    if (initialized.created) {
      await runtime.appendJournal({ ...options.refs, entry: createBlueprintDurableBootstrapEvent() });
      await runtime.runEngine(options.refs);
    }
    const saved = await snapshot();
    if (JSON.stringify(saved.spec.authoredBlueprint) !== JSON.stringify(blueprint)) throw new Error("Saved Sense sample requires an explicit Blueprint upgrade");
    if (saved.spec.senses) await senses.reconcile(saved.spec.senses);
    await worker.start();
  } catch (error) {
    worker.stop();
    await senses.stop();
    throw error;
  }
  return {
    async snapshot() {
      if (fault) throw fault.error;
      return snapshot();
    },
    async configure(enabled: boolean, intervalMs: number) {
      if (fault) throw fault.error;
      if (stopped) throw new Error("Sense sample is stopped");
      await runtime.appendJournal({ ...options.refs, entry: { node: "review", name: "configure", payload: { enabled, intervalMs } } });
      worker.notify();
    },
    async close() {
      stopped = true;
      worker.stop();
      await senses.stop();
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
