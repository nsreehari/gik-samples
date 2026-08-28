import assert from "node:assert/strict";
import { test } from "vitest";

import {
  authorizeTrustedServiceEndpoint,
  trustedServiceEndpointOrigins,
} from "../bootstrap/catalog/trusted-service-endpoints";
import { getSampleBlueprintCatalog } from "../bootstrap/catalog/blueprint-catalog";

const blueprint = {
  gik: "0.1",
  type: "blueprint",
  payload: {
    id: "sample",
    kind: "runtime-blueprint",
    version: "1",
    structureMode: "fixed",
    services: {
      assistant: {
        kind: "foundry-agent",
        version: "1",
        operations: {
          chat: {
            operation: "chat",
            contract: "chat/v1",
          },
        },
        config: {
          endpoint: "https://trusted.example.test/foundry",
          credentialRef: "foundry-agent/access-key",
        },
      },
    },
    serviceRecipes: [{
      id: "runtime-provider",
      from: "logical",
      to: "runtime",
      implementationPrograms: [{
        id: "live",
        services: {
          market: {
            kind: "http-service",
            version: "1",
            operations: {},
            config: {
              endpoint: "https://http-proxy.example.test/api/http-proxy",
              credentialRef: "http-proxy/access-key",
            },
          },
        },
      }],
    }],
    metadata: {
      serviceShapedValue: {
        kind: "foundry-agent",
        version: "1",
        operations: {},
        config: {
          endpoint: "https://not-a-service.example.test",
        },
      },
    },
  },
};

test("collects non-secret service endpoints from trusted Blueprint declarations", () => {
  const endpoints = trustedServiceEndpointOrigins({ sample: blueprint });

  assert.deepEqual([...endpoints.get("foundry-agent") ?? []], ["https://trusted.example.test"]);
  assert.deepEqual([...endpoints.get("http-service") ?? []], ["https://http-proxy.example.test"]);
});

test("authorizes only matching kinds and origins from trusted Blueprint declarations", () => {
  const endpoints = trustedServiceEndpointOrigins({ sample: blueprint });

  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "foundry-agent",
      new URL("https://trusted.example.test/other-path"),
    ),
    true,
  );
  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "http-service",
      new URL("https://trusted.example.test"),
    ),
    false,
  );
  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "foundry-agent",
      new URL("https://untrusted.example.test"),
    ),
    false,
  );
  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "foundry-agent",
      new URL("https://not-a-service.example.test"),
    ),
    false,
  );
});

test("authorizes repository agent and recipe-selected HTTP proxy endpoints by service kind", () => {
  const endpoints = trustedServiceEndpointOrigins(getSampleBlueprintCatalog().seedEntries);

  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "foundry-agent",
      new URL("https://sz-foundry-proxy.azurewebsites.net/api/agent/chat"),
    ),
    true,
  );
  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "http-service",
      new URL("https://sz-http-proxy.azurewebsites.net/api/http-proxy"),
    ),
    true,
  );
  assert.equal(
    authorizeTrustedServiceEndpoint(
      endpoints,
      "foundry-agent",
      new URL("https://sz-http-proxy.azurewebsites.net/api/http-proxy"),
    ),
    false,
  );
});
