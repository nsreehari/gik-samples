import { InMemoryStateModel, JsonataExpressionProvider, type NativeServiceDeclaration } from "gik-kernel";
import {
  DefaultServiceHost, ServiceKindRegistry, UnsatisfiedServiceDependencyError,
  type ServiceDependencyRequirement, type ServiceDependencyStatus, type BlueprintServiceIdentity,
  type ServiceInvocationAuthorizer,
} from "gik-controlface/services";
import { createSchedulerServiceKind } from "gik-service-providers/scheduler";
import { createGmailServiceKind, type GmailConnection } from "gik-service-providers/gmail";

const settlement = { transform: { kind: "jsonata" as const, expr: "{'outcome':'completed','detail':response}" } };
export const services: Record<string, NativeServiceDeclaration> = {
  mail: {
    kind: "gmail", version: "1",
    config: { endpoint: "https://gmail.googleapis.com", credentialRef: "google/main", pollIntervalMs: 60000 },
    operations: {
      search: { operation: "search", contract: "gmail.search/v1", settlement },
      get: { operation: "get", contract: "gmail.get/v1", settlement },
      send: { operation: "send", contract: "gmail.send/v1", settlement },
      inbox: {
        operation: "watch", contract: "gmail.watch/v1", settlement,
        sense: { kind: "feed", signals: { message: { payloadSchema: { type: "object" } } } },
      },
    },
  },
  clock: {
    kind: "cron-scheduler", version: "1",
    config: { expression: "0 9 * * *", timezone: "Asia/Kolkata" },
    operations: { due: {
      operation: "tick", contract: "scheduler.cron/v1", settlement,
      sense: { kind: "timer", signals: { due: { payloadSchema: { type: "object" } } } },
    } },
  },
};

/** UI sessions and headless refreshable sessions supply the same non-secret ports. */
export function createExampleHost(options: {
  enabled: readonly ("mail" | "clock")[];
  google: GmailConnection["request"];
  inspect(requirement: Readonly<ServiceDependencyRequirement>, identity: Readonly<BlueprintServiceIdentity>): ServiceDependencyStatus;
  authorize: ServiceInvocationAuthorizer;
  invalidateGoogle(): void | Promise<void>;
}) {
  let host: DefaultServiceHost;
  const connection: GmailConnection = {
    request: options.google,
    async send(http, request) {
      // Reuse the host's sole evaluator, including its live kill switch.
      const decision = await host.authorizeInvocation({ kind: "service-request", phase: "execution", request });
      if (decision.outcome !== "authorized") {
        throw new UnsatisfiedServiceDependencyError(
          `Host send authorization: ${decision.outcome}`, { kind: "gmail-send-authority", ref: "google/main" },
        );
      }
      return options.google(http);
    },
  };
  const registry = new ServiceKindRegistry({
    inspectDependency: options.inspect,
    resolveCredential: async (ref) => {
      if (ref !== "google/main") throw new Error(`Unknown credential reference '${ref}'`);
      return connection;
    },
    clearCredential: options.invalidateGoogle,
    authorizeEndpoint: (kind, url) => kind === "gmail" && url.origin === "https://gmail.googleapis.com",
  });
  if (options.enabled.includes("clock")) registry.register(createSchedulerServiceKind());
  if (options.enabled.includes("mail")) registry.register(createGmailServiceKind());
  host = new DefaultServiceHost({
    blueprintId: "provider-example", blueprintRevision: "1",
    declarations: Object.fromEntries(options.enabled.map((id) => [id, services[id]])),
    registry, state: new InMemoryStateModel(["work"]), expression: new JsonataExpressionProvider(),
    authorizeInvocation: options.authorize,
  });
  return host;
}

export async function inspectHeadlessSetup(host: DefaultServiceHost, enabled: readonly string[]) {
  const reports = await Promise.all(enabled.map((id) => host.describeServiceSetup(id)));
  if (reports.some((report) => !report.ready)) {
    // Operators receive requirements and action IDs, never literal credentials.
    throw new Error(`Provisioning required: ${JSON.stringify(reports)}`);
  }
  return reports;
}
