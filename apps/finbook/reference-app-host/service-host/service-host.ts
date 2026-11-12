import { executeQueuedCellSourceEffect } from "gik-blueprint/worker";
import type { BlueprintRuntime } from "gik-controlface/blueprint";
import { DefaultServiceHost } from "gik-controlface/services";
import {
  JsonataExpressionProvider,
  unwrap,
  type ServiceDeclaration,
} from "gik-kernel";
import type { LoadBundleOptions } from "gik-react";

import {
  createReferenceServiceRegistry,
  type ReferenceServiceRegistryOptions,
} from "./registry";

export function createReferenceServiceOrchestrator(
  runtime: BlueprintRuntime,
  options: ReferenceServiceRegistryOptions = {},
): NonNullable<LoadBundleOptions["wrapOrchestrator"]> {
  return (fallback, state) => {
    const declarations = (unwrap(runtime.vocabulary).externals?.services ?? {}) as Record<string, ServiceDeclaration>;
    const host = new DefaultServiceHost({
      blueprintId: runtime.blueprintId,
      blueprintRevision: runtime.revision,
      declarations,
      registry: createReferenceServiceRegistry(options),
      state,
      expression: new JsonataExpressionProvider({ safe: true }),
      dependencyFailurePolicy: "throw",
    });
    const operations = new Set(
      Object.values(declarations).flatMap((declaration) => Object.keys(declaration.operations)),
    );

    return {
      invoke: (effect, control) => effect.kind === "invoke" && operations.has(effect.control.tool)
        ? executeQueuedCellSourceEffect(effect, state.snapshot(), (queuedEffect) => host.invoke(queuedEffect))
        : fallback?.invoke?.(effect, control) ?? Promise.resolve(),
      request: fallback?.request?.bind(fallback),
      route: fallback?.route?.bind(fallback),
      compensate: fallback?.compensate?.bind(fallback),
    };
  };
}
