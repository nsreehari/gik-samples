import { ServiceKindRegistry } from "@gik-ai/controlface/services";

import { createMcpServiceKind } from "./mcp-service-kind";
import {
  localDevelopmentEndpointPolicy,
  type CredentialPolicy,
  type EndpointPolicy,
} from "../policies";

export interface ReferenceServiceRegistryOptions {
  endpointPolicy?: EndpointPolicy;
  credentialPolicy?: CredentialPolicy;
}

export function createReferenceServiceRegistry(
  options: ReferenceServiceRegistryOptions = {},
): ServiceKindRegistry {
  const endpointPolicy = options.endpointPolicy ?? localDevelopmentEndpointPolicy;
  const credentialPolicy = options.credentialPolicy;
  const registry = new ServiceKindRegistry({
    hostCapabilities: ["mcp-executor"],
    authorizeEndpoint: (kind, endpoint) => endpointPolicy.authorizeEndpoint(kind, endpoint),
    ...(credentialPolicy
      ? {
          resolveCredential: (reference: string) =>
            credentialPolicy.resolveCredential(reference),
          ...(credentialPolicy.clearCredential
            ? {
                clearCredential: (reference: string) =>
                  credentialPolicy.clearCredential?.(reference),
              }
            : {}),
        }
      : {}),
  });
  registry.register(createMcpServiceKind());
  return registry;
}
