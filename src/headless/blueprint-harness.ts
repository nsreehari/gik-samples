import type { ExternalContext } from "@gik-ai/blueprint";
import { executeQueuedCellSourceEffect } from "@gik-ai/blueprint/worker";
import type { BlueprintRuntime } from "@gik-ai/controlface/blueprint";
import { ControlFace } from "@gik-ai/controlface";
import {
  DefaultServiceHost,
  QueueFace,
} from "@gik-ai/controlface/services";
import {
  InMemoryStateModel,
  JsonataExpressionProvider,
  unwrap,
  type Json,
  type ServiceDeclaration,
} from "@gik-ai/kernel";

import {
  openSampleBlueprint,
  resolveSampleLaunchExternalContext,
} from "../bootstrap/catalog/blueprint-catalog";
import {
  createSampleServiceKindRegistry,
  type SampleServiceRegistryOptions,
} from "../service-kinds";

export interface HeadlessBlueprintSession {
  runtime: BlueprintRuntime;
  state: InMemoryStateModel;
  snapshot(): Record<string, Json>;
}

export interface HeadlessServiceBlueprintOptions {
  externalContext?: ExternalContext;
  registryOptions?: SampleServiceRegistryOptions;
  enableQueueWorker?: boolean;
}

export interface HeadlessServiceBlueprintSession extends HeadlessBlueprintSession {
  serviceHost: DefaultServiceHost;
  controlFace: ControlFace;
  queueFace?: QueueFace;
  runNext?(): ReturnType<DefaultServiceHost["runNext"]>;
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

export function openHeadlessServiceBlueprint(
  id: string,
  options: HeadlessServiceBlueprintOptions = {},
): HeadlessServiceBlueprintSession {
  const session = openHeadlessBlueprint(
    id,
    options.externalContext ?? resolveSampleLaunchExternalContext(id),
  );
  const declarations = (
    unwrap(session.runtime.vocabulary).externals?.services ?? {}
  ) as Record<string, ServiceDeclaration>;
  const queuedOperations = Object.entries(declarations).flatMap(([serviceId, declaration]) =>
    Object.entries(declaration.operations)
      .filter(([, operation]) => operation.mode === "queued")
      .map(([operationId]) => `${serviceId}.${operationId}`));
  if (queuedOperations.length > 0 && !options.enableQueueWorker) {
    throw new Error(
      `Headless Blueprint '${id}' declares queued services but no queue worker was enabled: ${queuedOperations.join(", ")}`,
    );
  }

  const serviceHost = new DefaultServiceHost({
    blueprintId: session.runtime.blueprintId,
    blueprintRevision: session.runtime.revision,
    declarations,
    registry: createSampleServiceKindRegistry(options.registryOptions),
    state: session.state,
    expression: new JsonataExpressionProvider({ safe: true }),
    dependencyFailurePolicy: "throw",
  });
  const operationIds = new Set(
    Object.values(declarations).flatMap((declaration) => Object.keys(declaration.operations)),
  );
  const orchestrator = {
    invoke: (effect: Parameters<DefaultServiceHost["invoke"]>[0]) =>
      effect.kind === "invoke" && operationIds.has(effect.control.tool)
        ? executeQueuedCellSourceEffect(
            effect,
            session.state.snapshot(),
            (executingEffect) => serviceHost.invoke(executingEffect),
          )
        : Promise.resolve(),
  };
  const controlFace = new ControlFace(
    session.runtime.vocabulary,
    session.runtime.program,
    {
      state: session.state,
      orchestrator,
      serviceHost,
      blueprint: session.runtime.definition,
    },
  );

  if (!options.enableQueueWorker) {
    return {
      ...session,
      serviceHost,
      controlFace,
    };
  }

  return {
    ...session,
    serviceHost,
    controlFace,
    queueFace: new QueueFace(serviceHost),
    runNext: () => serviceHost.runNext(),
  };
}
