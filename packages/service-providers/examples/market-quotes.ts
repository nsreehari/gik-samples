import { ServiceKindRegistry, type ServiceKindContext } from "gik-controlface/services";
import type { NativeServiceDeclaration } from "gik-kernel";
import { createMarketQuotesServiceKind } from "gik-service-providers/market-quotes";

export const quotes: NativeServiceDeclaration = {
  kind: "market-quotes", version: "1", config: { providerRef: "quotes/main" },
  operations: {
    get: {
      operation: "get", contract: "market-quotes/v1",
      settlement: { transform: { kind: "jsonata", expr: "{'detail':response}" } },
    },
  },
};

/** Both browser and headless hosts supply their own trusted routing and readiness ports. */
export function createQuoteRegistry(
  execute: NonNullable<ServiceKindContext["execute"]>,
  inspectDependency: NonNullable<ServiceKindContext["inspectDependency"]>,
) {
  const registry = new ServiceKindRegistry({ execute, inspectDependency });
  registry.register(createMarketQuotesServiceKind());
  return registry;
}
