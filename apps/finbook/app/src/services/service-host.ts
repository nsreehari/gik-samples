import { executeQueuedCellSourceEffect } from "@gik-ai/blueprint/worker";
import type { BlueprintRuntime } from "@gik-ai/controlface/blueprint";
import { DefaultServiceHost } from "@gik-ai/controlface/services";
import {
  JsonataExpressionProvider,
  unwrap,
  type ServiceDeclaration,
} from "@gik-ai/kernel";
import type { LoadBundleOptions } from "@gik-ai/react";

import { createFinbookServiceRegistry } from "./registry";

export function createFinbookServiceOrchestrator(
  runtime: BlueprintRuntime,
  serverOverride?: string,
): NonNullable<LoadBundleOptions["wrapOrchestrator"]> {
  return (fallback, state) => {
    const declarations = (unwrap(runtime.vocabulary).externals?.services ?? {}) as Record<string, ServiceDeclaration>;
    const host = new DefaultServiceHost({
      blueprintId: runtime.blueprintId,
      blueprintRevision: runtime.revision,
      declarations,
      registry: createFinbookServiceRegistry(serverOverride),
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
